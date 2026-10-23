"""Installed native wrapper checks; set CTM_VARIANTS_NATIVE/CTM_CHECKERS_WHEEL."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "_extensions/math-exercise/question-variants.py"


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        # These names must never be imported from the lesson working directory.
        (self.root / "ctm_variants.py").write_text("raise RuntimeError('hostile lesson import')")
        (self.root / "ctm_checkers.py").write_text("raise RuntimeError('hostile checker import')")
        self.request = {"version": 1, "action": "generate", "source": "#| label: q\n#| variables: |\n#|   a = pick([1, 2])\n#| field-labels: Answer\n#| note: a={#a#}\n_[{#a#}]",
            "question": "_[{#a#}]", "options": {"label": "q", "variables": "a = pick([1, 2])", "field-labels": "Answer", "note": "a={#a#}"},
            "projectRoot": str(self.root), "file": "lesson.qmd", "label": "q", "manifest": "_variants/q.yml",
            "approval": "required", "renderMode": "review", "baseHash": None}
        self.write_source(self.request["source"])

    def write_source(self, source):
        (self.root / "lesson.qmd").write_text("```{math-exercise}\n" + source + "\n```\n")

    def call(self, payload, *, ok=True, environment=None):
        completed = subprocess.run([sys.executable, str(WRAPPER), "--stdin"], cwd=self.root,
            input=json.dumps(payload), capture_output=True, text=True, timeout=120,
            env=environment or dict(os.environ))
        if ok:
            self.assertEqual(completed.returncode, 0, completed.stderr)
            return json.loads(completed.stdout)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, "")
        return completed.stderr

    def test_installed_generate_decide_publish_and_stale_write(self):
        generated = self.call(self.request)
        self.assertEqual(generated["counters"]["tested"], 2)
        self.assertTrue(generated["counters"]["exhausted"])
        self.assertTrue(all(row["context"]["variant"] is None for row in generated["records"]))
        target = self.root / "_variants/q.yml"
        before = target.read_bytes()
        selected = generated["records"][0]
        decision = dict(self.request, action="decide", baseHash=generated["baseHash"],
            decision={"id": selected["id"], "hash": selected["hash"], "status": "approved"})
        decided = self.call(decision)
        row = next(row for row in decided["records"] if row["id"] == selected["id"])
        self.assertEqual(row["context"]["variant"], {"n": 1, "id": row["id"], "hash": row["hash"]})
        published = self.call(dict(self.request, action="resolve", renderMode="publish"))
        self.assertEqual(published["deployableIds"], [row["id"]])
        self.assertTrue(published["warnings"])
        after = target.read_bytes()
        self.assertNotEqual(before, after)
        self.assertIn("manifest changed", self.call(decision, ok=False))
        self.assertEqual(target.read_bytes(), after)

    def test_preview_is_read_only_required_publish_stops_optional_warns(self):
        self.call(dict(self.request, renderMode="publish"), ok=False)
        self.assertFalse((self.root / "_variants/q.yml").exists())
        opened_new = self.call(dict(self.request, action="resolve", approval="optional", renderMode="publish"))
        self.assertEqual(len(opened_new["deployableIds"]), 2)
        self.assertFalse((self.root / "_variants/q.yml").exists())
        preview = self.call(dict(self.request, action="resolve", renderMode="preview"))
        self.assertEqual(len(preview["records"]), 2)
        self.assertFalse((self.root / "_variants/q.yml").exists())
        self.call(self.request)
        self.assertIn("at least one current approved", self.call(dict(self.request, action="resolve", renderMode="publish"), ok=False))
        opened = self.call(dict(self.request, action="resolve", approval="optional", renderMode="publish"))
        self.assertEqual(len(opened["deployableIds"]), 2)
        self.assertTrue(any("unapproved" in warning for warning in opened["warnings"]))

    def test_native_manifest_tamper_and_source_mismatch_stop_before_execution(self):
        import shutil
        native = Path(os.environ["CTM_VARIANTS_NATIVE"])
        copied = self.root / "native"
        shutil.copytree(native, copied)
        (copied / "ctm_variants/model.py").write_text("raise RuntimeError('tampered import')")
        error = self.call(self.request, ok=False, environment=dict(os.environ, CTM_VARIANTS_NATIVE=str(copied)))
        self.assertIn("differs from its manifest", error)
        error = self.call(dict(self.request, source="#| variables: |\n#|   a = 99"), ok=False)
        self.assertIn("differs from the component-parsed", error)
        self.assertIn("differs from the component-parsed", self.call(dict(self.request, question="_[99]"), ok=False))
        self.assertFalse((self.root / "_variants/q.yml").exists())

    def test_decision_cannot_implicitly_generate_or_succeed_without_current_selection(self):
        error = self.call(dict(self.request, action="decide", decision={"id": "missing", "hash": "missing", "status": "approved"}), ok=False)
        self.assertIn("current candidate", error)
        self.assertFalse((self.root / "_variants/q.yml").exists())

    def test_total_supervisor_bounds_bootstrap_without_persisting(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("question_variants", WRAPPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        code, stdout, stderr = module.supervised(json.dumps(self.request).encode(), timeout=0.000001)
        self.assertEqual(code, 1)
        self.assertEqual(stdout, b"")
        self.assertIn(b"total native request time budget exceeded", stderr)
        self.assertFalse((self.root / "_variants/q.yml").exists())

    @unittest.skipIf(os.name == "nt", "POSIX process-group teardown proof")
    def test_supervisor_terminates_descendant_of_stalled_author_checker(self):
        import importlib.util
        import time
        spec = importlib.util.spec_from_file_location("question_variants", WRAPPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        marker = self.root / "child-pid"
        checker = "\n".join([
            "def check(response, symbols):", "    import subprocess, sys, time", "    from pathlib import Path",
            "    child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'])",
            "    Path(" + repr(str(marker)) + ").write_text(str(child.pid))", "    time.sleep(60)", "    return True"])
        options = dict(self.request["options"], mode="custom", checker=checker)
        source = self.request["source"].replace("_[{#a#}]", "#| mode: custom\n#| checker: |\n" +
            "\n".join("#|   " + line for line in checker.splitlines()) + "\n_[{#a#}]")
        payload = dict(self.request, options=options, source=source)
        self.write_source(source)
        code, stdout, stderr = module.supervised(json.dumps(payload).encode(), timeout=5)
        self.assertEqual(code, 1)
        self.assertIn(b"time budget exceeded", stderr)
        self.assertTrue(marker.is_file(), stderr.decode())
        pid = int(marker.read_text())
        stat = Path("/proc") / str(pid) / "stat"
        if stat.exists():
            self.assertEqual(stat.read_text().split()[2], "Z", "descendant is still running")
        self.assertFalse((self.root / "_variants/q.yml").exists())

    def test_downloaded_decision_resolves_current_file_and_rejects_changed_teacher(self):
        generated = self.call(self.request)
        selected = generated["records"][0]
        decision = dict(self.request, action="decide", baseHash=generated["baseHash"],
            sourceFile="lesson.qmd", decision={"id": selected["id"], "hash": selected["hash"], "status": "approved"})
        before = (self.root / "_variants/q.yml").read_bytes()
        self.write_source(self.request["source"].replace("_[{#a#}]", "_[{#a+1#}]"))
        self.assertIn("differs from current candidate", self.call(decision, ok=False))
        self.assertEqual((self.root / "_variants/q.yml").read_bytes(), before)

    def test_documentation_fence_does_not_define_an_authoritative_question(self):
        literal = "~~~~markdown\n```{math-exercise}\n" + self.request["source"].replace("_[{#a#}]", "_[99]") + "\n```\n~~~~\n"
        (self.root / "lesson.qmd").write_text(literal + "```{math-exercise}\n" + self.request["source"] + "\n```\n")
        generated = self.call(self.request)
        self.assertEqual(generated["counters"]["tested"], 2)


if __name__ == "__main__":
    unittest.main()
