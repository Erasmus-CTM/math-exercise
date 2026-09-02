import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [readme, basisApi] = await Promise.all([
  read('README.md'),
  read('docs/assess-basis.md'),
]);

test('README links to the dedicated basis API before resuming general examples', () => {
  const basis = readme.indexOf('#### Matrix basis assessment');
  const general = readme.indexOf('#### General custom-checker example');
  assert.ok(basis >= 0);
  assert.ok(general > basis);
  assert.match(readme, /\[complete `assess_basis` API reference\]\(docs\/assess-basis\.md\)/);
  assert.doesNotMatch(readme, /#### Shared basis assessment/);
});

test('README links graph construction to its dedicated API reference', () => {
  const graph = readme.indexOf('#### Graph construction assessment');
  const general = readme.indexOf('#### General custom-checker example');
  assert.ok(graph >= 0);
  assert.ok(general > graph);
  assert.match(readme, /\[complete graph-editor API\s+reference\]\(docs\/graph-editor\.md\)/);
});

test('basis API uses GitHub-compatible math and balanced nested fences', () => {
  assert.match(basisApi, /^# `assess_basis` API reference/m);
  assert.match(basisApi, /\$d\$/);
  assert.match(basisApi, /\$\$\n\\frac\{\\min\(r,d\)\}/);
  assert.doesNotMatch(basisApi, /\\\[|\\\]/);
  assert.doesNotMatch(basisApi, /\\\(|\\\)/);
  assert.match(basisApi, /````markdown\n```\{math-exercise\}[\s\S]*?```\n````/);
});
