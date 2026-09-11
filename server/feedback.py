#!/usr/bin/env python3
"""Приёмник отзывов «По зеркалам»: POST /api/feedback -> Telegram.

Живёт на 127.0.0.1, наружу его выставляет nginx (limit_req, CORS, лимит тела).
Токен бота есть только здесь, в /etc/pozerkalam-feedback.env — в index.html он
не попадает никогда: страница отдаётся всем, а бот общий с проектом spark.

С РФ-хостинга api.telegram.org недоступен напрямую (замер: таймаут 15 с), поэтому
запросы идут через HTTPS_PROXY на боксе 194. Снимать эти переменные нельзя.
"""

import base64
import binascii
import json
import logging
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get('TG_TOKEN', '').strip()
CHAT_ID = os.environ.get('TG_CHAT_ID', '').strip()
PORT = int(os.environ.get('FB_PORT', '8787'))

MAX_BODY = 1024 * 1024
MIN_TEXT, MAX_TEXT = 10, 2000
MAX_CONTACT = 120
MAX_SHOT = 700 * 1024
RATE_N, RATE_WINDOW = 5, 600
TG_TIMEOUT = 20

KINDS = {'bug': '#баг', 'idea': '#идея', 'note': '#отзыв'}

log = logging.getLogger('feedback')


def safe(text):
    """Токен утекает в тексты исключений urllib через URL — вырезаем перед логом."""
    s = str(text)
    return s.replace(TOKEN, '<token>') if TOKEN else s


class Rate:
    def __init__(self):
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, ip):
        now = time.time()
        with self._lock:
            q = self._hits[ip]
            while q and now - q[0] > RATE_WINDOW:
                q.popleft()
            if len(q) >= RATE_N:
                return False
            q.append(now)
            if len(self._hits) > 4000:
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return True


rate = Rate()
outbox = queue.Queue(maxsize=200)


def tg(method, payload=None, body=None, content_type=None):
    url = 'https://api.telegram.org/bot%s/%s' % (TOKEN, method)
    if payload is not None:
        body = json.dumps(payload).encode()
        content_type = 'application/json'
    req = urllib.request.Request(url, data=body,
                                 headers={'Content-Type': content_type} if content_type else {})
    try:
        with urllib.request.urlopen(req, timeout=TG_TIMEOUT) as r:
            return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = ''
        try:
            detail = e.read().decode()[:400]
        except Exception:
            pass
        return False, 'http %s %s' % (e.code, safe(detail))
    except Exception as e:
        return False, safe('%s: %s' % (type(e).__name__, e))


def multipart(fields, filename, filedata):
    boundary = uuid.uuid4().hex
    chunks = []
    for k, v in fields.items():
        chunks.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                       % (boundary, k, v)).encode())
    chunks.append(('--%s\r\nContent-Disposition: form-data; name="photo"; filename="%s"\r\n'
                   'Content-Type: image/jpeg\r\n\r\n' % (boundary, filename)).encode())
    chunks.append(filedata)
    chunks.append(('\r\n--%s--\r\n' % boundary).encode())
    return b''.join(chunks), 'multipart/form-data; boundary=' + boundary


def compose(kind, text, contact, ctx):
    head = ['#позеркалам ' + KINDS.get(kind, KINDS['note'])]
    level = ctx.get('level')
    if level:
        li = ctx.get('li')
        gearbox = 'МКПП' if ctx.get('gearbox') == 'MT' else 'АКПП'
        head.append('Уровень %s · %s · %s' % (li + 1 if isinstance(li, int) else '?', level, gearbox))
    tech = []
    if ctx.get('build'):
        tech.append('сборка ' + str(ctx['build'])[:24])
    if ctx.get('screen'):
        dpr = ctx.get('dpr')
        tech.append('%s%s' % (ctx['screen'], '@%s' % dpr if dpr else ''))
    if ctx.get('q') is not None:
        tech.append('q%s' % ctx['q'])
    if ctx.get('gap'):
        try:
            tech.append('%.0f fps' % (1000.0 / float(ctx['gap'])))
        except (TypeError, ValueError, ZeroDivisionError):
            pass
    if ctx.get('mob'):
        tech.append('телефон')
    if tech:
        head.append(' · '.join(tech))
    if ctx.get('ua'):
        head.append(str(ctx['ua'])[:180])
    if contact:
        head.append('Контакт: ' + contact)
    return '\n'.join(head) + '\n\n' + text


def shot_bytes(shot):
    if not isinstance(shot, str) or not shot:
        return None
    raw = shot.split(',', 1)[1] if shot.startswith('data:') else shot
    if len(raw) > MAX_SHOT * 4 // 3 + 16:
        raise ValueError('снимок больше лимита')
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError('снимок не декодируется: %s' % e)


class Handler(BaseHTTPRequestHandler):
    server_version = 'pozerkalam-feedback'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        log.debug('%s %s', self.address_string(), fmt % args)

    def _reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ip(self):
        return self.headers.get('X-Real-IP') or self.client_address[0]

    def do_GET(self):
        if self.path.rstrip('/').endswith('health'):
            body = b'ok'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._reply(404, {'ok': False, 'err': 'not-found'})

    def do_POST(self):
        ip = self._ip()
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            log.warning('отбраковка ip=%s код=too-long длина=%s', ip, length)
            return self._reply(413, {'ok': False, 'err': 'too-long'})
        try:
            data = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(data, dict):
                raise ValueError('не объект')
        except Exception as e:
            log.warning('отбраковка ip=%s код=bad-json (%s)', ip, e)
            return self._reply(400, {'ok': False, 'err': 'bad-json'})

        # Ловушка для ботов: поле скрыто от человека, поэтому заполнить его может только
        # автозаполняющий скрипт. Отвечаем «ок», чтобы отправитель не подбирал обход.
        if str(data.get('hp') or '').strip():
            log.warning('honeypot ip=%s — отчёт выброшен', ip)
            return self._reply(200, {'ok': True})

        kind = data.get('kind') if data.get('kind') in KINDS else 'note'
        text = str(data.get('text') or '').strip()
        contact = str(data.get('contact') or '').strip()[:MAX_CONTACT]
        ctx = data.get('ctx') if isinstance(data.get('ctx'), dict) else {}
        dry = bool(data.get('dry'))

        if len(text) < MIN_TEXT:
            log.warning('отбраковка ip=%s код=short-text длина=%s', ip, len(text))
            return self._reply(400, {'ok': False, 'err': 'short-text'})
        if len(text) > MAX_TEXT:
            text = text[:MAX_TEXT]

        try:
            photo = shot_bytes(data.get('shot'))
        except ValueError as e:
            log.warning('снимок отброшен ip=%s: %s', ip, e)
            photo = None

        log.info('отчёт ip=%s вид=%s символов=%d уровень=%s снимок=%s dry=%s',
                 ip, kind, len(text), ctx.get('level'), 'да' if photo else 'нет', dry)

        if dry:
            return self._reply(200, {'ok': True, 'dry': True})
        if not rate.allow(ip):
            log.warning('отбраковка ip=%s код=rate', ip)
            return self._reply(429, {'ok': False, 'err': 'rate'})

        # Отдаём ответ сразу, а в Telegram шлём фоном: путь через прокси на 194 может
        # тянуться секундами, а браузеру важно знать, что отчёт принят, — не то, что он
        # уже долетел. Недоставленное всё равно останется в journal целиком.
        try:
            outbox.put_nowait((kind, compose(kind, text, contact, ctx), ctx, photo))
        except queue.Full:
            log.error('очередь отправки переполнена ip=%s — отчёт только в логе', ip)
            return self._reply(503, {'ok': False, 'err': 'busy'})

        return self._reply(200, {'ok': True})


def sender():
    while True:
        kind, message, ctx, photo = outbox.get()
        ok, res = tg('sendMessage', {'chat_id': CHAT_ID, 'text': message,
                                     'disable_web_page_preview': True})
        if ok:
            log.info('отправлено в telegram (вид=%s, снимок=%s)', kind, 'да' if photo else 'нет')
        else:
            # Отзыв игрока дороже доставки: текст остаётся в journal целиком,
            # его можно вычитать руками, когда канал починится.
            log.error('telegram отказал: %s | отчёт: %s', res, message.replace('\n', ' | '))
            outbox.task_done()
            continue
        if photo:
            caption = '#позеркалам %s · %s' % (KINDS.get(kind, ''), ctx.get('level') or 'уровень ?')
            body, ctype = multipart({'chat_id': CHAT_ID, 'caption': caption[:1024]},
                                    'shot.jpg', photo)
            ok2, res2 = tg('sendPhoto', body=body, content_type=ctype)
            if not ok2:
                log.error('снимок не ушёл: %s', res2)
        outbox.task_done()


def selfcheck():
    """Молчаливая смерть прокси на 194 выглядит как здоровый сервис — проверяем на старте."""
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or 'нет'
    # У tinyproxy на 194 включён BasicAuth, и логин с паролем стоят прямо в адресе.
    # Без маскировки они лежат открытым текстом в journal у всех, кто может его читать.
    proxy = re.sub(r'//[^/@]+@', '//<логин:пароль>@', proxy)
    ok, res = tg('getMe')
    if ok:
        log.info('telegram доступен через прокси %s: @%s', proxy,
                 (res.get('result') or {}).get('username'))
    else:
        log.error('telegram НЕДОСТУПЕН (прокси %s): %s — отчёты будут копиться в journal',
                  proxy, res)


def main():
    logging.basicConfig(level=logging.DEBUG, stream=sys.stdout,
                        format='%(asctime)s %(levelname)s %(message)s')
    if not TOKEN or not CHAT_ID:
        log.error('нет TG_TOKEN или TG_CHAT_ID в окружении — сервис не имеет смысла')
        return 1
    threading.Thread(target=selfcheck, daemon=True).start()
    threading.Thread(target=sender, daemon=True).start()
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    srv.daemon_threads = True
    log.info('слушаю 127.0.0.1:%d', PORT)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
