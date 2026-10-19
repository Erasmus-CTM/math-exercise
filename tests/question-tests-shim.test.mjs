// question-tests.py (the documented command and Quarto's build-time call) is
// a script that finds ctm-checkers' wheel and runs its authored question tests
// (ctm_checkers.math_exercise.authored): CTM_CHECKERS_WHEEL; else
// ../ctm-checkers next to the component (the CTM Assessment package, or one
// owner folder); else the project's _extensions/[owner/]ctm-checkers. Without
// ctm-checkers it says how to install it.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ctmCheckers, wheel } from './helpers/ctm-checkers.mjs';

const extension = fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url));
const python = process.env.MATH_EXERCISE_PYTHON || 'python3';
const MISSING = 'math-exercise question tests need ctm-checkers, part of CTM Assessment. '
  + 'Install CTM Assessment: quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz\n';
const LESSON = '```{math-exercise}\n#| label: shim\n#| mode: custom\n#| vars: x\n#| checker: |\n#|   def check(response, symbols):\n'
  + '#|       return {"correct": response["raw"] == ["x"]}\n#| tests: |\n#|   def test(check, symbols):\n'
  + '#|       assert check({"raw": ["x"]}, symbols)["correct"]\nAnswer: _[]\n```\n';

// A project with math-exercise under `component` (relative to _extensions)
// and ctm-checkers under `checkers` (or none); the shim's result for the lesson.
const QUESTION = { label: 'shim', mode: 'custom', vars: 'x', checker: 'def check(response, symbols):\n    return True\n',
  tests: 'def test(check, symbols):\n    assert check({"raw": ["x"]}, symbols)\n' };
function run({ component, checkers, env = {}, args, question = QUESTION }) {
  const dir = mkdtempSync(join(tmpdir(), 'math-question-shim-'));
  try {
    cpSync(extension, join(dir, '_extensions', component), { recursive: true });
    if (checkers) cpSync(ctmCheckers, join(dir, '_extensions', checkers), { recursive: true });
    writeFileSync(join(dir, 'lesson.qmd'), LESSON);
    const environment = { ...process.env, ...env };
    if (!('CTM_CHECKERS_WHEEL' in env)) delete environment.CTM_CHECKERS_WHEEL;
    delete environment.PYTHONPATH;
    return spawnSync(python, [join(dir, '_extensions', component, 'question-tests.py'), ...(args || ['lesson.qmd'])],
      { cwd: dir, env: environment, encoding: 'utf8', timeout: 120000, input: args && args[0] === '--stdin' ? JSON.stringify(question) : undefined });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const passed = /^1 authored question tests passed; 0 custom questions without tests\.\n$/;

test('the package layout: ctm-checkers next to the component', () => {
  const result = run({ component: 'ctm-assessment/math-exercise', checkers: 'ctm-assessment/ctm-checkers' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, passed);
});

test('component development: ctm-checkers in the project\'s _extensions, also with math-exercise under an owner folder', () => {
  for (const component of ['math-exercise', 'Erasmus-CTM/math-exercise']) {
    const result = run({ component, checkers: 'ctm-checkers' });
    assert.equal(result.status, 0, component + ': ' + result.stderr);
    assert.match(result.stdout, passed);
  }
  const owned = run({ component: 'Erasmus-CTM/math-exercise', checkers: 'someone/ctm-checkers' });
  assert.equal(owned.status, 0, owned.stderr);
});

test('CTM_CHECKERS_WHEEL names the wheel; Quarto\'s --stdin', () => {
  const result = run({ component: 'math-exercise', env: { CTM_CHECKERS_WHEEL: wheel }, args: ['--stdin'] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, passed);
});

test('without ctm-checkers the command says how to install it', () => {
  const result = run({ component: 'math-exercise' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, MISSING);
  const wrong = run({ component: 'math-exercise', env: { CTM_CHECKERS_WHEEL: '/no/such/wheel.whl' } });
  assert.equal(wrong.status, 1);
  assert.equal(wrong.stderr, MISSING);
});

test('the messages and exit statuses of the command stay those of math-exercise 0.10', () => {
  const usage = run({ component: 'math-exercise', checkers: 'ctm-checkers', args: [] });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /^math-exercise question tests failed: Run trusted author assertions next to custom math-exercise checkers\./);
  const failing = run({ component: 'math-exercise', checkers: 'ctm-checkers', args: ['--stdin'],
    question: { ...QUESTION, tests: 'def test(check, symbols):\n    assert not check({"raw": ["x"]}, symbols), "AUTHOR_ASSERTION"\n' } });
  assert.equal(failing.status, 1);
  assert.equal(failing.stderr, 'math-exercise question tests failed: Quarto: shim: AssertionError: AUTHOR_ASSERTION\n');
});
