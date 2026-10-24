"""Small real-native export fixtures; no course history or approval is changed."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('student_export_refresh', ROOT / '_extensions/math-exercise/variants-review.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class StudentExportRefresh(unittest.TestCase):
    def fixture(self, *, retain=None):
        temp = tempfile.TemporaryDirectory(prefix='ctm-export-refresh-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        source = ('#| label: q\n#| variables: |\n#|   a = pick([1, 2, 3])\n'
                  '#| field-labels: Answer\n#| note: a={#a#}\n'
                  'Original prose. _[{#a#}]\n#| solution\nOriginal explanation.')
        file = root / 'lesson.qmd'
        file.write_text('```{math-exercise}\n' + source + '\n```\n')
        review = MODULE.Review(root, 'lesson.qmd', 'q')
        self.addCleanup(review.preview_directory.cleanup)
        generated = json.loads(review.run('resolve').stdout)
        self.assertEqual(len(generated['records']), 3)
        component = review.component()
        from ctm_variants import history
        from ctm_variants.review import apply_decisions
        value = copy.deepcopy(generated['manifest'])
        if retain is not None:
            value['proposals'] = value['proposals'][:retain]
        first = value['proposals'][0]['record']
        # A disposable native decision proves existing approvals/events survive.
        value = apply_decisions(value, generated['records'],
            [dict(id=first['id'], hash=first['hash'], status='approved')])
        manifest = root / '_variants/q.yml'
        history.write(manifest, value, base_hash=None)
        return root, file, manifest, review, component

    def readonly(self, file, manifest):
        before = file.read_bytes(), manifest.read_bytes()
        self.addCleanup(lambda: self.assertEqual((file.read_bytes(), manifest.read_bytes()), before))
        return before

    def export(self, root, review, response, name='export'):
        return review.export_students(response, root / name, 'students/q')

    def test_retained_prose_and_solution_target_refresh_exports_actual_student_page(self):
        root, file, manifest, review, _ = self.fixture()
        retained = json.loads(manifest.read_text())
        file.write_text(file.read_text().replace('Original prose.', 'Current prose.')
                        .replace('Original explanation.', 'Current explanation.')
                        .replace('#| field-labels: Answer', '#| field-labels: Answer\n#| solution-target: answer-box'))
        self.readonly(file, manifest)
        response = json.loads(review.run('review').stdout)
        originals = {p['record']['id']: p['record'] for p in retained['proposals']}
        for row in response['records']:
            old = originals[row['id']]
            self.assertEqual(row['hash'], old['hash'])
            for key in ('math', 'teacher', 'grading'):
                self.assertEqual(row['snapshot'][key], old['snapshot'][key])
            self.assertNotIn('solution-target', old['data']['options'])
            self.assertEqual(row['data']['options']['solution-target'], 'answer-box')
            self.assertNotEqual(row['data'], old['data'])
            self.assertTrue(row['tests']['passed'])
        result = self.export(root, review, response)
        self.assertEqual(set(result['studentPreviews']), set(originals))
        self.assertIn('Current prose.', (root / 'export/default/index.html').read_text())
        self.assertEqual(json.loads(manifest.read_text()), retained)

    def test_transient_more_revalidates_the_appended_batch_without_history_write(self):
        root, file, manifest, review, component = self.fixture(retain=1)
        self.readonly(file, manifest)
        payload = dict(review.source_payload(), version=1, action='resolve-more',
                       projectRoot=str(root), file='lesson.qmd', label='q', manifest='_variants/q.yml',
                       approval='required', renderMode='review')
        code, output, errors = component.supervised(json.dumps(payload).encode())
        self.assertEqual(code, 0, errors.decode())
        response = json.loads(output)
        self.assertEqual(len(response['manifest']['proposals']), 3)
        self.assertEqual(len(json.loads(manifest.read_text())['proposals']), 1)
        self.assertEqual(len(response['records']), 3)
        result = self.export(root, review, response)
        self.assertEqual(len(result['studentPreviews']), 3)

    def test_forged_tests_data_or_record_order_cannot_reach_rendering(self):
        root, file, manifest, review, _ = self.fixture()
        self.readonly(file, manifest)
        response = json.loads(review.run('review').stdout)
        mutations = (
            lambda value: value['records'][0]['tests']['teacher']['actual'].update(score=0),
            lambda value: value['records'][0]['data']['options'].update({'solution-target': 'forged'}),
            lambda value: value['records'].reverse(),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                forged = copy.deepcopy(response)
                mutate(forged)
                self.assertTrue(forged['records'][0]['tests']['passed'])
                with patch.object(review, 'render_snapshot', side_effect=AssertionError('forged records rendered')):
                    with self.assertRaisesRegex(ValueError, 'fresh tested current source'):
                        self.export(root, review, forged, 'forged-' + str(index))

    def test_old_response_cannot_keep_a_stale_teacher_grade_after_source_change(self):
        root, file, manifest, review, _ = self.fixture()
        response = json.loads(review.run('review').stdout)
        file.write_text(file.read_text().replace('_[{#a#}]', '_[{#a#}+1]'))
        self.readonly(file, manifest)
        with patch.object(review, 'render_snapshot', side_effect=AssertionError('stale grade rendered')):
            with self.assertRaisesRegex(ValueError, 'fresh tested current source'):
                self.export(root, review, response)

    def test_rewritten_history_is_rejected_without_touching_source_or_history(self):
        root, file, manifest, review, component = self.fixture()
        self.readonly(file, manifest)
        response = json.loads(review.run('review').stdout)
        for field in ('decisions', 'events', 'proposals'):
            with self.subTest(field=field):
                forged = copy.deepcopy(response)
                if field == 'proposals':
                    forged['manifest'][field][0]['record']['note'] += ' forged'
                else:
                    forged['manifest'][field] = []
                with patch.object(component, 'supervised', side_effect=AssertionError('untrusted history resolved')):
                    with patch.object(review, 'component', return_value=component):
                        with self.assertRaisesRegex(ValueError, 'preserve current history|decision history does not match current decisions'):
                            self.export(root, review, forged, 'history-' + field)

    def test_source_or_history_changed_during_supervision_is_not_overwritten(self):
        for changed in ('source', 'history'):
            with self.subTest(changed=changed):
                root, file, manifest, review, component = self.fixture()
                response = json.loads(review.run('review').stdout)
                target = file if changed == 'source' else manifest
                before = file.read_bytes(), manifest.read_bytes()
                injected = target.read_bytes() + b'\n'
                original = component.supervised
                def race(*args, **kwargs):
                    result = original(*args, **kwargs)
                    target.write_bytes(injected)
                    return result
                with patch.object(component, 'supervised', side_effect=race):
                    with patch.object(review, 'component', return_value=component):
                        with self.assertRaisesRegex(ValueError, 'source or history changed'):
                            self.export(root, review, response)
                self.assertEqual(target.read_bytes(), injected)
                self.assertEqual(manifest.read_bytes() if changed == 'source' else file.read_bytes(),
                                 before[1] if changed == 'source' else before[0])


if __name__ == '__main__':
    unittest.main()
