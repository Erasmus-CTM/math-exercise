import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
  new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url),
  'utf8',
);

function loadBundle(lang = 'en') {
  const context = {
    console,
    document: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    window: {
      __mathExerciseConfig: { lang },
      __mathExerciseTestMode: true,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.__mathExerciseTestApi;
}

test('well-formed Markdown tables render as safe responsive HTML', () => {
  const api = loadBundle();
  const html = api.simpleMarkdown([
    '| Curve | Error | Digits |',
    '|---|---:|:---|',
    '| Blue | $10^{-4}$ | **4** |',
    '| <script>alert(1)</script> | `value` | 3 |',
  ].join('\n'));

  assert.match(html, /class="math-fb-table-wrap"/);
  assert.match(html, /<thead><tr><th>Curve<\/th><th>Error<\/th><th>Digits<\/th><\/tr><\/thead>/);
  assert.match(html, /\$10\^\{-4\}\$/);
  assert.match(html, /<strong>4<\/strong>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('malformed tables remain escaped text instead of becoming HTML tables', () => {
  const api = loadBundle();
  const html = api.simpleMarkdown('| A | B |\n| not-a-separator | -- |\n| 1 | 2 |');

  assert.doesNotMatch(html, /<table/);
  assert.match(html, /\| A \| B \|/);
});

test('ordinary mathematical pipes are not interpreted as a table', () => {
  const api = loadBundle();
  const html = api.simpleMarkdown('For $|x| < 2$, compare $|x-y|$ with 1.');

  assert.doesNotMatch(html, /<table/);
  assert.match(html, /\$\|x\| &lt; 2\$/);
});

test('all feedback languages explicitly discourage Markdown tables', () => {
  for (const lang of ['en', 'de', 'nb']) {
    const api = loadBundle(lang);
    assert.ok(api.sysPrompt(4, false).includes(api.locale.promptFormatting));
    assert.match(api.locale.promptFormatting, /table|tabelle|tabell/i);
  }
});

test('error messages do not repeat the localized error label', () => {
  const cases = [
    ['en', 'Error:', 'Error: Error: The model failed.', 'The model failed.'],
    ['de', 'Fehler:', 'Fehler: Das Modell ist fehlgeschlagen.', 'Das Modell ist fehlgeschlagen.'],
    ['nb', 'Feil:', 'Feil: Modellen mislyktes.', 'Modellen mislyktes.'],
  ];
  for (const [lang, prefix, input, expected] of cases) {
    const api = loadBundle(lang);
    assert.equal(api.locale.errorPrefix, prefix);
    assert.equal(api.displayErrorMessage(input), expected);
    assert.equal(api.displayErrorMessage(new Error(expected)), expected);
  }
});
