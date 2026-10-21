// The page's Python runtime is ctm-libs' runtime/pyodide-runtime.js (global
// MathExerciseRuntime), tested in ctm-libs, and the checks are ctm-checkers'
// (its page script, which ctm-libs registers and installs). math-exercise
// registers them and its own files as HTML dependencies instead of inlining a
// bundle, and holds no checker code.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lua = await readFile(new URL('../_extensions/math-exercise/math-exercise.lua', import.meta.url), 'utf8');
const exercise = await readFile(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');

test('Lua registers the shared runtime, ctm-checkers and the exercise files as dependencies, no inline bundle', () => {
  assert.match(lua, /requireCheckers\(\)\s+ctm\.runtime\.use\(\)\s+ctm\.checkers\.use\(\)\s+ctm\.locale\.use\("math-exercise"\)\s+quarto\.doc\.add_html_dependency\(\{\s+name = "math-exercise"/);
  assert.match(lua, /ctm\.checkers\.require\("math-exercise", 1\)/);
  assert.match(lua, /\{path = "matrix-input\.js", afterBody = true\},\s+\{path = "math-store\.js", afterBody = true\},\s+\{path = "math-exercise\.js", afterBody = true\}/);
  assert.doesNotMatch(lua, /include_text\("after-body"/);
  assert.doesNotMatch(lua, /pyodide-runtime\.js/);
  assert.match(exercise, /globalThis\.MathExerciseRuntime\.ensurePyodide\(\)/);
  // The checks: ctm-checkers through ctm-libs; no checker code of its own (the design's one-home rule).
  assert.match(exercise, /globalThis\.MathExerciseRuntime\.ensureCheckers\(py\)/);
  assert.match(exercise, /globalThis\.MathExerciseRuntime\.callCheckers\(py, 'math_exercise\.' \+ name, request\)/);
  assert.doesNotMatch(exercise, /def _math_check|def assess_basis|_ctm_math_exercise|installModule/);
});
