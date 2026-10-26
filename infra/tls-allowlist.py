#!/usr/bin/env python3
"""Allow Caddy on-demand TLS certs only for <sub>.<this-domain> hostnames.

Caddy's on_demand_tls asks this service before issuing a cert; a 200 means
"allow", anything else means "deny". Change DOMAIN_SUFFIX to your own domain
(scripts/host-setup.sh does this automatically).
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import re

DOMAIN_SUFFIX = "dukanbot.website"

ALLOWED = re.compile(r"^[a-z0-9-]+\." + re.escape(DOMAIN_SUFFIX) + r"$")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        domain = qs.get("domain", [""])[0]
        self.send_response(200 if ALLOWED.match(domain) else 403)
        self.end_headers()

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", 8089), Handler).serve_forever()
