import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WorkshopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.origin = f'http://127.0.0.1:{cls.port}'
        cls.env = {**os.environ, 'APP_PASSWORD': 'integration-test-password',
                   'APP_ORIGIN': cls.origin, 'DATA_DIR': cls.temp.name, 'PORT': str(cls.port)}
        cls.start()

    @classmethod
    def start(cls):
        cls.process = subprocess.Popen([sys.executable, str(ROOT / 'server.py')], env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(100):
            try:
                if cls.request('GET', '/health')[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(.05)
        cls.process.terminate()
        raise RuntimeError(cls.process.communicate()[1].decode())

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.communicate(timeout=10)
        cls.temp.cleanup()

    @classmethod
    def request(cls, method, path, data=None, cookie='', origin=None, content_type='application/json'):
        conn = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=5)
        body = json.dumps(data) if data is not None else None
        headers = {'Origin': cls.origin if origin is None else origin, 'Content-Type': content_type, 'Cookie': cookie}
        conn.request(method, path, body, headers)
        response = conn.getresponse()
        status, cookie_out = response.status, response.getheader('Set-Cookie')
        value = json.loads(response.read())
        conn.close()
        return status, value, cookie_out

    def login(self, name='Test Damir'):
        status, _, cookie = self.request('POST', '/api/login', {'actor': name, 'password': 'integration-test-password'})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        return cookie.split(';')[0]

    def create(self, cookie, **extra):
        status, data, _ = self.request('POST', '/api/jobs', {'code': 'SDe TEST', 'title': 'Preizkusni objekt', **extra}, cookie)
        self.assertEqual(status, 201, data)
        return data

    def test_auth_origin_and_logout(self):
        self.assertEqual(self.request('GET', '/api/jobs')[0], 401)
        self.assertEqual(self.request('POST', '/api/login', {'actor': 'Someone', 'password': 'wrong'})[0], 401)
        cookie = self.login()
        self.assertEqual(self.request('GET', '/api/me', cookie=cookie)[1]['actor'], 'Test Damir')
        self.assertEqual(self.request('POST', '/api/jobs', {'code': 'X', 'title': 'Y'}, cookie, origin='https://other.example')[0], 403)
        self.assertEqual(self.request('POST', '/api/logout', {}, cookie)[0], 200)
        self.assertEqual(self.request('GET', '/api/jobs', cookie=cookie)[0], 401)

    def test_shared_state_and_audit(self):
        a, b = self.login('Test Vodja'), self.login('Test Sodelavec')
        j = self.create(a, notes='Manjkajo stekla')
        status, updated, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'material': 'ordered', 'sheet': 'painting'}, b)
        self.assertEqual(status, 200)
        self.assertEqual(updated['notes'], 'Manjkajo stekla')
        shared = self.request('GET', '/api/jobs', cookie=a)[1]['jobs']
        self.assertEqual(next(x for x in shared if x['id'] == j['id'])['sheet'], 'painting')
        events = self.request('GET', '/api/jobs/' + j['id'] + '/history', cookie=a)[1]['events']
        self.assertEqual(events[0]['actor'], 'Test Sodelavec')
        self.assertEqual({e['field'] for e in events}, {'created', 'material', 'sheet'})

    def test_concurrent_writes_do_not_overwrite(self):
        a, b = self.login('Test A'), self.login('Test B')
        j = self.create(a)
        def update(cookie, value):
            return self.request('PATCH', '/api/jobs/' + j['id'], {'version': 1, 'notes': value}, cookie)[0]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(update, a, 'Prva'), pool.submit(update, b, 'Druga')]
            self.assertEqual(sorted(f.result() for f in futures), [200, 409])
        events = self.request('GET', '/api/jobs/' + j['id'] + '/history', cookie=a)[1]['events']
        self.assertEqual(len(events), 2)

    def test_archive_dispatch_and_restore(self):
        c = self.login()
        j = self.create(c)
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': 1, 'dispatch': 'done'}, c)
        self.assertEqual(status, 200)
        self.assertTrue(j['archived'])
        _, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'archived': False}, c)
        self.assertFalse(j['archived'])
        self.assertEqual(j['dispatch'], 'waiting')
        _, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'archived': True}, c)
        self.assertTrue(j['archived'])
        self.assertEqual(j['dispatch'], 'waiting')

    def test_invalid_data_leaves_record_unchanged(self):
        c = self.login()
        j = self.create(c)
        for bad in [{'cutting': 'unrecognised'}, {'due': '2026-02-30'}, {'code': ''}, {'archived': 'false'}, {'notes': 'x' * 4001}, {'id': 'spoof'}, {'version': True}]:
            data = {'version': j['version'], **bad}
            self.assertEqual(self.request('PATCH', '/api/jobs/' + j['id'], data, c)[0], 400, bad)
        current = next(x for x in self.request('GET', '/api/jobs', cookie=c)[1]['jobs'] if x['id'] == j['id'])
        self.assertEqual(current['version'], 1)
        self.assertEqual(self.request('POST', '/api/jobs', {'code': 'x'}, c)[0], 400)
        self.assertEqual(self.request('POST', '/api/jobs', {'code': 'x', 'title': 'y'}, c, content_type='text/plain')[0], 400)

    def test_persistence_after_restart(self):
        c = self.login()
        j = self.create(c, notes='Ohranjeno po zagonu')
        self.process.terminate()
        self.process.communicate(timeout=10)
        self.start()
        current = next(x for x in self.request('GET', '/api/jobs', cookie=c)[1]['jobs'] if x['id'] == j['id'])
        self.assertEqual(current['notes'], 'Ohranjeno po zagonu')
        with sqlite3.connect(Path(self.temp.name) / 'delavnica.sqlite3') as db:
            self.assertIsNotNone(db.execute('SELECT id FROM events WHERE job_id=?', (j['id'],)).fetchone())


if __name__ == '__main__':
    unittest.main()
