// The page's Python runtime is ctm-libs' runtime/pyodide-runtime.js (global
// MathExerciseRuntime), tested in ctm-libs. math-exercise registers it and its
// own files as HTML dependencies instead of inlining a bundle.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lua = await readFile(new URL('../_extensions/math-exercise/math-exercise.lua', import.meta.url), 'utf8');
const exercise = await readFile(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');

test('Lua registers the shared runtime and the exercise files as dependencies, no inline bundle', () => {
  assert.match(lua, /ctm\.runtime\.use\(\)\s+ctm\.locale\.use\("math-exercise"\)\s+quarto\.doc\.add_html_dependency\(\{\s+name = "math-exercise"/);
  assert.match(lua, /\{path = "matrix-input\.js", afterBody = true\},\s+\{path = "math-exercise\.js", afterBody = true\}/);
  assert.doesNotMatch(lua, /include_text\("after-body"/);
  assert.doesNotMatch(lua, /pyodide-runtime\.js/);
  assert.match(exercise, /globalThis\.MathExerciseRuntime\.ensurePyodide\(\)/);
});
