// The checker runtime survives a replaced Pyodide runtime and is isolated from
// learner code that shares the interpreter's global namespace.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

const runtimeSource = readFileSync(new URL('../_extensions/math-exercise/shared/pyodide-runtime.js', import.meta.url), 'utf8');
const exerciseSource = readFileSync(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');
const python = process.env.MATH_EXERCISE_PYTHON || 'python3';

function load(globals = {}) {
  const listeners = {};
  const window = { __mathExerciseConfig: { lang: 'en' }, __mathExerciseTestMode: true,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatch: type => (listeners[type] || []).forEach(fn => fn({ type })) };
  const context = vm.createContext({ console, setTimeout, clearTimeout, document: { addEventListener() {} }, window, ...globals });
  context.globalThis = context;
  vm.runInContext(runtimeSource, context);
  vm.runInContext(exerciseSource, context);
  return { context, window, api: window.__mathExerciseTestApi };
}

function fakeRuntime(name, log, { failOnce } = {}) {
  let failed = false;
  return {
    name,
    loadPackage: async pkg => { log.push(name + ':load:' + pkg); },
    globals: { set: async () => {} },
    runPythonAsync: async code => {
      if (code.includes('ModuleType(')) { if (!code.includes('"_ctm_guard"')) log.push(name + ':install'); return undefined; }
      if (failOnce && !failed) { failed = true; await failOnce(); throw new Error('Python was restarted.'); }
      log.push(name + ':check');
      return JSON.stringify({ status: 'correct', score: 1 });
    },
  };
}

test('SymPy setup and packages are bound to the runtime and repeated after a restart', async () => {
  const log = [];
  const first = fakeRuntime('a', log), second = fakeRuntime('b', log);
  const { context, window, api } = load({ qpyodideInstance: Promise.resolve(first) });
  assert.equal(await api.ensureSympy(), first);
  assert.equal(await api.ensureSympy(), first);
  await api.ensurePackages(['networkx']); await api.ensurePackages(['networkx']);
  assert.deepEqual(log, ['a:load:sympy', 'a:install', 'a:load:networkx']);
  window.dispatch('qpyodide-runtime-restart');
  context.mainPyodide = undefined;
  context.qpyodideInstance = Promise.resolve(second);
  assert.equal(await api.ensureSympy(), second);
  await api.ensurePackages(['networkx']);
  assert.deepEqual(log.slice(3), ['b:load:sympy', 'b:install', 'b:load:networkx']);
});

test('a check interrupted by a restart is repeated once on the new runtime', async () => {
  const log = [];
  let replacement;
  const { context, api } = load();
  const first = fakeRuntime('a', log, { failOnce: async () => { context.mainPyodide = undefined; context.qpyodideInstance = Promise.resolve(replacement); } });
  replacement = fakeRuntime('b', log);
  context.qpyodideInstance = Promise.resolve(first);
  const result = await api.checkField({ value: '1', dataset: { answer: '1' } }, 'equivalent', {});
  assert.equal(result.status, 'correct');
  assert.ok(log.includes('b:check'));
});

test('a restart during the first SymPy setup is retried on the new runtime', async () => {
  const log = [];
  let replacement;
  const { context, window, api } = load();
  const first = fakeRuntime('a', log);
  first.loadPackage = async pkg => {
    log.push('a:load:' + pkg);
    context.mainPyodide = undefined; context.qpyodideInstance = Promise.resolve(replacement);
    window.dispatch('qpyodide-runtime-restart');
    throw new Error('Python was restarted.');
  };
  replacement = fakeRuntime('b', log);
  context.qpyodideInstance = Promise.resolve(first);
  const result = await api.checkField({ value: '1', dataset: { answer: '1' } }, 'equivalent', {});
  assert.equal(result.status, 'correct');
  assert.deepEqual(log, ['a:load:sympy', 'b:load:sympy', 'b:install', 'b:check']);
});

test('learner rebinding of SymPy names does not reach the checker module (CPython)', { skip: spawnSync(python, ['-c', 'import sympy']).status ? 'SymPy required' : false }, async () => {
  // Record exactly what the browser setup sends to Pyodide, then replay it in CPython.
  const ops = [];
  const recorder = { loadPackage: async () => {}, globals: { set: async (name, value) => { ops.push(['set', name, value]); } },
    runPythonAsync: async code => { ops.push(['run', code]); } };
  const { api } = load({ qpyodideInstance: Promise.resolve(recorder) });
  await api.ensureSympy();
  const dir = mkdtempSync(join(tmpdir(), 'math-isolation-'));
  try {
    writeFileSync(join(dir, 'case.json'), JSON.stringify({ ops, call: api.runtimeCall('_math_check') }));
    const script = String.raw`
import builtins, json, sys
case = json.load(open(sys.argv[1]))
main = {'__name__': '__main__'}
for op in case['ops']:
    if op[0] == 'set':
        main[op[1]] = op[2]
    else:
        exec(op[1], main)
assert not [k for k in main if k.startswith('_ctm_')], 'setup left names in the shared namespace'
exec('symbols = None\nSymbol = None\nsympify = None\nMatrix = None\nsqrt = None\nsimplify = None\nparse_expr = None\n_mj = None', main)
def ask(answer):
    main.update({'_math_student': answer, '_math_correct': 'sqrt(72)', '_math_vars': '', '_math_mode': 'equivalent',
      '_math_reject': '', '_math_tolerance': '', '_math_decplaces': '', '_math_sigfigs': '', '_math_form': '',
      '_math_partial_credit': False, '_math_form_credit': 0.5})
    return json.loads(eval(case['call'], main))
assert ask('6*sqrt(2)')['status'] == 'correct'
assert not [k for k in main if k.startswith('_math_')]
# Answers are evaluated by SymPy's parser: no access to Python internals.
try:
    ask("__import__('builtins').__dict__.clear()")
    raise SystemExit('dunder answer was evaluated')
except ValueError as error:
    assert 'unsupported input' in str(error)
assert builtins.len is len and ask('6*sqrt(2)')['status'] == 'correct'
# Only this request's learner strings count: author data (variant context) is
# free, inputs left by an earlier request of another kind are not re-checked,
# and string answers are never evaluated.
module = sys.modules['_ctm_math_exercise']
custom = json.dumps({'kind': 'expressions', 'raw': ['x + 1'], 'inputs': {'m': {'type': 'matrix', 'raw': ['__a']}},
                     'variant': {'context': 'The value is __important__'}})
assert list(module._learner_strings({'_math_response_json': custom})) == ['x + 1', '__a']
assert list(module._learner_strings({'_math_student': 'x__1', '_math_mode': 'equivalent'})) == ['x__1']
assert list(module._learner_strings({'_math_student': '__init__', '_math_mode': 'string'})) == []
try:
    ask('x__1')
    raise SystemExit('dunder answer accepted')
except ValueError:
    pass
assert ask('6*sqrt(2)')['status'] == 'correct', 'a rejected answer must not block later checks'
print('isolated')
`;
    const r = spawnSync(python, ['-c', script, join(dir, 'case.json')], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /isolated/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
