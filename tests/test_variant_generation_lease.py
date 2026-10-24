"""Focused file-wrapper lease binding; no repeated native generation campaign."""
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "_extensions/math-exercise/question-variants.py"
spec = importlib.util.spec_from_file_location("wrapper_lease", MODULE)
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class LeaseTests(unittest.TestCase):
    def call(self, expected, actual):
        history = types.SimpleNamespace(load=lambda path, label: ({"proposals": []}, actual))
        package = types.ModuleType("ctm_variants")
        package.history = history
        review = types.ModuleType("ctm_variants.review")
        review._path = lambda root, name: Path(root) / name
        with patch.dict("sys.modules", {"ctm_variants": package, "ctm_variants.review": review}), patch.object(wrapper, "current_source", return_value={"source": "current"}):
            return wrapper.file_request(dict(projectRoot="/tmp", file="lesson.qmd", label="q", expectedBaseHash=expected), "generate25more")

    def test_matching_lease_is_carried_to_atomic_native_write(self):
        self.assertEqual(self.call("a" * 64, "a" * 64)["baseHash"], "a" * 64)
        self.assertIsNone(self.call(None, None)["baseHash"])

    def test_stale_or_missing_history_cannot_silently_rebase(self):
        for expected, actual in (("a" * 64, "b" * 64), (None, "b" * 64), ("a" * 64, None)):
            with self.subTest(expected=expected, actual=actual), self.assertRaisesRegex(ValueError, "rebuild review"):
                self.call(expected, actual)


if __name__ == "__main__":
    unittest.main()
