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

    def installed_cli(self):
        """Use an actual installed wrapper/native/wheel tuple from hostile cwd."""
        import shutil
        extensions = self.root / "installed pack" / "_extensions"
        component = extensions / "math-exercise"
        component.mkdir(parents=True)
        for name in ("question-variants.py", "variant_resolver.py"):
            shutil.copy2(ROOT / "_extensions" / "math-exercise" / name, component / name)
        checker = extensions / "ctm-checkers"
        checker.mkdir()
        wheel = Path(os.environ["CTM_CHECKERS_WHEEL"])
        shutil.copy2(wheel, checker / wheel.name)
        shutil.copy2(wheel.parent / "checkers.json", checker / "checkers.json")
        shutil.copytree(Path(os.environ["CTM_VARIANTS_NATIVE"]), checker / "native-authoring")
        hostile = self.root / "hostile lesson cwd"
        hostile.mkdir()
        for name in ("json", "math", "ctm_variants", "ctm_checkers"):
            (hostile / (name + ".py")).write_text("raise RuntimeError('foreign lesson import')")
        environment = dict(os.environ)
        for key in ("CTM_VARIANTS_NATIVE", "CTM_CHECKERS_WHEEL"):
            environment.pop(key, None)
        command = [sys.executable, str(component / "question-variants.py"),
                   "--project", str(self.root), "--file", "lesson.qmd", "--label", "q"]
        def run(*arguments, ok=True):
            completed = subprocess.run([*command, *map(str, arguments)], cwd=hostile,
                capture_output=True, text=True, timeout=120, env=environment)
            if ok:
                self.assertEqual(completed.returncode, 0, completed.stderr)
                return json.loads(completed.stdout)
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(completed.stdout, "")
            return completed.stderr
        return run

    def test_installed_file_cli_generate_html_apply_download_and_current_source_refusal(self):
        cli = self.installed_cli()
        page = self.root / "review output" / "q.html"
        generated = cli("generate25more", "--html", page)
        self.assertEqual(generated["counters"]["tested"], 2)
        self.assertTrue(all(row["n"] is None for row in generated["records"]))
        self.assertIn("Variant review: q", page.read_text())
        self.assertIn('"path": "_variants/q.yml"', page.read_text())
        manifest = self.root / "_variants/q.yml"
        original = manifest.read_bytes()
        cli("review", "--html", page)
        self.assertEqual(manifest.read_bytes(), original, "review must remain read-only")
        selected = generated["records"][0]
        downloaded = {"version": 1, "action": "decide-many", "label": "q", "manifest": "_variants/q.yml",
            "baseHash": generated["baseHash"], "projectRoot": "/downloaded-context-is-not-authoritative",
            "source": "not current source", "options": {}, "records": [{"id": "forged-record-is-ignored"}],
            "decisions": [{"id": selected["id"], "hash": selected["hash"], "status": "approved"}]}
        request_file = self.root / "downloaded decisions.json"
        request_file.write_text(json.dumps(downloaded))
        decided = cli("apply", request_file)
        current = next(row for row in decided["records"] if row["id"] == selected["id"])
        self.assertEqual(current["context"]["variant"]["n"], 1)
        saved = manifest.read_bytes()
        self.assertIn("manifest changed", cli("apply", request_file, ok=False))
        self.assertEqual(manifest.read_bytes(), saved)
        downloaded["baseHash"] = decided["baseHash"]
        request_file.write_text(json.dumps(downloaded))
        self.write_source(self.request["source"].replace("_[{#a#}]", "_[{#a+1#}]"))
        self.assertIn("differs from current candidate", cli("apply", request_file, ok=False))
        self.assertEqual(manifest.read_bytes(), saved)

    def test_file_cli_requires_explicit_generation_and_keeps_html_away_from_source_and_history(self):
        cli = self.installed_cli()
        source = (self.root / "lesson.qmd").read_bytes()
        self.assertIn("run generate25more", cli("review", ok=False))
        for target in (self.root / "lesson.qmd", self.root / "_variants/q.yml"):
            self.assertIn("must not replace", cli("generate25more", "--html", target, ok=False))
            self.assertEqual((self.root / "lesson.qmd").read_bytes(), source)
            self.assertFalse((self.root / "_variants/q.yml").exists())

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

    def test_commented_and_raw_html_examples_are_not_authoritative_questions(self):
        example = "```{math-exercise}\n" + self.request["source"].replace("_[{#a#}]", "_[99]") + "\n```\n"
        hidden = "<!--\n" + example + "-->\n\n<pre>\n" + example + "</pre>\n\n"
        (self.root / "lesson.qmd").write_text(hidden + "```{math-exercise}\n" + self.request["source"] + "\n```\n")
        generated = self.call(self.request)
        self.assertEqual(generated["counters"]["tested"], 2)


if __name__ == "__main__":
    unittest.main()
