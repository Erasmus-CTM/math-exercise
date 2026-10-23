"""Focused component identity and exact marker transport contracts."""
import copy
import importlib.util
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("variant_resolver", ROOT / "_extensions/math-exercise/variant_resolver.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ResolverTests(unittest.TestCase):
    def row(self, question="Find $x + {@a@}$: _[{@a/2@}]", *, options=None, variables=None, choices=None):
        from sympy import Integer, Symbol
        options = {"field-labels": "Answer", "mode": "equivalent", "vars": "x", **(options or {})}
        return module.resolver(question, options, file="lesson.qmd", label="q")({
            "variables": variables or {"a": Integer(2), "x": Symbol("x")},
            "choices": [Integer(2)] if choices is None else choices})

    def test_exact_teacher_marker_and_actual_grading(self):
        from ctm_checkers.variants import decode_context
        from ctm_variants.validation import validate_math_candidate
        row = self.row()
        data = row["data"]
        fields, variables, teacher, identity = decode_context(data["context"])
        self.assertEqual(fields, ["Answer"])
        self.assertEqual(teacher["Answer"], 1)
        self.assertIsNone(identity)
        self.assertEqual(data["teacher_inputs"], {"Answer": "1"})
        self.assertTrue(data["options"]["question"].endswith("_[1]"))
        self.assertTrue(validate_math_candidate(data["options"], ".", context=data["context"],
            teacher_inputs=data["teacher_inputs"])["passed"])

    def test_b1_prose_and_generated_variable_names_do_not_change_content_hash(self):
        from sympy import Integer, Symbol
        first = self.row()
        renamed = self.row("Calculate $x + {@b@}$ please: _[{@b/2@}]",
            variables={"b": Integer(2), "x": Symbol("x"), "unused": Integer(9)})
        self.assertEqual(first["hash"], renamed["hash"])
        self.assertEqual(first["id"], renamed["id"])
        self.assertNotEqual(first["snapshot"]["checksum"], renamed["snapshot"]["checksum"])

    def test_b1_order_operator_raw_prose_answer_and_grading_changes_void_approval(self):
        baseline = self.row("$x + {@a@}$, raw {#a#}: _[{@a/2@}]")
        for question, options in [
            ("$x - {@a@}$, raw {#a#}: _[{@a/2@}]", None),
            ("$x + {@a@}$, raw {#a+1#}: _[{@a/2@}]", None),
            ("$x + {@a@}$, raw {#a#}: _[{@a@}]", None),
            ("$x + {@a@}$, raw {#a#}: _[{@a/2@}]", {"tolerance": "0.1"}),
        ]:
            self.assertNotEqual(baseline["hash"], self.row(question, options=options)["hash"])
        self.assertNotEqual(self.row("${@a@}-{@a+1@}$ _[1]")["hash"],
                            self.row("${@a+1@}-{@a@}$ _[1]")["hash"])

    def test_labels_required_and_counted_and_tests_not_silently_discarded(self):
        for options in ({}, {"field-labels": ""}, {"field-labels": "A,A"}, {"field-labels": "A,B"}):
            with self.assertRaisesRegex(ValueError, "field-labels"):
                module.resolver("_[1]", options)
        with self.assertRaisesRegex(ValueError, "declarative tests"):
            self.row(options={"tests": "assert False"})

    def test_scalar_marker_after_text_uses_input_syntax_like_existing_component(self):
        row = self.row("x_[{@a/3@}]")
        self.assertEqual(row["data"]["options"]["question"], "x_[2/3]")
        self.assertEqual(row["data"]["teacher_inputs"], {"Answer": "2/3"})

    def test_translation_copies_do_not_duplicate_mathematics_identity(self):
        plain = self.row()
        translated = self.row(options={"translations": {"nb": {"question": "Finn $x + {@a@}$: _[{@a/2@}]", "solution": ""}}})
        self.assertEqual(plain["hash"], translated["hash"])
        self.assertTrue(translated["data"]["options"]["translations"]["nb"]["question"].endswith("_[1]"))

    def test_translations_cannot_change_teacher_answers_or_field_structure(self):
        for question in ("_[{@a/2+1@}]", "No input", "_[1] _[2]"):
            with self.assertRaisesRegex(ValueError, "teacher answers|field-labels"):
                self.row(options={"translations": {"nb": {"question": question, "solution": ""}}})


if __name__ == "__main__":
    unittest.main()
