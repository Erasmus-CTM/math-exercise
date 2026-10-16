import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('authored tests fail the Quarto build, stay out of checker payloads, and remain optional', () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-question-tests-'));
  try {
    cpSync(new URL('../_extensions/math-exercise', import.meta.url), join(dir, '_extensions/math-exercise'), {recursive: true});
    if (process.env.AI_FEEDBACK_EXTENSION && existsSync(process.env.AI_FEEDBACK_EXTENSION)) {
      cpSync(process.env.AI_FEEDBACK_EXTENSION, join(dir, '_extensions/ai-feedback'), {recursive: true});
    }
    const question = (tests = '') => `---\nformat: html\nfilters: [math-exercise]\n---\n\n\x60\x60\x60{math-exercise}\n#| label: author-test-example\n#| mode: custom\n#| checker: |\n#|   def check(response, symbols):\n#|       return {"correct": True}\n${tests}\nAnswer: _[]\n\x60\x60\x60\n`;
    const render = (env = {}) => spawnSync(process.env.QUARTO || 'quarto', ['render', 'lesson.qmd'], {
      cwd: dir, env: {...process.env, ...env}, encoding: 'utf8', timeout: 60000,
    });
    writeFileSync(join(dir, 'lesson.qmd'), question());
    let result = render({MATH_EXERCISE_PYTHON: '/this-python-must-not-be-called'});
    assert.equal(result.status, 0, result.stderr);
    const tests = '#| tests: |\n#|   def test(check, symbols):\n#|       assert check({"expressions": []}, symbols)["correct"], "AUTHOR_ASSERTION"';
    writeFileSync(join(dir, 'lesson.qmd'), question(tests));
    result = render();
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(join(dir, 'lesson.html'), 'utf8');
    assert.doesNotMatch(html, /AUTHOR_ASSERTION|def test\(/);
    writeFileSync(join(dir, 'lesson.qmd'), question(tests.replace('assert check(', 'assert not check(')));
    result = render();
    assert.notEqual(result.status, 0, 'a failing authored assertion must fail Quarto');
    assert.match(result.stdout + result.stderr, /author-test-example/);
    assert.match(result.stdout + result.stderr, /AUTHOR_ASSERTION/);
    writeFileSync(join(dir, 'question-test.py'), 'def test(check, symbols):\n    assert check({"expressions": []}, symbols)["correct"]\n');
    writeFileSync(join(dir, 'lesson.qmd'), question('#| tests: question-test.py'));
    result = render();
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(dir, 'question-test.py'), 'def test(check, symbols):\n    assert False, "SIDECAR_ASSERTION"\n');
    result = render();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /SIDECAR_ASSERTION/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
