# browser_override.py — Drop-in replacement for pebble_tool.util.browser
#
# Clay embeds the entire settings-page HTML (~100 KB) URL-encoded in the
# URL hash fragment.  This exceeds what VS Code Simple Browser (and many
# other lightweight browsers) can handle.
#
# This replacement extracts the HTML, injects the return_to callback URL,
# and serves it from a local HTTP endpoint (/config) so the URL stays
# short.  It also fixes a race condition in the original where
# webbrowser.open_new() was called before the HTTP server was listening.
#
# The run-emulator.sh script copies this file over the SDK's browser.py
# at runtime and restores the original on exit, so SDK upgrades are safe.

from six.moves import BaseHTTPServer
import logging
import os
import pyqrcode
import socket
import time
from six.moves.urllib import parse as urlparse
import webbrowser

from .phone_sensor import SENSOR_PAGE_HTML


logger = logging.getLogger("pebble_tool.util.browser")

class BrowserController(object):
    def __init__(self):
        self.port = None
        self._config_html = None

    def open_config_page(self, url, callback):
        self.port = port = self._choose_port()

        # In Codespaces the browser runs on the user's machine and cannot
        # reach localhost inside the Codespace.  Use the forwarded URL so
        # the browser can reach the callback server through port forwarding.
        codespace_name = os.environ.get('CODESPACE_NAME')
        forwarding_domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN')
        if codespace_name and forwarding_domain:
            base_url = 'https://{}-{}.{}'.format(codespace_name, port, forwarding_domain)
        else:
            base_url = 'http://localhost:{}'.format(port)

        return_to = base_url + '/close?'

        # When the URL uses the Clay S3 proxy (or similar), the entire config
        # page HTML is URL-encoded in the hash fragment.  These URLs can easily
        # exceed 100 KB which breaks VS Code Simple Browser and other
        # lightweight browsers.  Instead we extract the HTML, inject the
        # return_to URL, and serve it from the local callback server on /config.
        parsed = urlparse.urlparse(url)
        if parsed.fragment and len(parsed.fragment) > 256:
            html = urlparse.unquote(parsed.fragment)
            html = html.replace('$$RETURN_TO$$', return_to)
            self._config_html = html
            # Always use localhost for _browser_url so VS Code's $BROWSER
            # detects the port and auto-forwards it through Codespaces.
            self._browser_url = 'http://localhost:{}/config'.format(port)
            logger.info("Serving config page locally at %s", self._browser_url)
        else:
            self._browser_url = self.url_append_params(url, {'return_to': return_to})

        # serve_page creates the HTTP server *before* opening the browser,
        # avoiding a race where the browser hits the port before it is bound.
        self.serve_page(port, callback)

    def serve_page(self, port, callback):
        # This is an array so AppConfigHandler doesn't create an instance
        # variable when trying to set the state to False
        running = [True]
        config_html = self._config_html

        class AppConfigHandler(BaseHTTPServer.BaseHTTPRequestHandler):
            def do_GET(self):
                if '?' in self.path:
                    path, query = self.path.split('?', 1)
                else:
                    path, query = self.path, ''

                if path == '/close':
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"OK")
                    running[0] = False
                    callback(query)
                elif path == '/config' and config_html:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(config_html.encode('utf-8'))
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"Not Found")

        # Bind the port BEFORE opening the browser to avoid a race condition
        # where the browser requests the URL before the server is listening.
        server = BaseHTTPServer.HTTPServer(('', port), AppConfigHandler)

        # Print the URL prominently and open it in the browser.
        browser_url = getattr(self, '_browser_url', None)
        if browser_url:
            # For display purposes, show the Codespaces forwarded URL so the
            # user can click it directly from the terminal.
            codespace_name = os.environ.get('CODESPACE_NAME')
            forwarding_domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN')
            if codespace_name and forwarding_domain:
                display_url = 'https://{}-{}.{}/config'.format(codespace_name, port, forwarding_domain)
            else:
                display_url = browser_url
            print("\n" + "=" * 60)
            print("  Settings page: {}".format(display_url))
            print("=" * 60 + "\n")
            try:
                webbrowser.open_new(browser_url)
            except Exception as e:
                logger.warning("Could not open browser: %s", e)

        while running[0]:
            server.handle_request()

    def url_append_params(self, url, params):
        parsed = urlparse.urlparse(url, "http")
        query = parsed.query
        if parsed.query != '':
            query += '&'

        encoded_params = urlparse.urlencode(params)
        query += encoded_params
        return urlparse.urlunparse((parsed.scheme, parsed.netloc, parsed.path,
                                    parsed.params, query, parsed.fragment))

    def serve_sensor_page(self, pypkjs_port, port=None):
        controller = self
        self.port = port or self._choose_port()

        class SensorPageHandler(BaseHTTPServer.BaseHTTPRequestHandler):
            PERMITTED_PATHS = {'static/js/backbone-min.js',
                               'static/js/backbone-min.map',
                               'static/js/propeller.min.js',
                               'static/js/sensors.js',
                               'static/js/underscore-min.js',
                               'static/js/underscore-min.map',
                               'static/js/websocket.js',
                               'static/compass-arrow.png',
                               'static/compass-rose.png',
                               'static/stylesheets/normalize.min.css',
                               'static/stylesheets/sensors.css'}

            def do_HEAD(self):
                self.send_response(200)
                self.end_headers()

            def do_GET(self):
                requested_file = self.path.rsplit('/', 1)[1]
                file_path = self.path.lstrip('/')
                if requested_file == '':
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()
                    self.wfile.write(SENSOR_PAGE_HTML.format(
                        websocket_host="'{}'".format(controller._get_ip()),
                        websocket_port="'{}'".format(pypkjs_port)).encode())
                elif file_path in self.PERMITTED_PATHS:
                    try:
                        file_contents = open(os.path.join(
                            os.path.dirname(os.path.realpath(__file__)),
                            file_path))
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(file_contents.read().encode())
                    except IOError:
                        self.send_response(404)
                        self.end_headers()
                        self.wfile.write(b"Not Found")
                else:
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b"Forbidden")

            def log_request(self, code='-', size='-'):
                logger.debug("{} - - [{}] '{}' {} {}".format(
                    self.client_address[0], self.log_date_time_string(),
                    self.requestline, code, size))

        server = BaseHTTPServer.HTTPServer(('', self.port), SensorPageHandler)
        try:
            url = "http://{}:{}".format(self._get_ip(), server.server_port)
            url_code = pyqrcode.create(url)
            print((url_code.terminal(quiet_zone=1)))
            print("=" * 99)
            print(("Please scan the QR code or enter the following URL in "
                   "your mobile browser:\n{}".format(url)))
            print("=" * 99)
        except socket.error:
            print(("Unable to determine local IP address. Please browse to "
                   "port {} on this machine from your mobile "
                   "browser.".format(server.server_port)))

        print("\nUse Ctrl-C to stop sending sensor data to the emulator.\n")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Stopping...")
            server.server_close()
            time.sleep(2)  # Wait for WS connection to die between phone/QEMU

    def _choose_port(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('localhost', 0))
        addr, port = s.getsockname()
        s.close()
        return port

    @classmethod
    def _get_ip(cls):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        addr, port = s.getsockname()
        s.close()
        return addr
