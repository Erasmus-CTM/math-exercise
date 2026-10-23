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
                self.generated = []
            def page(self, endpoint):
                return ("review " + endpoint).encode()
            def decide(self, value):
                if value.get("baseHash") != "current":
                    raise ValueError("stale lease")
                self.saved.append(value)
            def generate(self, value):
                if value.get('baseHash') != 'current':raise ValueError('stale lease')
                self.generated.append(value)
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

    def test_generate_requires_same_origin_and_original_lease(self):
        headers={'Origin':self.origin,'Content-Type':'application/json'}
        value={'action':'generate25more','baseHash':'current'}
        self.assertEqual(self.call('POST',value=value)[0],403)
        self.assertEqual(self.call('POST',headers=headers,value=dict(value,baseHash='stale'))[0],409)
        self.assertEqual(self.backend.generated,[])
        self.assertEqual(self.call('POST',headers=headers,value=value)[0],200)
        self.assertEqual(self.backend.generated,[value])

    def test_real_backend_only_forwards_lease_and_decisions_to_fixed_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "lesson.qmd").write_text("question")
            review = review_server.Review(root, "lesson.qmd", "q")
            self.addCleanup(review.preview_directory.cleanup)
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
            generated=[]
            review.run=lambda *args:generated.append(args)
            review.generate({'action':'generate25more','baseHash':'original'})
            self.assertEqual(generated,[('generate25more','--base-hash','original')])
            with self.assertRaises(ValueError):review.generate({'action':'generate25more','baseHash':'original','records':[]})
            with self.assertRaises((ValueError, OSError)):
                review_server.Review(root, "../outside", "q")
            with self.assertRaises(ValueError):
                review_server.Review(root, "lesson.qmd", "../q")

class PreviewTests(unittest.TestCase):
    def test_static_preview_routes_cannot_read_source_or_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'lesson.qmd').write_text('source')
            review=review_server.Review(root,'lesson.qmd','q')
            self.addCleanup(review.preview_directory.cleanup)
            output=root/'generated';output.mkdir();(output/'index.html').write_text('actual student page')
            (output/'asset.js').write_text('actual script')
            (output/'escape').symlink_to(root/'lesson.qmd')
            review.preview_choices={'slug':('actual-id',['default','nb'])}
            calls=[]
            review.render_student=lambda identifier,language:(calls.append((identifier,language)) or output)
            self.assertEqual(review.preview('slug/nb/index.html')[0],b'actual student page')
            self.assertEqual(review.preview('slug/nb/asset.js')[0],b'actual script')
            self.assertEqual(calls,[('actual-id','nb')])
            for route in ('slug/nb/../lesson.qmd','slug/nb/%2e%2e/lesson.qmd','slug/nb/escape','unknown/nb/index.html','slug/en/index.html','slug/default/asset.js'):
                with self.assertRaises(ValueError,msg=route):review.preview(route)

    def test_student_preview_refuses_stale_card_hash_lease_and_source(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'lesson.qmd').write_text('source');(root/'_variants').mkdir();(root/'_variants/q.yml').write_text('{}')
            review=review_server.Review(root,'lesson.qmd','q');self.addCleanup(review.preview_directory.cleanup)
            response={'records':[{'id':'candidate','hash':'current'}],'baseHash':'current-lease'}
            review.run=lambda *args:SimpleNamespace(stdout=json.dumps(response))
            review.source_payload=lambda:{'source':'current source'}
            with self.assertRaisesRegex(ValueError,'changed; rebuild'):
                review.render_student('candidate','default','old-hash','current-lease')
            with self.assertRaisesRegex(ValueError,'changed; rebuild'):
                review.render_student('candidate','default','current','old-lease')
            sources=iter([{'source':'old source'},{'source':'new source'}]);review.source_payload=lambda:next(sources)
            with self.assertRaisesRegex(ValueError,'changed while rendering'):
                review.render_student('candidate','default','current','current-lease')
            self.assertEqual((root/'_variants/q.yml').read_text(),'{}')

    def test_render_supervisor_limits_time_and_output(self):
        import os,sys
        with tempfile.TemporaryDirectory() as directory:
            for source,limits,expected in [
                ('import time;time.sleep(10)',{'timeout':.15},'time budget'),
                ('import os,time;os.write(2,b"x"*100000);time.sleep(10)',{'output_limit':1024},'output budget')]:
                with self.assertRaisesRegex(ValueError,expected):
                    review_server.Review.render_command([sys.executable,'-c',source],directory,os.environ,**limits)


if __name__ == "__main__":
    unittest.main()
