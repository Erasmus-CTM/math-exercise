"""One real native execution/grading check per manually migrated example."""
import importlib.util
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parents[1]
parse = runpy.run_path(str(ROOT / '_extensions/math-exercise/question-variants.py'), run_name='example_parser')['parse_source']
spec = importlib.util.spec_from_file_location('example_resolver', ROOT / '_extensions/math-exercise/variant_resolver.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NativeExamples(unittest.TestCase):
    def test_each_manual_example_runs_real_teacher_and_authored_checks(self):
        from ctm_variants.generation import execute
        from ctm_variants.validation import validate_math_candidate
        for name in ('triangle', 'perpendicular', 'matrix', 'coupled', 'geometry'):
            with self.subTest(name=name):
                source = (ROOT / '_includes/variants' / (name+'.qmd')).read_text().split('\n',1)[1].rsplit('```',1)[0]
                options, question = parse(source)
                self.assertNotIn('parameters',options)
                execution = execute(options['variables'], seed='manual-example-check', file=name+'.qmd', label=options['label'])
                row = module.resolver(question, options, file=name+'.qmd', label=options['label'])(execution)
                data = row['data']
                report = validate_math_candidate(data['options'], str(ROOT), context=data['context'], teacher_inputs=data['teacher_inputs'])
                self.assertTrue(report['passed'])
                self.assertGreater(len(report['tests']),0)
                self.assertIsNone(data['context']['variant'])

if __name__ == '__main__': unittest.main()
