"""Actual canonical teacher grading for handwritten pools, native CI only."""
import importlib.util
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pool_resolver',ROOT/'_extensions/math-exercise/variant_resolver.py')
resolver=importlib.util.module_from_spec(spec);spec.loader.exec_module(resolver)

class PoolChecks(unittest.TestCase):
    def check_pool(self,text,**options):
        return resolver.validate_pool(text,{'pool':'true',**options},'.',file='lesson.qmd',label='pool-q')

    def test_real_scalar_vector_and_matrix_teachers(self):
        result=self.check_pool('Scalar _[2/3]\n---\nVector vec[1,2]\n---\nMatrix mat[1,2;3,4]')
        self.assertEqual(result['count'],3)
        self.assertTrue(result['passed'])
        self.assertEqual([len(row['teacher']['actual']['fields']) for row in result['tasks']],[1,2,4])

    def test_numeric_string_and_actual_authored_case(self):
        self.assertTrue(self.check_pool('_[pi/3]',mode='numeric',tolerance='0.01')['passed'])
        self.assertTrue(self.check_pool('_[Yes]',mode='string')['passed'])
        result=self.check_pool('_[2]\n---\n_[3]',tests=[{'name':'zero is wrong','answers':['0'],'expect':'wrong'}])
        self.assertTrue(all(len(row['tests'])==1 for row in result['tasks']))

    def test_bad_teacher_or_authored_test_stops_with_pool_position(self):
        with self.assertRaisesRegex(ValueError,r'lesson.qmd: pool-q: pool task 2'):
            self.check_pool('_[2]\n---\n_[3]',mode='custom',checker='def check(response, symbols): return response["raw"] == ["2"]')
        with self.assertRaisesRegex(ValueError,'pool task 1'):
            self.check_pool('_[2]',tests=[{'name':'bad assertion','answers':['2'],'expect':'wrong'}])

    def test_no_generation_or_empty_pool(self):
        for options in ({'variables':'a=pick([1])'},{'pool':'false'}):
            with self.subTest(options=options),self.assertRaisesRegex(ValueError,'handwritten pool'):
                self.check_pool('_[2]',**options)
        with self.assertRaisesRegex(ValueError,'nonempty tasks'):
            self.check_pool('_[2]\n---\n')

    def test_existing_legacy_authored_assertions_keep_their_runner(self):
        result=self.check_pool('_[2]',mode='custom',checker='def check(response, symbols): return True',
            tests='def test(check, symbols):\n    assert check({"raw":["2"]}, symbols)')
        self.assertEqual(result['tasks'][0]['tests'],[{'name':'legacy authored tests','passed':True}])

    def test_supervised_canonical_source_check_is_read_only(self):
        wrapper=ROOT/'_extensions/math-exercise/question-variants.py'
        module=runpy.run_path(str(wrapper),run_name='pool_test_adapter')
        with tempfile.TemporaryDirectory() as directory:
            project=Path(directory)
            source='#| label: pool-q\n#| pool: true\nFirst _[2]\n---\nSecond vec[3,4]'
            (project/'lesson.qmd').write_text('```{math-exercise}\n'+source+'\n```\n')
            (project/'ctm_checkers.py').write_text("raise RuntimeError('hostile lesson import')")
            options,question=module['parse_source'](source)
            payload={'version':1,'action':'check-pool','source':source,'options':options,'question':question,
                     'projectRoot':directory,'file':'lesson.qmd','label':'pool-q'}
            result=subprocess.run([sys.executable,str(wrapper),'--stdin'],input=json.dumps(payload),
                                  text=True,capture_output=True,cwd=project,timeout=30,env=dict(os.environ))
            self.assertEqual(result.returncode,0,result.stderr)
            report=json.loads(result.stdout)
            self.assertEqual(report['kind'],'pool');self.assertEqual(report['count'],2)
            self.assertFalse((project/'_variants').exists())

if __name__=='__main__':unittest.main()
