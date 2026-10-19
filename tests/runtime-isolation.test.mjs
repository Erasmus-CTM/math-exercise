// The checks (ctm-checkers, called through ctm-libs) survive a replaced
// Pyodide runtime and are isolated from learner code that shares the
// interpreter's global namespace.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import { LOCALE, RUNTIME, runInContext, sources } from './helpers/ctm-libs.mjs';
import { ANY_CHECK, script as checkersScript } from './helpers/ctm-checkers.mjs';

const [runtimeSource] = sources(RUNTIME);
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
  vm.runInContext(checkersScript, context);
  runInContext(context, LOCALE);
  vm.runInContext(exerciseSource, context);
  return { context, window, api: window.__mathExerciseTestApi };
}

// A runtime that logs ctm-checkers' install and the checks (ctm-libs' call
// text); the guard's install and the request's removal are not logged.
function fakeRuntime(name, log, { failOnce } = {}) {
  let failed = false;
  return {
    name,
    loadPackage: async pkg => { log.push(name + ':load:' + pkg); },
    globals: { set: async () => {} },
    runPythonAsync: async code => {
      if (code.includes('_ctm_checkers_install')) { log.push(name + ':install'); return undefined; }
      if (!code.includes(ANY_CHECK)) return undefined;
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

test('a check on a runtime that never answers holds up no check on the next runtime', async () => {
  const log = [];
  const { context, window, api } = load();
  const hung = fakeRuntime('a', log), next = fakeRuntime('b', log);
  const run = hung.runPythonAsync;
  let sent = false;
  hung.runPythonAsync = code => {
    if (!code.includes(ANY_CHECK)) return run(code);
    sent = true;
    return new Promise(() => {});   // a worker that stopped answering
  };
  context.qpyodideInstance = Promise.resolve(hung);
  const first = api.checkField({ value: '1', dataset: { answer: '1' } }, 'equivalent', {});
  for (let i = 0; i < 400 && !sent; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(sent);
  // The page's Python is replaced (another component restarted it).
  window.dispatch('qpyodide-runtime-restart');
  context.mainPyodide = undefined;
  context.qpyodideInstance = Promise.resolve(next);
  const second = api.checkField({ value: '2', dataset: { answer: '2' } }, 'equivalent', {});
  const settled = await Promise.race([second.then(result => ({ ...result })), new Promise(resolve => setTimeout(() => resolve('hangs'), 2000))]);
  assert.deepEqual(settled, { status: 'correct', score: 1 });
  assert.deepEqual(log, ['a:load:sympy', 'a:install', 'b:load:sympy', 'b:install', 'b:check']);
  void first;   // never settles: its runtime never answers
});

test('learner rebinding of SymPy names and of the names call texts use does not reach the checks (CPython)', { skip: spawnSync(python, ['-c', 'import sympy']).status ? 'SymPy required' : false }, async () => {
  // Record exactly what the browser sends to Pyodide (the setup, then a
  // check: its request and ctm-libs' call text), then replay it in CPython,
  // where ctm-checkers' install code writes the wheel and imports it.
  const ops = [];
  const recorder = { loadPackage: async () => {}, globals: { set: async (name, value) => { ops.push(['set', name, value]); } },
    runPythonAsync: async code => { ops.push(['run', code]); return code.includes(ANY_CHECK) ? '{"status": "correct", "score": 1.0}' : undefined; } };
  const { api } = load({ qpyodideInstance: Promise.resolve(recorder) });
  await api.ensureSympy();
  const setup = ops.length;
  await api.checkField({ value: '1', dataset: { answer: '1' } }, 'equivalent', {});
  const call = ops.slice(setup).find(op => op[0] === 'run' && op[1].includes(ANY_CHECK))[1];
  const cleanup = ops[ops.length - 1][1];
  assert.match(cleanup, /\.pop\("_ctm_request", None\)/);
  const dir = mkdtempSync(join(tmpdir(), 'math-isolation-'));
  try {
    writeFileSync(join(dir, 'case.json'), JSON.stringify({ ops: ops.slice(0, setup), call, cleanup }));
    const script = String.raw`
import ast, builtins, json, shutil, sys
case = json.load(open(sys.argv[1]))
main = {'__name__': '__main__'}
def run(code):
    # As runPythonAsync: the value of a last expression.
    tree = ast.parse(code)
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, '<exec>', 'exec'), main)
    return eval(compile(ast.Expression(last.value), '<exec>', 'eval'), main) if last else None
for op in case['ops']:
    if op[0] == 'set':
        main[op[1]] = op[2]
    else:
        run(op[1])
left = sorted(k for k in main if k.startswith('_ctm_'))
assert left == [], ('the setup leaves no _ctm_ name in the namespace', left)
wheel = sys.modules['ctm_checkers'].__file__.split('/ctm_checkers/')[0]
exec('symbols = None\nSymbol = None\nsympify = None\nMatrix = None\nsqrt = None\nsimplify = None\nparse_expr = None\n_mj = None\n'
     '__import__ = None\nglobals = None\n_ctm_import = None\n_ctm_globals = dict\nbuiltins = None\njson = None', main)
def ask(request, name='check'):
    # The recorded call text of a check, for check_custom with that name.
    main['_ctm_request'] = json.dumps(request)
    try:
        return json.loads(run(case['call'].replace('"math_exercise.check"', '"math_exercise.' + name + '"')))
    finally:
        run(case['cleanup'])
def check(answer, key='sqrt(72)', mode='equivalent', decplaces='', sigfigs=''):
    return ask({'student': answer, 'correct': key, 'vars': '', 'mode': mode, 'reject': '', 'tolerance': '', 'decplaces': decplaces,
                'sigfigs': sigfigs, 'form': '', 'partial_credit': False, 'form_credit': 0.5})
assert check('6*sqrt(2)')['status'] == 'correct'
# The call leaves no _ctm_ name behind, the learner's _ctm_import and _ctm_globals included.
assert not [k for k in main if k.startswith('_ctm_')], sorted(k for k in main if k.startswith('_ctm_'))
# Answers are evaluated by SymPy's parser: no access to Python internals.
try:
    check("__import__('builtins').__dict__.clear()")
    raise SystemExit('dunder answer was evaluated')
except ValueError as error:
    assert 'unsupported input' in str(error)
assert builtins.len is len and check('6*sqrt(2)')['status'] == 'correct'
assert '_ctm_request' not in main
# Only the request's learner strings count: string answers are never
# evaluated; author data of a response (a variant's context) is free.
assert check('__init__', key='__init__', mode='string')['status'] == 'correct'
custom = {'checker': 'def check(response, symbols):\n    return True\n', 'vars': 'x',
          'response': {'kind': 'expressions', 'raw': ['x + 1'], 'inputs': {}, 'variant': {'context': 'The value is __important__'}}}
assert ask(custom, 'check_custom')['status'] == 'correct'
try:
    ask(dict(custom, response={'kind': 'expressions', 'raw': ['x + 1'], 'inputs': {'m': {'type': 'matrix', 'raw': ['__a']}}}), 'check_custom')
    raise SystemExit('dunder matrix entry accepted')
except ValueError:
    pass
try:
    check('x__1')
    raise SystemExit('dunder answer accepted')
except ValueError:
    pass
assert check('6*sqrt(2)')['status'] == 'correct', 'a rejected answer must not block later checks'
# Rounding as written in decimal, half away from zero: 5.395 is 5.40 to two
# places (the binary float rounds to 5.39), 0.125 is 0.13.
def numeric(answer, key, decplaces='', sigfigs=''):
    return check(answer, key=key, mode='numeric', decplaces=decplaces, sigfigs=sigfigs)['status']
assert numeric('5.395', '5.40', decplaces='2') == 'correct'
assert numeric('5.394', '5.40', decplaces='2') != 'correct'
assert numeric('0.125', '0.13', decplaces='2') == 'correct'
assert numeric('-2.5', '-3', decplaces='0') == 'correct'
assert numeric('2.675', '2.68', sigfigs='3') == 'correct'
assert numeric('1e30', '1e30', decplaces='2') == 'correct'
assert numeric('2.00', '1.05*1.9', decplaces='2') == 'correct'   # key computed as 1.9949999999999999
assert numeric('5.085', '1.13*4.5', decplaces='2') == 'correct'
shutil.rmtree(wheel.rsplit('/', 1)[0], ignore_errors=True)   # the install code wrote under /tmp/ctm-checkers
print('isolated')
`;
    const r = spawnSync(python, ['-c', script, join(dir, 'case.json')], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /isolated/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
