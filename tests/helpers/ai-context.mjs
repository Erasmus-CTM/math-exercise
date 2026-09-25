import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import katex from 'katex';

const require = createRequire(import.meta.url);
const shared = await Promise.all(['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js'].map(name => readFile(new URL('../../_extensions/math-exercise/ai-feedback/' + name, import.meta.url), 'utf8')));
const source = await readFile(new URL('../../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');

export function loadPage(html = '', config = {}) {
  const dom = new JSDOM(html, { url: 'https://example.invalid/exercises', runScripts: 'outside-only' });
  const w = dom.window;
  // Exercise extraction and the real request builder, without CDN/Pyodide startup.
  w.document.addEventListener = () => {};
  w.__mathExerciseTestMode = true;
  w.__mathExerciseConfig = config;
  const warnings = [];
  w.console.warn = (...args) => warnings.push(args.join(' '));
  const requests = [];
  w.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Which area carries the shared flux?' } }] }),
    };
  };
  shared.forEach(code => w.eval(code));
  w.AIFeedback.typesetFeedback = async () => {};
  w.eval(source);
  return { dom, window: w, document: w.document, api: w.__mathExerciseTestApi, warnings, requests };
}

export function typesetMathJax(page, version = 4, output = 'chtml') {
  const base = version === 4 ? '@mathjax/src/cjs/' : 'mathjax-full/js/';
  const { mathjax } = require(base + 'mathjax.js');
  const { TeX } = require(base + 'input/tex.js');
  const { HTMLAdaptor } = require(base + 'adaptors/HTMLAdaptor.js');
  const { RegisterHTMLHandler } = require(base + 'handlers/html.js');
  require(base + 'input/tex/ams/AmsConfiguration.js');
  const adaptor = new HTMLAdaptor(page.window);
  const handler = RegisterHTMLHandler(adaptor);
  const Output = output === 'svg'
    ? require(base + 'output/svg.js').SVG
    : require(base + 'output/chtml.js').CHTML;
  const mj = mathjax.document(page.document, {
    InputJax: new TeX({
      packages: ['base', 'ams'],
      inlineMath: [['\\(', '\\)'], ['$', '$']],
      displayMath: [['\\[', '\\]'], ['$$', '$$']],
    }),
    OutputJax: new Output(output === 'chtml' ? { fontURL: 'https://example.invalid/fonts' } : {}),
  });
  mj.render();
  page.window.MathJax = { startup: { document: mj } };
  mathjax.handlers.unregister(handler);
  return mj;
}

export function typesetKatex(el, tex, displayMode = false) {
  el.innerHTML = katex.renderToString(tex, { displayMode });
}

export async function requestFeedback(page, cell, labels = ['Answer']) {
  const ids = JSON.parse(cell.dataset.fields || '[]');
  const question = page.api.questionText(cell, ids, i => labels[i] || `Field ${i + 1}`);
  await page.api.callLLM(question, '<field>student value</field>', '<field>incorrect</field>',
    page.api.resolveContexts(cell), 1,
    { baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test-model' });
  return page.requests.at(-1).body.messages[1].content;
}

export async function clickFeedback(page, cell) {
  // The UI/checker/request boundary is real; only Python execution and HTTP
  // are mocked. Checker mathematics is covered by the existing Python tests.
  page.window.mainPyodide = {
    loadPackage: async () => {},
    runPythonAsync: async () => JSON.stringify({ status: 'wrong', score: 0 }),
    globals: { set() {} },
  };
  page.window.AIFeedback.saveConfig({ mode: 'api', storage: 'local',
    baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test-model',
  });
  const count = page.requests.length;
  const button = cell.querySelector('.math-feedback-btn');
  button.click();
  for (let i = 0; i < 20 && button.disabled; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (button.disabled || page.requests.length !== count + 1) {
    throw new Error('Feedback did not send exactly one request: ' + cell.querySelector('.math-feedback-area').textContent);
  }
  return page.requests.at(-1).body.messages[1].content;
}
