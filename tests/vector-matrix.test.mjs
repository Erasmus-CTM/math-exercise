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

test('renders scalar, vector, and matrix markers in document order', () => {
  const rendered = loadBundle().renderTaskText(
    'Scalar _[7], vector vec[1,2], matrix mat[1,0;0,1].',
    'mixed',
    '',
    'col',
  );

  assert.equal(rendered.fieldIds.length, 7);
  assert.deepEqual(
    Array.from(rendered.structuralLabels),
    ['', 'v1', 'v2', 'm1,1', 'm1,2', 'm2,1', 'm2,2'],
  );
  assert.match(rendered.html, /class="math-vec"/);
  assert.match(rendered.html, /class="math-mat"/);
});

test('row vectors receive the row layout class', () => {
  const rendered = loadBundle().renderTaskText('vec[1,2,3]', 'row', '', 'row');
  assert.match(rendered.html, /class="math-vec math-vec-row"/);
});

test('nested commas remain inside one component', () => {
  const api = loadBundle();
  const rendered = api.renderTaskText('vec[atan2(y,x),sqrt(x+1)]', 'nested', 'x,y', 'col');
  assert.equal(rendered.fieldIds.length, 2);
  assert.match(rendered.html, /data-answer="atan2\(y,x\)"/);
});

test('ordinary words ending in mat are not parsed as matrices', () => {
  const rendered = loadBundle().renderTaskText('Use format[x] here.', 'boundary', 'x', 'col');
  assert.equal(rendered.fieldIds.length, 0);
  assert.equal(rendered.html, 'Use format[x] here.');
});

test('ragged matrices fail early with an author-facing error', () => {
  assert.throws(
    () => loadBundle().renderTaskText('mat[1,2;3]', 'ragged', '', 'col'),
    /same number of columns/,
  );
});

test('structural labels are localized in every supported language', () => {
  const expected = {
    en: ['Component 2', 'Row 1, column 2'],
    de: ['Komponente 2', 'Zeile 1, Spalte 2'],
    nb: ['Komponent 2', 'Rad 1, kolonne 2'],
  };
  for (const [lang, labels] of Object.entries(expected)) {
    const api = loadBundle(lang);
    assert.equal(api.localizeStructuralLabel('v2'), labels[0]);
    assert.equal(api.localizeStructuralLabel('m1,2'), labels[1]);
  }
});

test('renders a named matrix with fixed rows and variable columns', () => {
  const rendered = loadBundle().renderTaskText(
    'mat{name=Z, rows=3, cols=auto, initial-cols=1, min-cols=0, max-cols=3}',
    'dynamic-cols',
    '',
    'col',
    'custom',
  );
  assert.equal(rendered.fieldIds.length, 3);
  assert.deepEqual(
    Array.from(rendered.structuralLabels),
    ['dm:Z:1,1', 'dm:Z:2,1', 'dm:Z:3,1'],
  );
  assert.match(rendered.html, /class="math-mat math-dynamic-mat"/);
  assert.match(rendered.html, /data-auto-cols="true"/);
  assert.match(rendered.html, /data-min-cols="0"/);
  assert.match(rendered.html, /data-max-cols="3"/);
});

test('supports matrices that initially have zero rows or columns', () => {
  const api = loadBundle();
  const zeroColumns = api.renderTaskText(
    'mat{name=Z, rows=3, cols=auto, initial-cols=0, min-cols=0, max-cols=3}',
    'zero-cols', '', 'col', 'custom',
  );
  const zeroRows = api.renderTaskText(
    'mat{name=A, rows=auto, cols=2, initial-rows=0, min-rows=0, max-rows=3}',
    'zero-rows', '', 'col', 'custom',
  );
  assert.equal(zeroColumns.fieldIds.length, 0);
  assert.equal(zeroRows.fieldIds.length, 0);
  assert.match(zeroColumns.html, /data-rows="3" data-cols="0"/);
  assert.match(zeroRows.html, /data-rows="0" data-cols="2"/);
});

test('validates dynamic matrix declarations and custom-only use', () => {
  const api = loadBundle();
  assert.throws(
    () => api.renderTaskText('mat{name=A, rows=2, cols=auto}', 'mode', '', 'col'),
    /requires mode: custom/,
  );
  assert.throws(
    () => api.parseDynamicMatrixSpec('name=A, rows=auto, min-rows=3, max-rows=2, cols=2'),
    /cannot exceed/,
  );
  assert.throws(
    () => api.renderTaskText(
      'mat{name=A, rows=2, cols=auto} mat{name=A, rows=2, cols=auto}',
      'duplicate', '', 'col', 'custom',
    ),
    /duplicate dynamic matrix name/,
  );
});

test('dynamic matrix labels and AI answer summaries include shape', () => {
  const api = loadBundle('en');
  assert.equal(api.localizeStructuralLabel('dm:Z:2,3'), 'Z, row 2, column 3');
  const xml = api.expressionAnswersXml([], {
    Z: { type: 'matrix', rows: 3, cols: 0, raw: [] },
    A: { type: 'matrix', rows: 1, cols: 2, raw: ['x', '1'] },
  });
  assert.match(xml, /<matrix name="Z" rows="3" columns="0">/);
  assert.match(xml, /<row index="3"><\/row>/);
  assert.match(xml, /<matrix name="A" rows="1" columns="2">/);
  assert.match(xml, /<entry column="1">x<\/entry>/);
});
