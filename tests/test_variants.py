import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

# variants.py rounds with ctm-checkers (ctm_checkers.math_exercise.numeric):
# its wheel first on sys.path, as math-exercise.lua runs the script.
# CTM_CHECKERS_WHEEL, else the ctm-checkers installed in this repository.
def checkers_wheel():
    if os.environ.get('CTM_CHECKERS_WHEEL'):
        return os.environ['CTM_CHECKERS_WHEEL']
    extensions=Path(__file__).resolve().parents[1]/'_extensions'
    for folder in [extensions/'ctm-checkers']+sorted(extensions.glob('*/ctm-checkers')):
        if (folder/'checkers.json').is_file():
            return str(folder/json.loads((folder/'checkers.json').read_text())['wheel'])
    raise RuntimeError('Install ctm-checkers first (quarto add of a ctm-checkers checkout), or set CTM_CHECKERS_WHEEL to its wheel.')
sys.path.insert(0,checkers_wheel())

path=Path(__file__).resolve().parents[1]/'_extensions/math-exercise/variants.py'
spec=importlib.util.spec_from_file_location('variants',path);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class Variants(unittest.TestCase):
    def setUp(self):
        self.spec={'parameters':{'ab':[3,4],'offset':[1,2]},'derived':{'bc':'ab+offset'},'question':'$AB={{ab}}$ _[{{bc}}/sqrt({{ab}}^2+{{bc}}^2)]','solution':'Value {{bc:.2f}}','checker':'def check(response, symbols):\n    return response["variant"]["parameters"]["ab"]'}
    def test_stable_ids_and_exact_source(self):
        a=v.generate(self.spec)['variants'];self.spec['parameters']={'offset':[2,1],'ab':[4,3]};b=v.generate(self.spec)['variants']
        self.assertEqual({x['id'] for x in a},{x['id'] for x in b});self.assertIn('4/sqrt(3^2+4^2)',a[0]['question'])
    def test_optional_review_selection(self):
        a=v.generate(self.spec);key=a['variants'][0]['id'];self.spec['exclude-variants']=[key]
        self.assertEqual(len(v.generate(self.spec)['variants']),3)
        self.spec['review']=True;b=v.generate(self.spec);self.assertEqual(len(b['variants']),4);self.assertFalse(b['variants'][0]['included'])
    def test_fingerprint(self):
        a=v.generate(self.spec);self.spec.update({'reviewed-fingerprint':a['fingerprint'],'include-variants':[a['variants'][0]['id']]})
        self.assertEqual(v.generate(self.spec)['fingerprint'],a['fingerprint'])
        self.spec['checker']+='\n# change'
        with self.assertRaisesRegex(ValueError,'enable review'):v.generate(self.spec)
    def test_invalid_selection(self):
        for options in [{'include-variants':[]},{'exclude-variants':['wrong']},{'include-variants':['wrong']}]:
            with self.assertRaises(ValueError):v.generate(dict(self.spec,**options))
    def test_constraints_before_division(self):
        s={'parameters':{'x':[0,1,2]},'constraints':['x != 0'],'derived':{'y':'1/x'},'question':'{{y}}'}
        self.assertEqual(len(v.generate(s)['variants']),2)
    def test_dependencies(self):
        self.spec['derived']={'c':'bc+1','bc':'ab+offset'};self.assertEqual(v.generate(self.spec)['variants'][0]['derived']['c'],5)
        self.spec['derived']={'a':'b','b':'a'}
        with self.assertRaisesRegex(ValueError,'cyclic'):v.generate(self.spec)
    def test_duplicate_and_bound(self):
        for choices in [[3,3.0],[],{'start':0,'stop':20000}]:
            with self.assertRaises(ValueError):v.generate({'parameters':{'x':choices}})
    def test_no_code_execution(self):
        for expression in ['__import__("os")','(1).__class__','[1,2][0]','2**1000','sqrt(-1)','1/0']:
            with self.assertRaises(Exception):v.expression(expression,{})
    def test_rounding_matches_the_checker(self):
        # Half away from zero on the decimal value, as decplaces/sigfigs grade.
        self.assertEqual(v.FUNCTIONS['round'](1/8, 2), 0.13)
        self.assertEqual(v.FUNCTIONS['round'](2.5), 3)
        self.assertEqual(v.FUNCTIONS['round'](-2.5), -3)
        self.assertEqual(v.FUNCTIONS['round'](7, 2), 7)
        self.assertEqual(v.FUNCTIONS['round'](1.05*1.9, 2), 2.0)
        self.assertEqual(v.FUNCTIONS['sigfig'](0.002725, 3), 0.00273)
        self.assertEqual(v.substitute('{{a:.2f}} {{b:.3g}} {{c:.1f}}', {'a': 5/8, 'b': 1.2345, 'c': 7}), '0.63 1.23 7.0')

    def test_unknown_placeholder(self):
        self.spec['question']='{{missing}}'
        with self.assertRaises(KeyError):v.generate(self.spec)
    def test_custom_fixtures_and_context(self):
        self.spec['tests']=[{'response':{'point':{'x':'{{ab}}','y':'{{bc}}'}},'expected':'correct'}]
        self.spec['variant-context']='AB={{ab}}'
        r=v.generate(self.spec)['variants'][0]
        self.assertEqual(r['tests'][0]['response']['point'],{'x':'3','y':'4'});self.assertEqual(r['variant-context'],'AB=3')
    def test_review_after_definition_change(self):
        old=v.generate(self.spec)
        self.spec.update({'include-variants':[old['variants'][0]['id']], 'reviewed-fingerprint':old['fingerprint']})
        self.spec['parameters']['ab']=[9]
        with self.assertRaisesRegex(ValueError,'enable review'):v.generate(self.spec)
        self.spec['review']=True
        new=v.generate(self.spec)
        self.assertTrue(new['staleReview']);self.assertTrue(new['variants'])
    def test_source_preserves_checker_and_markdown(self):
        source="#| label: raw\n#| mode: custom\n#| parameters:\n#|   mode: [2]\n#| constraints:\n#|   - mode > 0\n#| checker: |\n#|   def check(response, symbols):\n#|       return {'correct': True}\n#| solution: |\n#|   **Math** $x^2$\n\nValue {{mode}} _[0]"
        result=v.compile_request({'source':source})
        self.assertEqual(result['options']['mode'],'custom')
        self.assertNotIn('#|',result['variants'][0]['question'])
        self.assertIn("    return {'correct': True}",result['variants'][0]['checker'])
        self.assertIn('**Math** $x^2$',result['variants'][0]['solution'])
    def test_schema_rejects_invalid_options(self):
        for option in [{'tests':None},{'tests':{}},{'review':'false'},{'derived':[]},{'solution':3}]:
            with self.assertRaises(ValueError):v.generate(dict(self.spec,**option))
    def test_ranges(self):
        self.assertEqual(v.choices({'start':3,'stop':1,'step':-1}),[3,2,1])
        self.assertEqual(len(v.generate({'parameters':{'k':{'start':1,'stop':71}}})['variants']),71)

if __name__=='__main__':unittest.main()
