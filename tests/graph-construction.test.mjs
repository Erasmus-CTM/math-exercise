import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const [source, lua, examples] = await Promise.all([
  readFile(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8'),
  readFile(new URL('../_extensions/math-exercise/math-exercise.lua', import.meta.url), 'utf8'),
  readFile(new URL('../_includes/graphics-new-examples.qmd', import.meta.url), 'utf8'),
]);

function loadBundle(loadPackage) {
  const context = {
    console,
    document: { addEventListener() {} },
    mainPyodide: { loadPackage },
    setTimeout,
    clearTimeout,
    window: {
      __mathExerciseConfig: { lang: 'en' },
      __mathExerciseTestMode: true,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.__mathExerciseTestApi;
}

function bipartiteChecker() {
  const start = examples.indexOf('#| label: jsxgraph-bipartite-construction');
  assert.ok(start >= 0, 'bipartite exercise is missing');
  const block = examples.slice(start, examples.indexOf('\n```', start));
  return block.split('\n')
    .filter((line) => line.startsWith('#|   '))
    .map((line) => line.slice(5))
    .join('\n');
}

test('package lists are validated, deduplicated, and loaded only once', async () => {
  const loaded = [];
  const api = loadBundle(async (name) => { loaded.push(name); });

  assert.deepEqual(Array.from(api.parsePackageList([' networkx ', 'NetworkX', 'sympy'])), ['networkx', 'sympy']);
  assert.throws(() => api.parsePackageList(['https://example.test/package.whl']), /Invalid Pyodide package name/);

  await Promise.all([
    api.ensurePackages(['networkx']),
    api.ensurePackages(['NetworkX']),
  ]);
  await api.ensurePackages(['networkx']);
  assert.deepEqual(loaded, ['networkx']);
});

test('Lua passes declared packages to the browser runtime', () => {
  assert.match(lua, /local packages\s+= splitCsv\(opts\["packages"\]/);
  assert.match(lua, /data-packages=.*jsonArrAttr\(packages\)/);
  assert.match(examples, /#\| packages: networkx/);
});

test('NetworkX checker accepts a square and rejects invalid constructions', () => {
  const cases = String.raw`
valid = {
    "representation": "undirected-graph",
    "nodes": [{"id": i, "x": 0, "y": 0} for i in range(4)],
    "edges": [[0, 1], [1, 2], [2, 3], [3, 0]],
}
assert check(valid, {})["score"] == 1

odd_cycle = {
    "representation": "undirected-graph",
    "nodes": [{"id": i} for i in range(4)],
    "edges": [[0, 1], [1, 2], [2, 0], [2, 3]],
}
assert check(odd_cycle, {})["score"] == 0
assert "odd cycle" in check(odd_cycle, {})["feedback"]

disconnected = {
    "representation": "undirected-graph",
    "nodes": [{"id": i} for i in range(6)],
    "edges": [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]],
}
assert check(disconnected, {})["score"] == 0
assert "connected" in check(disconnected, {})["feedback"]

duplicate_edge = {
    "representation": "undirected-graph",
    "nodes": [{"id": i} for i in range(4)],
    "edges": [[0, 1], [1, 0], [1, 2], [2, 3]],
}
assert check(duplicate_edge, {})["score"] == 0
assert "malformed" in check(duplicate_edge, {})["feedback"]
`;
  const result = spawnSync(
    process.env.PYTHON || 'python3',
    ['-c', `${bipartiteChecker()}\n${cases}`],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
