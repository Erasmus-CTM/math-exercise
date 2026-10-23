#!/usr/bin/env python3
"""One-question, token-bound loopback review; native wrapper owns all writes."""
import sys
if __name__ == "__main__" and not sys.flags.isolated:
    import os
    os.execv(sys.executable, [sys.executable, "-I", __file__] + sys.argv[1:])

import argparse
import http.server
import json
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import webbrowser

LIMIT = 1024 * 1024


class Review:
    def __init__(self, project, source, label):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", label) or ".." in label:
            raise ValueError("label must be a safe manifest filename")
        self.project = str(Path(project).resolve(strict=True))
        source_path = (Path(self.project) / source).resolve(strict=True)
        self.source = source_path.relative_to(self.project).as_posix()
        if not source_path.is_file():
            raise ValueError("source must be a project file")
        self.label = label
        self.manifest = "_variants/" + label + ".yml"
        self.wrapper = Path(__file__).with_name("question-variants.py")

    def run(self, *arguments):
        result = subprocess.run([sys.executable, "-I", str(self.wrapper), "--project", self.project,
            "--file", self.source, "--label", self.label, *map(str, arguments)],
            cwd=self.wrapper.parent, capture_output=True, timeout=330)
        if result.returncode:
            raise ValueError(result.stderr.decode("utf-8", "replace")[-8000:] or "native review failed")
        return result

    def page(self, endpoint):
        with tempfile.TemporaryDirectory(prefix="ctm-review-") as directory:
            output = Path(directory) / "review.html"
            self.run("review", "--html", output, "--connected-endpoint", endpoint)
            return output.read_bytes()

    def decide(self, value):
        if (type(value) is not dict or set(value) != {"baseHash", "decisions"}
                or not isinstance(value["baseHash"], str) or not isinstance(value["decisions"], list)
                or not value["decisions"]):
            raise ValueError("expected the current lease and a nonempty decision batch")
        request = dict(value, version=1, action="decide-many", label=self.label, manifest=self.manifest)
        with tempfile.TemporaryDirectory(prefix="ctm-review-") as directory:
            path = Path(directory) / "decisions.json"
            path.write_text(json.dumps(request, allow_nan=False), encoding="utf-8")
            # apply reconstructs options and records from the current source,
            # validates the whole batch, then performs one leased atomic write.
            self.run("apply", path)


def server(review, port=0):
    token = secrets.token_urlsafe(32)
    route = "/" + token + "/"

    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *args):
            pass  # Do not copy the capability token into request logs.

        def reply(self, code, body, content_type="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def valid(self, write=False):
            origin = "http://127.0.0.1:" + str(self.server.server_port)
            if (self.headers.get_all("Host") != [origin[7:]] or self.path != route
                    or (write and self.headers.get_all("Origin") != [origin])
                    or (not write and self.headers.get("Origin") not in (None, origin))):
                self.reply(403, b'{"error":"invalid local review origin or route"}')
                return False
            return True

        def do_GET(self):
            if not self.valid():
                return
            try:
                self.reply(200, review.page(route), "text/html; charset=utf-8")
            except Exception as error:
                self.reply(409, json.dumps({"error": str(error)}).encode())

        def do_POST(self):
            if not self.valid(write=True):
                return
            try:
                lengths = self.headers.get_all("Content-Length") or []
                if (len(lengths) != 1 or not lengths[0].isdigit()
                        or not 0 < int(lengths[0]) <= LIMIT
                        or self.headers.get("Transfer-Encoding") is not None
                        or self.headers.get("Content-Type") != "application/json"):
                    raise ValueError("expected bounded application/json request")
                raw = self.rfile.read(int(lengths[0]))
                if len(raw) != int(lengths[0]):
                    raise ValueError("incomplete request")
                review.decide(json.loads(raw))
                self.reply(200, b'{"saved":true}')
            except Exception as error:
                self.reply(409, json.dumps({"error": str(error)}).encode())

    instance = http.server.HTTPServer(("127.0.0.1", port), Handler)
    instance.review_url = "http://127.0.0.1:" + str(instance.server_port) + route
    return instance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--file", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    review = Review(args.project, args.file, args.label)
    with server(review, args.port) as instance:
        print("Connected local variant review: " + instance.review_url, flush=True)
        print("Stop with Ctrl-C. Decisions use the canonical current-source validator; no files are watched.", flush=True)
        if not args.no_browser:
            webbrowser.open(instance.review_url)
        try:
            instance.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
