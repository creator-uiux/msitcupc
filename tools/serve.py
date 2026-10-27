"""A threaded static file server for the browser test suites.

`python -m http.server` handles one request at a time, so a page that loads a
dozen scripts queues them and the browser eventually gives up waiting, which
shows up as "Could not load script" in the page tests.  This serves the same
directory with a thread per request.

    python tools/serve.py PORT [DIRECTORY]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the test output clean

    def end_headers(self):
        # no caching, so a rewritten file is never served stale
        self.send_header("Cache-Control", "no-store")
        SimpleHTTPRequestHandler.end_headers(self)


class Server(ThreadingHTTPServer):
    # The default backlog is 5.  A page opens a dozen connections at once, and
    # the gallery page opens two whole applications inside iframes, so the
    # burst overflows the queue and the browser reports "Could not load
    # script".  A deep queue absorbs the burst instead of dropping it.
    request_queue_size = 256
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.getcwd()
    Handler.directory = root
    httpd = Server(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
