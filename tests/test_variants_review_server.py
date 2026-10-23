import importlib.util
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

MODULE = Path(__file__).resolve().parents[1] / "_extensions/math-exercise/variants-review.py"
spec = importlib.util.spec_from_file_location("review_server", MODULE)
review_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review_server)


class ServerTests(unittest.TestCase):
    def setUp(self):
        class Backend:
            def __init__(self):
                self.saved = []
            def page(self, endpoint):
                return ("review " + endpoint).encode()
            def decide(self, value):
                if value.get("baseHash") != "current":
                    raise ValueError("stale lease")
                self.saved.append(value)
        self.backend = Backend()
        self.server = review_server.server(self.backend)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.route = self.server.review_url[len(self.origin):]

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def call(self, method="GET", path=None, headers=None, value=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        self.addCleanup(connection.close)
        body = json.dumps(value) if value is not None else None
        connection.request(method, path or self.route, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.read(), dict(response.getheaders())

    def test_token_host_origin_and_no_file_routes(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        code, body, headers = self.call()
        self.assertEqual(code, 200)
        self.assertIn(self.route.encode(), body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        for path in ("/", "/_variants/q.yml", self.route + "../", self.route + "?x=1"):
            self.assertEqual(self.call(path=path)[0], 403)
        self.assertEqual(self.call(headers={"Host": "evil.test"})[0], 403)
        self.assertEqual(self.call(headers={"Origin": "https://evil.test"})[0], 403)

    def test_write_requires_exact_origin_json_and_fresh_lease(self):
        value = {"baseHash": "current", "decisions": [{"id": "a", "status": "approved"}]}
        self.assertEqual(self.call("POST", value=value)[0], 403)
        headers = {"Origin": self.origin, "Content-Type": "application/json"}
        self.assertEqual(self.call("POST", headers={**headers, "Origin": "null"}, value=value)[0], 403)
        self.assertEqual(self.call("POST", headers={**headers, "Content-Type": "text/plain"}, value=value)[0], 409)
        self.assertEqual(self.call("POST", headers={**headers, "Content-Length": str(review_server.LIMIT + 1)}, value=value)[0], 409)
        self.assertEqual(self.call("POST", headers={**headers, "Transfer-Encoding": "chunked"}, value=value)[0], 409)
        self.assertEqual(self.call("POST", headers=headers, value={**value, "baseHash": "stale"})[0], 409)
        self.assertEqual(self.backend.saved, [])
        self.assertEqual(self.call("POST", headers=headers, value=value)[0], 200)
        self.assertEqual(self.backend.saved, [value])

    def test_real_backend_only_forwards_lease_and_decisions_to_fixed_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "lesson.qmd").write_text("question")
            review = review_server.Review(root, "lesson.qmd", "q")
            captured = []
            def run(*args):
                self.assertEqual(args[0], "apply")
                captured.append(json.loads(Path(args[1]).read_text()))
            review.run = run
            value = {"baseHash": "lease", "decisions": [{"id": "a", "status": "approved"}]}
            review.decide(value)
            self.assertEqual(captured[0], dict(value, version=1, action="decide-many", label="q", manifest="_variants/q.yml"))
            for extra in ({"projectRoot": "/tmp"}, {"manifest": "outside.yml"}, {"records": []}):
                with self.assertRaises(ValueError):
                    review.decide(dict(value, **extra))
            with self.assertRaises((ValueError, OSError)):
                review_server.Review(root, "../outside", "q")
            with self.assertRaises(ValueError):
                review_server.Review(root, "lesson.qmd", "../q")


if __name__ == "__main__":
    unittest.main()
