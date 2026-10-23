"""One small actual tested readonly next-batch fixture, not a broad campaign."""
import copy
import json
import subprocess
import sys
from pathlib import Path
import runpy
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
module = runpy.run_path(str(ROOT / "_extensions/math-exercise/question-variants.py"), run_name="readonly_more_adapter")
module["install_imports"]()
from ctm_variants import history


class ReadonlyMoreTests(unittest.TestCase):
    def test_file_resolve_exports_exact_tested_context_without_history_write(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            source = "```{math-exercise}\n#| label: q\n#| variables: |\n#|   a = pick([2, 4])\n#| field-labels: Answer\n#| note: a={#a#}\n#| tests:\n#|   - name: exact authored answer\n#|     answers: [a/2]\n#|     expect: correct\n_[{@a/2@}]\n```\n"
            path = project / "lesson.qmd"
            path.write_text(source)
            result = subprocess.run([sys.executable, "-I", str(ROOT / "_extensions/math-exercise/question-variants.py"),
                "--project", directory, "--file", "lesson.qmd", "--label", "q", "resolve"],
                capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            response = json.loads(result.stdout)
            self.assertEqual(len(response["records"]), 2)
            self.assertIsNone(response["baseHash"])
            self.assertFalse((project / "_variants").exists())
            self.assertEqual(path.read_text(), source)
            from ctm_checkers.variants import decode_context
            for record in response["records"]:
                fields, variables, teacher, identity = decode_context(record["context"])
                self.assertEqual(fields, ["Answer"])
                self.assertEqual(teacher["Answer"], variables["a"] / 2)
                self.assertEqual(record["teacherInputs"]["Answer"], str(teacher["Answer"]))
                self.assertIsNone(identity)
                self.assertEqual(record["options"]["tests"][0]["answers"], ["a/2"])
                self.assertTrue(record["tests"]["passed"])

    def test_retained_one_resolves_three_without_changing_disk_or_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            source = "#| label: q\n#| variables: |\n#|   a = pick([1, 2, 3])\n#| field-labels: Answer\n#| note: a={#a#}\n_[{#a#}]"
            (project / "lesson.qmd").write_text("```{math-exercise}\n" + source + "\n```\n")
            options, question = module["parse_source"](source)
            payload = dict(version=1, action="resolve", source=source, options=options, question=question,
                           projectRoot=directory, file="lesson.qmd", label="q", manifest="_variants/q.yml",
                           approval="required", renderMode="review")
            initial = module["request"](payload)
            self.assertEqual(len(initial["records"]), 3)
            path = project / "_variants/q.yml"
            self.assertFalse(path.exists())
            retained = copy.deepcopy(initial["manifest"])
            retained["proposals"] = retained["proposals"][:1]
            lease = history.write(path, retained, base_hash=None)
            before = path.read_bytes()
            more = module["request"](dict(payload, action="resolve-more"))
            self.assertEqual(len(more["manifest"]["proposals"]), 3)
            self.assertEqual(len(more["records"]), 3)
            self.assertEqual(more["baseHash"], lease)
            self.assertEqual(history.load(path, "q")[1], lease)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(more["manifest"]["proposals"][:1], retained["proposals"])
            self.assertEqual(more["manifest"]["decisions"], [])
            self.assertEqual(more["manifest"]["events"], [])
            for render_mode in ("preview", "publish"):
                with self.subTest(render_mode=render_mode), self.assertRaisesRegex(ValueError, "explicit review mode"):
                    module["request"](dict(payload, action="resolve-more", renderMode=render_mode))
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
