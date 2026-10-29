import functools
import http.server
import json
import os
import sys
import threading
import time
import urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
FEED_URL = 'https://api.adsb.lol/v2/point/35.55/139.80/90'
FEED_PATH = '/adsb.json'
CACHE_S = 15
BACKOFF_S = 30
STALE_S = 120

_lock = threading.Lock()
_cache = {'at': 0.0, 'body': None, 'retry': 0.0}


def feed():
    with _lock:
        now = time.time()
        age = now - _cache['at']
        if _cache['body'] is not None and (age < CACHE_S or (now < _cache['retry'] and age < STALE_S)):
            return _cache['body']
        if now < _cache['retry']:
            raise RuntimeError('backing off')
        try:
            req = urllib.request.Request(FEED_URL, headers={'User-Agent': 'tokyo-observer-relay', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=15) as res:
                data = json.load(res)
        except Exception:
            _cache['retry'] = now + BACKOFF_S
            if _cache['body'] is not None and now - _cache['at'] < STALE_S:
                return _cache['body']
            raise
        body = json.dumps({'source': 'adsb.lol (ODbL)', 'now': data.get('now'), 'aircraft': data.get('ac') or []}).encode()
        _cache.update(at=now, body=body, retry=0.0)
        return body


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] != FEED_PATH:
            return super().do_GET()
        try:
            body = feed()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as ex:
            self.send_error(502, f'adsb.lol unavailable: {ex}')

    def log_message(self, fmt, *args):
        if self.path.split('?')[0] != FEED_PATH:
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    print(f'Tokyo Observer on http://localhost:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
