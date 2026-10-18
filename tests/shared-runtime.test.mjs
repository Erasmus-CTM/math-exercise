import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../_extensions/math-exercise/shared/pyodide-runtime.js', import.meta.url), 'utf8');
const lua = await readFile(new URL('../_extensions/math-exercise/math-exercise.lua', import.meta.url), 'utf8');
const exercise = await readFile(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');
const cdn = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';

function runtime(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(source, context);
  return context;
}

function documentStub(onAppend) {
  const scripts = [];
  return {
    scripts,
    querySelector(selector) {
      return scripts.find((script) => selector === `script[src="${script.src}"]`) ?? null;
    },
    createElement() {
      const listeners = {};
      return {
        dataset: {}, listeners,
        addEventListener(event, listener) { (listeners[event] ??= []).push(listener); },
        dispatch(event) {
          for (const listener of listeners[event] ?? []) listener();
          this[`on${event}`]?.();
        },
        remove() { scripts.splice(scripts.indexOf(this), 1); },
      };
    },
    head: {
      appendChild(script) { scripts.push(script); onAppend(script); },
    },
  };
}

test('Lua includes the classic shared runtime before the exercise script', () => {
  assert.match(lua, /readFile\("shared\/pyodide-runtime\.js"\)/);
  assert.match(lua, /runtime \.\. "\\n" \.\. js/);
  assert.match(exercise, /globalThis\.MathExerciseRuntime\.ensurePyodide\(\)/);
});

test('reuses an existing coatless promise or a ready main instance', async () => {
  const coatless = { loadPackage() {} };
  const fromCoatless = runtime({ qpyodideInstance: Promise.resolve(coatless) });
  assert.equal(await fromCoatless.MathExerciseRuntime.ensurePyodide(), coatless);
  assert.equal(fromCoatless.mainPyodide, coatless);

  const main = { runPythonAsync() {} };
  const fromMain = runtime({ mainPyodide: main });
  assert.equal(await fromMain.MathExerciseRuntime.ensurePyodide(), main);
  assert.equal(fromMain.__qExercisePyodide, undefined);
});

test('reuses top-level lexical instances from another classic script', async () => {
  const context = runtime({ instance: { from: 'lexical' } });
  vm.runInContext('let qpyodideInstance = Promise.resolve(instance)', context);
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), context.instance);
  assert.equal(context.mainPyodide, context.instance);
  assert.equal(context.qpyodideInstance, undefined);
});

test('shares one browser load and instance across concurrent callers', async () => {
  let loads = 0;
  let script;
  const document = documentStub((tag) => { script = tag; });
  const instance = { name: 'shared' };
  const context = runtime({ document });
  const api = context.MathExerciseRuntime;
  const first = api.ensurePyodide();
  const second = api.ensurePyodide();
  assert.equal(document.scripts.length, 1);
  assert.equal(script.src, cdn + 'pyodide.js');
  context.loadPyodide = async (opts) => {
    loads++;
    assert.equal(opts.indexURL, cdn);
    return instance;
  };
  script.dispatch('load');
  assert.deepEqual(await Promise.all([first, second]), [instance, instance]);
  assert.equal(loads, 1);
  assert.equal(context.mainPyodide, instance);
  assert.equal(await api.ensurePyodide(), instance);
  assert.equal(loads, 1);
});

test('a failed script or initialization clears the shared promise for retry', async () => {
  const document = documentStub(() => {});
  const context = runtime({ document });
  const api = context.MathExerciseRuntime;
  const first = api.ensurePyodide();
  const failedTag = document.scripts[0];
  failedTag.dispatch('error');
  await assert.rejects(first, /Failed to load/);
  assert.equal(context.__qExercisePyodide, undefined);
  assert.equal(document.scripts.length, 0);

  let attempts = 0;
  context.loadPyodide = async () => {
    if (++attempts === 1) throw new Error('temporary init failure');
    return { ready: true };
  };
  await assert.rejects(api.ensurePyodide(), /temporary init failure/);
  assert.equal(context.__qExercisePyodide, undefined);
  assert.equal((await api.ensurePyodide()).ready, true);
  assert.equal(attempts, 2);
});

test('worker imports Pyodide without reading document or window', async () => {
  const instance = { worker: true };
  const imports = [];
  const context = runtime({
    importScripts(src) {
      imports.push(src);
      context.loadPyodide = async ({ indexURL }) => {
        assert.equal(indexURL, cdn);
        return instance;
      };
    },
  });
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), instance);
  assert.deepEqual(imports, [cdn + 'pyodide.js']);
  assert.equal(context.mainPyodide, instance);
});

test('a load that never finishes (failed WebAssembly) times out and can be retried', async () => {
  let calls = 0;
  const ready = { runPythonAsync() {} };
  const context = runtime({ setTimeout, clearTimeout, __qExercisePyodideTimeout: 50,
    loadPyodide: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve(ready)) });
  await assert.rejects(context.MathExerciseRuntime.ensurePyodide(), error => error.code === 'pyodide-timeout');
  assert.equal(context.__qExercisePyodide, undefined);
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), ready);
  assert.equal(calls, 2);
});
