"""Serve src/ on http://localhost:8765 with UTF-8 content types.

python -m http.server sends scripts as bare text/javascript, and a browser then decodes them
with whatever charset it guessed, which mangles the metre signs and middle dots in the ledger.
"""
import functools, http.server, os, sys
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
