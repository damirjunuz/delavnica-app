"""Shared workshop tracker. Python 3.12+, standard library only."""
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).parent
DATA = Path(os.environ.get('DATA_DIR', '/data'))
PASSWORD = os.environ.get('APP_PASSWORD', '')
ORIGIN = os.environ.get('APP_ORIGIN', '').rstrip('/')
SECURE = not ORIGIN.startswith('http://localhost:') and not ORIGIN.startswith('http://127.0.0.1:')
FIELDS = {
    'documentation': ['waiting', 'active', 'done', 'blocked'],
    'material': ['waiting', 'ordered', 'done', 'blocked'],
    'cutting': ['waiting', 'active', 'done', 'blocked', 'na'],
    'machining': ['waiting', 'active', 'done', 'blocked', 'na'],
    'assembly': ['waiting', 'active', 'done', 'blocked', 'na'],
    'packing': ['waiting', 'active', 'done', 'blocked', 'na'],
    'sheet': ['waiting', 'ordered', 'awaiting_paint', 'painting', 'done', 'blocked', 'na'],
    'dispatch': ['waiting', 'done', 'blocked'],
    'sheet_dispatch': ['waiting', 'done', 'blocked', 'na'],
    'raw_sheet': ['waiting', 'ordered', 'active', 'done', 'blocked', 'na'],
    'raw_sheet_dispatch': ['waiting', 'done', 'blocked', 'na'],
}
LABELS = {'documentation': 'Dokumentacija', 'material': 'Material', 'cutting': 'Razrez',
          'machining': 'Obdelava', 'assembly': 'Sestavljanje', 'packing': 'Pakiranje',
          'sheet': 'Barvana pločevina', 'raw_sheet': 'Surova pločevina', 'dispatch': 'Odprema fasade',
          'sheet_dispatch': 'Odprema barvane pločevine', 'raw_sheet_dispatch': 'Odprema surove pločevine', 'code': 'Nalog', 'title': 'Objekt',
          'due': 'Rok', 'owner': 'Odgovorna oseba', 'notes': 'Opombe', 'small_material': 'Drobni material', 'archived': 'Arhiv'}
STATUS = {'waiting': 'Čaka', 'active': 'V delu', 'done': 'Končano', 'blocked': 'Zastoj',
          'ordered': 'Naročeno', 'awaiting_paint': 'Čaka barvanje', 'painting': 'Na barvanju', 'na': 'Ni potrebno'}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def connect():
    c = sqlite3.connect(DATA / 'delavnica.sqlite3', timeout=15)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c


def init():
    if len(PASSWORD) < 12:
        raise SystemExit('APP_PASSWORD mora vsebovati vsaj 12 znakov.')
    if not re.fullmatch(r'https?://[^/]+', ORIGIN):
        raise SystemExit('Nastavi APP_ORIGIN, npr. https://delavnica.dservis.si')
    DATA.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL,
          updated TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
          actor TEXT NOT NULL, at TEXT NOT NULL, field TEXT NOT NULL,
          old_value TEXT NOT NULL, new_value TEXT NOT NULL,
          FOREIGN KEY(job_id) REFERENCES jobs(id));
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, actor TEXT NOT NULL, expires REAL NOT NULL,
          password_tag TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (at REAL NOT NULL);
        ''')
        # Keep previous completed orders completed; active orders get a separate pending shipment.
        for row in c.execute('SELECT * FROM jobs').fetchall():
            values = json.loads(row['payload'])
            changed = False
            if 'sheet_dispatch' not in values:
                values['sheet_dispatch'] = ('na' if values['sheet'] == 'na' else
                                            'done' if values['archived'] and values['dispatch'] == 'done' else 'waiting')
                changed = True
            for field in ('raw_sheet', 'raw_sheet_dispatch'):
                if field not in values:
                    values[field] = 'na'
                    changed = True
            if 'small_material' not in values:
                values['small_material'] = ''
                changed = True
            if changed:
                c.execute('UPDATE jobs SET payload=?,version=version+1 WHERE id=?', (json.dumps(values), row['id']))


def fully_shipped(values):
    return values['dispatch'] == 'done' and all(
        values.get(stage, 'na') == 'na' or values.get(shipping, 'na') == 'done'
        for stage, shipping in (('sheet', 'sheet_dispatch'), ('raw_sheet', 'raw_sheet_dispatch')))


def shipment_patch(values, patch):
    """Derive shipping state without discarding a partially delivered order."""
    result = {**values, **patch}
    for stage, shipping in (('sheet', 'sheet_dispatch'), ('raw_sheet', 'raw_sheet_dispatch')):
        if result[stage] == 'na' and result.get(shipping) != 'na':
            patch[shipping] = 'na'
        elif result[stage] != 'na' and result.get(shipping, 'na') == 'na':
            patch[shipping] = 'waiting'
    result.update(patch)
    if patch.get('archived') is False and values.get('archived') and fully_shipped(values):
        patch.setdefault('dispatch', 'waiting')
        result.update(patch)
    if patch.get('archived') is True and not fully_shipped({**values, **patch}):
        raise Problem(400, 'Nalog ostane aktiven, dokler nista odpremljeni fasada in vsa potrebna pločevina.')
    if {'dispatch', 'sheet_dispatch', 'sheet', 'raw_sheet', 'raw_sheet_dispatch'} & patch.keys():
        patch['archived'] = fully_shipped(result)
    return patch


def job(row):
    return {**json.loads(row['payload']), 'id': row['id'], 'version': row['version'],
            'updated': row['updated'], 'created': row['created']}


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def validate(data, create=False):
    if not isinstance(data, dict):
        raise Problem(400, 'Neveljavni podatki.')
    allowed = set(FIELDS) | {'code', 'title', 'due', 'owner', 'notes', 'small_material', 'archived'}
    if set(data) - allowed:
        raise Problem(400, 'Neznano polje.')
    for key, value in data.items():
        if key in FIELDS:
            if value not in FIELDS[key]:
                raise Problem(400, 'Neveljaven status.')
        elif key == 'archived':
            if type(value) is not bool:
                raise Problem(400, 'Neveljaven arhiv.')
        else:
            limit = 4000 if key in ('notes', 'small_material') else 160
            if not isinstance(value, str) or len(value) > limit:
                raise Problem(400, 'Predolgo ali neveljavno besedilo.')
            data[key] = value.strip()
    for key in ('code', 'title'):
        if (create or key in data) and not data.get(key):
            raise Problem(400, 'Vpiši oznako naloga in objekt.')
    if data.get('due'):
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', data['due']):
                raise ValueError()
            dt.date.fromisoformat(data['due'])
        except ValueError:
            raise Problem(400, 'Neveljaven datum.')
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Do not log credentials, cookies, request bodies or query strings.
        print('%s %s' % (self.command, self.path.split('?')[0]), flush=True)

    def send(self, status, obj=None, cookie=None, raw=None, mime='application/json; charset=utf-8'):
        content = raw if raw is not None else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(content)

    def body(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 32768:
                raise ValueError()
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError()
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeDecodeError):
            raise Problem(400, 'Neveljaven zahtevek.')

    def session(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            token = jar['session'].value
        except (KeyError, cookies.CookieError):
            raise Problem(401, 'Najprej se prijavi.')
        digest = hashlib.sha256(token.encode()).hexdigest()
        with connect() as c:
            row = c.execute('SELECT * FROM sessions WHERE token=? AND expires>?', (digest, time.time())).fetchone()
        if not row or row['password_tag'] != hashlib.sha256(PASSWORD.encode()).hexdigest():
            raise Problem(401, 'Prijava je potekla. Prijavi se znova.')
        return row['actor'], digest

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            if path == '/health':
                with connect() as c:
                    c.execute('SELECT 1 FROM jobs LIMIT 1')
                return self.send(200, {'ok': True})
            files = {'/': ('index.html', 'text/html; charset=utf-8'),
                     '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                     '/style.css': ('style.css', 'text/css; charset=utf-8')}
            if path in files:
                name, mime = files[path]
                return self.send(200, raw=(ROOT / 'static' / name).read_bytes(), mime=mime)
            actor, _ = self.session()
            if path == '/api/me':
                return self.send(200, {'actor': actor})
            if path == '/api/jobs':
                with connect() as c:
                    rows = c.execute('SELECT * FROM jobs ORDER BY updated DESC').fetchall()
                return self.send(200, {'jobs': [job(r) for r in rows]})
            m = re.fullmatch(r'/api/jobs/([a-f0-9]{24})/history', path)
            if m:
                with connect() as c:
                    rows = c.execute('SELECT actor, at, field, old_value, new_value FROM events WHERE job_id=? ORDER BY id DESC LIMIT 300', (m[1],)).fetchall()
                return self.send(200, {'events': [dict(r) for r in rows]})
            raise Problem(404, 'Ni najdeno.')
        except Problem as p:
            self.send(p.status, {'error': p.message})
        except Exception:
            self.send(500, {'error': 'Napaka strežnika. Poskusi znova.'})

    def do_POST(self):
        self.mutate()

    def do_PATCH(self):
        self.mutate()

    def mutate(self):
        try:
            if self.headers.get('Origin') != ORIGIN:
                raise Problem(403, 'Neveljaven izvor zahtevka.')
            path = urlsplit(self.path).path
            data = self.body()
            if path == '/api/login' and self.command == 'POST':
                actor, password = data.get('actor'), data.get('password')
                if not isinstance(actor, str) or not 2 <= len(actor.strip()) <= 60 or not isinstance(password, str):
                    raise Problem(400, 'Vpiši svoje ime in geslo.')
                # Shared password; audit names are self-reported, not verified identities.
                with connect() as c:
                    c.execute('BEGIN IMMEDIATE')
                    c.execute('DELETE FROM login_attempts WHERE at<?', (time.time() - 300,))
                    count = c.execute('SELECT count(*) FROM login_attempts').fetchone()[0]
                    if count >= 30:
                        raise Problem(429, 'Preveč poskusov prijave. Počakaj pet minut.')
                    if not hmac.compare_digest(password.encode(), PASSWORD.encode()):
                        c.execute('INSERT INTO login_attempts VALUES (?)', (time.time(),))
                        c.commit()
                        raise Problem(401, 'Napačno geslo.')
                    token = secrets.token_urlsafe(32)
                    c.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
                    c.execute('INSERT INTO sessions VALUES (?,?,?,?)', (
                        hashlib.sha256(token.encode()).hexdigest(), actor.strip(), time.time() + 604800,
                        hashlib.sha256(PASSWORD.encode()).hexdigest()))
                cookie = f'session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800' + ('; Secure' if SECURE else '')
                return self.send(200, {'actor': actor.strip()}, cookie=cookie)
            actor, digest = self.session()
            if path == '/api/logout' and self.command == 'POST':
                with connect() as c:
                    c.execute('DELETE FROM sessions WHERE token=?', (digest,))
                return self.send(200, {'ok': True}, cookie='session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + ('; Secure' if SECURE else ''))
            if path == '/api/jobs' and self.command == 'POST':
                values = {k: 'waiting' for k in FIELDS}
                values.update({'code': '', 'title': '', 'due': '', 'owner': '', 'notes': '', 'small_material': '', 'archived': False, 'sheet': 'na', 'sheet_dispatch': 'na', 'raw_sheet': 'na', 'raw_sheet_dispatch': 'na'})
                values.update(validate(data, create=True))
                values.update(shipment_patch(values, {k: values[k] for k in ('sheet', 'sheet_dispatch', 'raw_sheet', 'raw_sheet_dispatch', 'dispatch')}))
                uid, stamp = secrets.token_hex(12), now()
                with connect() as c:
                    c.execute('INSERT INTO jobs VALUES (?,?,?,?,?)', (uid, 1, json.dumps(values), stamp, stamp))
                    c.execute('INSERT INTO events(job_id,actor,at,field,old_value,new_value) VALUES (?,?,?,?,?,?)',
                              (uid, actor, stamp, 'created', '', values['code']))
                    result = job(c.execute('SELECT * FROM jobs WHERE id=?', (uid,)).fetchone())
                return self.send(201, result)
            m = re.fullmatch(r'/api/jobs/([a-f0-9]{24})', path)
            if m and self.command == 'PATCH':
                version = data.pop('version', None)
                if type(version) is not int:
                    raise Problem(400, 'Manjka različica naloga.')
                patch = validate(data)
                with connect() as c:
                    c.execute('BEGIN IMMEDIATE')
                    row = c.execute('SELECT * FROM jobs WHERE id=?', (m[1],)).fetchone()
                    if not row:
                        raise Problem(404, 'Nalog ne obstaja.')
                    if row['version'] != version:
                        raise Problem(409, 'Nalog je medtem spremenil sodelavec. Osveži podatke in ponovi spremembo.')
                    values = json.loads(row['payload'])
                    patch = shipment_patch(values, patch)
                    stamp = now()
                    for field, value in patch.items():
                        old = values[field]
                        if old != value:
                            c.execute('INSERT INTO events(job_id,actor,at,field,old_value,new_value) VALUES (?,?,?,?,?,?)',
                                      (m[1], actor, stamp, field, str(old), str(value)))
                            values[field] = value
                    c.execute('UPDATE jobs SET payload=?,version=version+1,updated=? WHERE id=?', (json.dumps(values), stamp, m[1]))
                    result = job(c.execute('SELECT * FROM jobs WHERE id=?', (m[1],)).fetchone())
                return self.send(200, result)
            raise Problem(404, 'Ni najdeno.')
        except Problem as p:
            self.send(p.status, {'error': p.message})
        except sqlite3.OperationalError:
            self.send(503, {'error': 'Podatkovna zbirka je trenutno zasedena. Poskusi znova.'})
        except Exception:
            self.send(500, {'error': 'Sprememba ni bila potrjena. Osveži in preveri stanje pred ponovitvijo.'})


if __name__ == '__main__':
    init()
    server = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '3100'))), Handler)
    server.daemon_threads = True
    print('Delavnica je pripravljena.', flush=True)
    server.serve_forever()
