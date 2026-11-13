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
        self.assertEqual({e['field'] for e in events}, {'created', 'material', 'sheet', 'sheet_dispatch'})

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
        status, _, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'archived': True}, c)
        self.assertEqual(status, 400)
        self.assertEqual(j['dispatch'], 'waiting')

    def test_separate_facade_and_sheet_shipments(self):
        c = self.login()
        j = self.create(c, sheet='awaiting_paint')
        self.assertEqual(j['sheet_dispatch'], 'waiting')
        def patch(**fields):
            nonlocal j
            status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], **fields}, c)
            self.assertEqual(status, 200, j)
        patch(dispatch='done')
        self.assertFalse(j['archived'])
        self.assertEqual(j['sheet'], 'awaiting_paint')
        patch(sheet='painting')
        self.assertFalse(j['archived'])
        patch(sheet='done')
        self.assertFalse(j['archived'])
        patch(sheet_dispatch='done')
        self.assertTrue(j['archived'])
        patch(sheet_dispatch='waiting')
        self.assertFalse(j['archived'])
        self.assertEqual(j['dispatch'], 'done')
        patch(sheet='na')
        self.assertTrue(j['archived'])
        self.assertEqual(j['sheet_dispatch'], 'na')
        patch(sheet='ordered')
        self.assertFalse(j['archived'])
        self.assertEqual(j['sheet_dispatch'], 'waiting')

    def test_sheet_can_ship_first(self):
        c = self.login()
        j = self.create(c, sheet='done', sheet_dispatch='done')
        self.assertFalse(j['archived'])
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'dispatch': 'done'}, c)
        self.assertEqual(status, 200)
        self.assertTrue(j['archived'])

    def test_mixed_sheet_types_ship_independently(self):
        c = self.login()
        j = self.create(c, sheet='awaiting_paint', raw_sheet='done')
        self.assertEqual(j['raw_sheet_dispatch'], 'waiting')
        def patch(**values):
            nonlocal j
            status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], **values}, c)
            self.assertEqual(status, 200, j)
        patch(raw_sheet_dispatch='done', dispatch='done')
        self.assertFalse(j['archived'])
        self.assertEqual(j['sheet'], 'awaiting_paint')
        self.assertEqual(j['raw_sheet'], 'done')
        patch(sheet='painting')
        self.assertEqual(j['raw_sheet_dispatch'], 'done')
        patch(sheet='done', sheet_dispatch='done')
        self.assertTrue(j['archived'])
        patch(raw_sheet_dispatch='waiting')
        self.assertFalse(j['archived'])
        patch(raw_sheet='na')
        self.assertTrue(j['archived'])
        self.assertEqual(j['raw_sheet_dispatch'], 'na')

    def test_raw_sheet_has_no_painting_step(self):
        c = self.login()
        j = self.create(c, raw_sheet='ordered')
        status, _, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'raw_sheet': 'painting'}, c)
        self.assertEqual(status, 400)
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {'version': j['version'], 'raw_sheet': 'active'}, c)
        self.assertEqual(status, 200)
        self.assertEqual(j['raw_sheet'], 'active')
        self.assertEqual(j['sheet'], 'na')

    def test_sheet_manufacturing_and_paper_dates(self):
        c = self.login()
        j = self.create(c, sheet='manufacturing', raw_sheet='manufacturing',
                        sheet_papers_date='2026-11-10', raw_sheet_papers_date='2026-11-12')
        self.assertEqual(j['sheet'], 'manufacturing')
        self.assertEqual(j['raw_sheet'], 'manufacturing')
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'sheet': 'painting', 'raw_sheet': 'done'}, c)
        self.assertEqual(status, 200)
        self.assertEqual(j['sheet_papers_date'], '2026-11-10')
        self.assertEqual(j['raw_sheet_papers_date'], '2026-11-12')
        for value in ('2026-02-30', '13.11.2026', 123):
            self.assertEqual(self.request('PATCH', '/api/jobs/' + j['id'], {
                'version': j['version'], 'sheet_papers_date': value}, c)[0], 400)
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'sheet_papers_date': '2026-11-09'}, c)
        self.assertEqual(status, 200)
        events = self.request('GET', '/api/jobs/' + j['id'] + '/history', cookie=c)[1]['events']
        self.assertEqual(events[0]['field'], 'sheet_papers_date')
        self.assertEqual(events[0]['new_value'], '2026-11-09')
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'sheet_papers_date': ''}, c)
        self.assertEqual(status, 200)
        self.assertEqual(j['raw_sheet_papers_date'], '2026-11-12')

    def test_manual_notes_and_small_material(self):
        c = self.login()
        j = self.create(c, notes='Preveri mero pred sestavljanjem', small_material='Vijaki M8 – 24 kos\nSidra – 12 kos')
        status, updated, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'small_material': 'Vijaki M8 – 24 kos\nSidra – 12 kos\nTesnilo – 20 m'}, c)
        self.assertEqual(status, 200)
        self.assertEqual(updated['notes'], j['notes'])
        self.assertIn('Tesnilo', updated['small_material'])
        self.assertEqual(updated['material'], j['material'])
        events = self.request('GET', '/api/jobs/' + j['id'] + '/history', cookie=c)[1]['events']
        self.assertEqual(events[0]['field'], 'small_material')
        self.assertEqual(events[0]['actor'], 'Test Damir')
        self.assertEqual(self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': updated['version'], 'small_material': 'x' * 4001}, c)[0], 400)
        status, cleared, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': updated['version'], 'small_material': ''}, c)
        self.assertEqual(status, 200)
        self.assertEqual(cleared['small_material'], '')

    def test_warehouse_preparation_and_changed_lists(self):
        leader, worker = self.login('Test Vodja'), self.login('Test Skladiščnik')
        j = self.create(leader, anchors='Sidra SDe 12 – 12 kos', small_material='Vijaki – 40 kos')
        self.assertEqual(j['anchors_status'], 'waiting')
        self.assertEqual(j['small_material_status'], 'waiting')
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'anchors_status': 'done', 'small_material_status': 'done'}, worker)
        self.assertEqual(status, 200)
        self.assertEqual(j['anchors'], 'Sidra SDe 12 – 12 kos')
        events = self.request('GET', '/api/jobs/' + j['id'] + '/history', cookie=leader)[1]['events']
        self.assertEqual({e['field'] for e in events if e['actor'] == 'Test Skladiščnik'}, {'anchors_status', 'small_material_status'})
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'anchors': 'Sidra SDe 12 – 14 kos', 'notes': 'Dopolnitev'}, leader)
        self.assertEqual(status, 200)
        self.assertEqual(j['anchors_status'], 'waiting')
        self.assertEqual(j['small_material_status'], 'done')
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'small_material': 'Vijaki – 50 kos'}, leader)
        self.assertEqual(status, 200)
        self.assertEqual(j['small_material_status'], 'waiting')
        self.assertEqual(self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'anchors_status': 'painting'}, worker)[0], 400)

    def test_caps_and_subcaps_preparation(self):
        c = self.login()
        blank = self.create(c)
        self.assertEqual(blank['caps_status'], 'na')
        self.assertEqual(blank['subcaps_status'], 'na')
        j = self.create(c, caps='Kape – 20 kos', subcaps='Podkape – 12 kos')
        self.assertEqual(j['caps_status'], 'waiting')
        self.assertEqual(j['subcaps_status'], 'waiting')
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'caps_status': 'done'}, c)
        self.assertEqual(status, 200)
        self.assertEqual(j['subcaps_status'], 'waiting')
        status, j, _ = self.request('PATCH', '/api/jobs/' + j['id'], {
            'version': j['version'], 'caps': 'Kape – 24 kos'}, c)
        self.assertEqual(status, 200)
        self.assertEqual(j['caps_status'], 'waiting')
        self.assertEqual(j['subcaps'], 'Podkape – 12 kos')
        events = self.request('GET', '/api/jobs/' + j['id'] + '/history', cookie=c)[1]['events']
        self.assertIn('caps_status', {e['field'] for e in events})
        status, blank, _ = self.request('PATCH', '/api/jobs/' + blank['id'], {
            'version': blank['version'], 'subcaps': 'Podkape – 10 kos'}, c)
        self.assertEqual(status, 200)
        self.assertEqual(blank['subcaps_status'], 'waiting')
        self.assertEqual(self.request('PATCH', '/api/jobs/' + blank['id'], {
            'version': blank['version'], 'caps': ['bad']}, c)[0], 400)

    def test_upgrade_preserves_legacy_orders(self):
        c = self.login()
        active = self.create(c, sheet='painting')
        complete = self.create(c, sheet='done', sheet_dispatch='done', dispatch='done')
        with sqlite3.connect(Path(self.temp.name) / 'delavnica.sqlite3') as db:
            for j in (active, complete):
                payload = json.loads(db.execute('SELECT payload FROM jobs WHERE id=?', (j['id'],)).fetchone()[0])
                del payload['sheet_dispatch']
                del payload['raw_sheet']
                del payload['raw_sheet_dispatch']
                del payload['small_material']
                del payload['anchors']
                del payload['anchors_status']
                del payload['small_material_status']
                del payload['sheet_papers_date']
                del payload['raw_sheet_papers_date']
                for key in ('caps', 'subcaps', 'caps_status', 'subcaps_status'):
                    del payload[key]
                db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), j['id']))
        self.process.terminate()
        self.process.communicate(timeout=10)
        self.start()
        jobs = {j['id']: j for j in self.request('GET', '/api/jobs', cookie=c)[1]['jobs']}
        self.assertEqual(jobs[active['id']]['sheet_dispatch'], 'waiting')
        self.assertEqual(jobs[active['id']]['sheet'], 'painting')
        self.assertFalse(jobs[active['id']]['archived'])
        self.assertEqual(jobs[complete['id']]['sheet_dispatch'], 'done')
        self.assertTrue(jobs[complete['id']]['archived'])
        self.assertEqual(jobs[active['id']]['raw_sheet'], 'na')
        self.assertEqual(jobs[complete['id']]['raw_sheet_dispatch'], 'na')
        self.assertEqual(jobs[active['id']]['small_material'], '')
        self.assertEqual(jobs[active['id']]['anchors_status'], 'waiting')
        self.assertEqual(jobs[complete['id']]['small_material_status'], 'na')
        self.assertEqual(jobs[active['id']]['sheet_papers_date'], '')
        self.assertEqual(jobs[complete['id']]['raw_sheet_papers_date'], '')
        self.assertEqual(jobs[active['id']]['caps_status'], 'na')
        self.assertEqual(jobs[complete['id']]['subcaps_status'], 'na')

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
        j = self.create(c, notes='Ohranjeno po zagonu', small_material='Vijaki – 40 kos', sheet_papers_date='2026-11-11')
        self.process.terminate()
        self.process.communicate(timeout=10)
        self.start()
        current = next(x for x in self.request('GET', '/api/jobs', cookie=c)[1]['jobs'] if x['id'] == j['id'])
        self.assertEqual(current['notes'], 'Ohranjeno po zagonu')
        self.assertEqual(current['small_material'], 'Vijaki – 40 kos')
        self.assertEqual(current['sheet_papers_date'], '2026-11-11')
        with sqlite3.connect(Path(self.temp.name) / 'delavnica.sqlite3') as db:
            self.assertIsNotNone(db.execute('SELECT id FROM events WHERE job_id=?', (j['id'],)).fetchone())


if __name__ == '__main__':
    unittest.main()
