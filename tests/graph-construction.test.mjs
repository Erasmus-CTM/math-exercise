import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const [source, lua, jsxLua, editorSource, examples, docs, quarto, graphics] = await Promise.all([
  readFile(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8'),
  readFile(new URL('../_extensions/math-exercise/math-exercise.lua', import.meta.url), 'utf8'),
  readFile(new URL('../_extensions/jsxgraph/lua/jsxgraph.lua', import.meta.url), 'utf8'),
  readFile(new URL('../_extensions/jsxgraph/graph-editor.js', import.meta.url), 'utf8'),
  readFile(new URL('../_includes/graph-theory-examples.qmd', import.meta.url), 'utf8'),
  readFile(new URL('../docs/graph-editor.md', import.meta.url), 'utf8'),
  readFile(new URL('../_quarto.yml', import.meta.url), 'utf8'),
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

function sympyBootstrap() {
  const match = source.match(/runPythonAsync\(\[\n([\s\S]*?)\n    \]\.join\('\\n'\)\)/);
  assert.ok(match, 'could not locate the embedded Python bootstrap');
  return vm.runInNewContext(`[${match[1]}]`).join('\n');
}

function checker(label) {
  const start = examples.indexOf(`#| label: ${label}`);
  assert.ok(start >= 0, `${label} exercise is missing`);
  const block = examples.slice(start, examples.indexOf('\n```', start));
  return block.split('\n')
    .filter((line) => line.startsWith('#|   '))
    .map((line) => line.slice(5))
    .join('\n');
}

function graph(nodes, edges) {
  return {
    representation: 'undirected-graph',
    nodes: nodes.map((id) => ({ id, x: id, y: -id })),
    edges,
  };
}

test('package lists are validated, deduplicated, and loaded only once', async () => {
  const loaded = [];
  const api = loadBundle(async (name) => { loaded.push(name); });

  assert.deepEqual(Array.from(api.parsePackageList([' networkx ', 'NetworkX', 'sympy'])), ['networkx', 'sympy']);
  assert.throws(() => api.parsePackageList(['https://example.test/package.whl']), /Invalid Pyodide package name/);

  await Promise.all([api.ensurePackages(['networkx']), api.ensurePackages(['NetworkX'])]);
  await api.ensurePackages(['networkx']);
  assert.deepEqual(loaded, ['networkx']);
});

test('graph editor creates vertices, toggles edges, serializes, and registers', () => {
  const container = {
    id: 'board', style: {}, children: [], listeners: {}, attributes: {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const events = {};
  const createdPoints = [];
  const registrations = [];
  const resizeCalls = [];
  const board = {
    containerObj: container,
    canvasWidth: 0,
    canvasHeight: 0,
    getBoundingBox: () => [-5, 4, 5, -4],
    getMousePosition: (event) => [event.clientX ?? event.x, event.clientY ?? event.y],
    create(type, args, attributes) {
      if (type === 'point') {
        const rendererAttributes = {};
        const point = {
          x: args[0], y: args[1], attributes,
          rendNode: {
            parentNode: container,
            closest: () => null,
            setAttribute(name, value) { rendererAttributes[name] = value; },
            getAttribute(name) { return rendererAttributes[name] ?? null; },
          },
          X() { return this.x; }, Y() { return this.y; },
          setAttribute(next) { Object.assign(this.attributes, next); },
          hasPoint(screenX, screenY) {
            if (!(container.clientWidth > 0 && container.clientHeight > 0)) return false;
            const ownX = (this.x + 5) / 10 * container.clientWidth;
            const ownY = (4 - this.y) / 8 * container.clientHeight;
            return (screenX - ownX) ** 2 + (screenY - ownY) ** 2 <= 100;
          },
        };
        createdPoints.push(point);
        return point;
      }
      if (type === 'button') return { text: args[2], setText(text) { this.text = text; } };
      return { type, args, attributes };
    },
    on(name, callback) { events[name] = callback; },
    resizeContainer(width, height) {
      this.canvasWidth = width;
      this.canvasHeight = height;
      resizeCalls.push([width, height]);
    },
    fullUpdate() {},
    update() {},
    removeObject() {},
  };
  const element = () => ({
    style: {}, children: [], textContent: '', listeners: {},
    setAttribute() {},
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  });
  const context = {
    document: {
      createElement: element,
      querySelector: () => container,
    },
    JXG: {
      JSXGraph: { initBoard: () => board },
      QuartoAssessment: { register: (spec) => registrations.push(spec) },
      Coords: function (_mode, screen) { this.usrCoords = [1, screen[0] / 10, screen[1] / 10]; },
      COORDS_BY_SCREEN: 0,
    },
  };
  vm.createContext(context);
  vm.runInContext(editorSource, context);

  const editor = context.JXG.QuartoGraphEditor.createBoard();
  const first = editor.addVertex(-1.25, 0.5);
  const second = editor.addVertex(1.25, -0.5);
  assert.equal(editor.toggleEdge(first, second), true);
  assert.equal(editor.toggleEdge(first, second), false);
  assert.equal(editor.toggleEdge(first, second), true);
  const expected = {
    representation: 'undirected-graph',
    nodes: [{ id: 1, x: -1.25, y: 0.5 }, { id: 2, x: 1.25, y: -0.5 }],
    edges: [[1, 2]],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(editor.response())), expected);
  assert.equal(editor.showControls(true), true);
  assert.equal(container.children[0].style.display, 'block');
  assert.equal(container.attributes['data-graph-editor-ready'], 'true');
  assert.equal(container.children[1].children[2].textContent, 'Hide controls');
  assert.equal(typeof container.listeners.mousedown, 'function');
  editor.register();
  assert.equal(registrations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(registrations[0].response())), expected);

  editor.clear();
  container.clientWidth = 800;
  container.clientHeight = 520;
  assert.equal(editor.resize(), true);
  assert.deepEqual(resizeCalls, [[800, 520]]);
  const blankTarget = { closest: () => null };
  container.listeners.mousedown({ button: 0, clientX: 400, clientY: 260, target: blankTarget });
  assert.deepEqual(JSON.parse(JSON.stringify(editor.response().nodes)), [{ id: 1, x: 0, y: 0 }]);
  container.listeners.mousedown({ button: 0, clientX: 560, clientY: 260, target: blankTarget });
  const [firstClicked, secondClicked] = createdPoints.slice(-2);
  assert.equal(firstClicked.rendNode.getAttribute('data-graph-vertex-id'), '1');
  assert.equal(secondClicked.rendNode.getAttribute('data-graph-vertex-id'), '2');
  container.listeners.mousedown({ button: 0, clientX: 10, clientY: 10, target: firstClicked.rendNode });
  assert.equal(firstClicked.attributes.fillColor, '#f59e0b');
  container.listeners.mousedown({ button: 0, clientX: 10, clientY: 10, target: secondClicked.rendNode });
  assert.deepEqual(JSON.parse(JSON.stringify(editor.response().edges)), [[1, 2]]);
});

test('Lua injects the common editor and exercise packages reach the runtime', () => {
  assert.match(jsxLua, /GRAPH_EDITOR_JS = ioRead/);
  assert.match(jsxLua, /assessment_bridge, GRAPH_EDITOR_JS, jsxgraph/);
  assert.match(lua, /data-packages=.*jsonArrAttr\(packages\)/);
  assert.match(source, /def graph_from_response\(response, \*, directed=False\):/);
  assert.equal((examples.match(/#\| packages: networkx/g) || []).length, 4);
  assert.match(docs, /## `graph_from_response\(response, \*, directed=False\)`/);
});

test('graph theory is the final examples tab and exercises use the requested order', () => {
  const tree = examples.indexOf('## Construct a tree');
  const euler = examples.indexOf('## Give a graph with an Euler circuit');
  const nonplanar = examples.indexOf('## Make a non-planar graph');
  const bipartite = examples.indexOf('## Give an example of a bipartite graph');
  assert.ok(tree >= 0 && tree < euler && euler < nonplanar && nonplanar < bipartite);
  assert.equal((examples.match(/#\| caption:/g) || []).length, 0);
  assert.doesNotMatch(graphics, /bipartite-graph-board/);
  assert.match(quarto, /- href: dynamic-matrix-tests\.qmd\n\s+text: Dynamic matrices\n\s+- href: graph-theory\.qmd\n\s+text: Graph theory\n\s+right:/);
});

test('shared response conversion and all four NetworkX checkers work', () => {
  const fixtures = {
    tree: graph([1, 2, 3, 4, 5], [[1, 2], [2, 3], [3, 4], [4, 5]]),
    treeCycle: graph([1, 2, 3, 4, 5], [[1, 2], [2, 3], [3, 1], [3, 4], [4, 5]]),
    euler: graph([1, 2, 3, 4], [[1, 2], [2, 3], [3, 4], [4, 1]]),
    nonEuler: graph([1, 2, 3, 4], [[1, 2], [2, 3], [3, 4], [4, 1], [1, 3]]),
    nonplanar: graph([1, 2, 3, 4, 5], [
      [1, 2], [1, 3], [1, 4], [1, 5], [2, 3],
      [2, 4], [2, 5], [3, 4], [3, 5], [4, 5],
    ]),
    planar: graph([1, 2, 3, 4, 5], [
      [1, 2], [1, 3], [1, 4], [1, 5], [2, 3],
      [2, 4], [2, 5], [3, 4], [3, 5],
    ]),
    bipartite: graph([1, 2, 3, 4], [[1, 2], [2, 3], [3, 4], [4, 1]]),
    oddCycle: graph([1, 2, 3, 4], [[1, 2], [2, 3], [3, 1], [3, 4]]),
  };
  const script = [
    sympyBootstrap(),
    `fixtures = ${JSON.stringify(fixtures)}`,
    `exec(${JSON.stringify(checker('jsxgraph-tree-construction'))})`,
    'assert check(fixtures["tree"], {})["score"] == 1',
    'assert check(fixtures["treeCycle"], {})["score"] == 0',
    `exec(${JSON.stringify(checker('jsxgraph-euler-construction'))})`,
    'assert check(fixtures["euler"], {})["score"] == 1',
    'assert check(fixtures["nonEuler"], {})["score"] == 0',
    `exec(${JSON.stringify(checker('jsxgraph-nonplanar-construction'))})`,
    'assert check(fixtures["nonplanar"], {})["score"] == 1',
    'assert check(fixtures["planar"], {})["score"] == 0',
    `exec(${JSON.stringify(checker('jsxgraph-bipartite-construction'))})`,
    'assert check(fixtures["bipartite"], {})["score"] == 1',
    'assert check(fixtures["oddCycle"], {})["score"] == 0',
    'converted = graph_from_response(fixtures["bipartite"])',
    'assert converted.nodes[1]["x"] == 1.0 and converted.nodes[1]["y"] == -1.0',
    'malformed = fixtures["bipartite"].copy()',
    'malformed["edges"] = [[1, 2], [2, 1]]',
    'try:',
    '    graph_from_response(malformed)',
    '    raise AssertionError("duplicate edge was accepted")',
    'except ValueError:',
    '    pass',
  ].join('\n');
  const result = spawnSync(process.env.PYTHON || 'python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
