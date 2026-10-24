import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {install, renderEnv} from './helpers/ctm-libs.mjs';

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = spawnSync(quarto, ['--version']).status === 0;
const fixture = fileURLToPath(new URL('./fixtures/author-imports-pandoc.lua', import.meta.url));
const adapter = fileURLToPath(new URL('../_extensions/math-exercise/author-imports.lua', import.meta.url));
function run(mode, absent = false, malformed = '') {
  const dir = mkdtempSync(join(tmpdir(), 'math-import-pandoc-'));
  try {
    const input = join(dir, 'input.md');
    writeFileSync(input, `---\nmode: ${mode}\nabsent: ${absent}\nmalformed: "${malformed}"\n---\n`);
    return spawnSync(quarto, ['pandoc', input, '--from', 'markdown', '--to', 'json', '--lua-filter', fixture], {
      env: {...process.env, MATH_IMPORT_ADAPTER: adapter}, encoding: 'utf8', timeout: 30000,
    });
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
test('register actual checker fragments, generated variants and parsed package requirements', {skip: !available && 'Quarto required'}, () => {
  const result = run('local');
  assert.equal(result.status, 0, result.stderr);
  const calls = JSON.parse(JSON.parse(result.stdout).blocks[0].c[1]);
  assert.deepEqual(calls.map(x => x.source), ['import networkx', '', 'import numpy\nvalue = 1', 'import scipy\nvalue = 2']);
  assert.deepEqual(calls.map(x => x.origin), ['math-exercise plain checker', 'math-exercise built-in checker',
    'math-exercise generated variant v-one checker', 'math-exercise generated variant v-two checker']);
  assert.ok(calls.every(x => JSON.stringify(x.packages) === '["networkx","scipy"]'));
});
test('local mode stops explicitly when the package collector is missing; CDN remains usable', {skip: !available && 'Quarto required'}, () => {
  const local = run('local', true);
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /local assets need CTM Assessment's author Python collector/);
  assert.match(local.stderr, /quarto add https:\/\/erasmus-ctm.github.io\/ctm-assessment\/ctm-assessment.tar.gz/);
  const cdn = run('cdn', true);
  assert.equal(cdn.status, 0, cdn.stderr);
  assert.equal(Object.keys(JSON.parse(JSON.parse(cdn.stdout).blocks[0].c[1])).length, 0);
});

test('the real Quarto handler registers built-in, custom, pool and generated checker inputs', {skip: !available && 'Quarto required'}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-author-imports-'));
  try {
    cpSync(new URL('../_extensions/math-exercise', import.meta.url), join(dir, '_extensions/math-exercise'), {recursive: true});
    cpSync(new URL('./fixtures/author-imports-capture.lua', import.meta.url), join(dir, 'capture.lua'));
    install(dir);
    const block = (options, body = 'Answer: _[2]') => '\x60\x60\x60{math-exercise}\n' + options + '\n' + body + '\n\x60\x60\x60\n';
    const modes = ['equivalent', 'exact', 'numeric', 'string', 'string_ci', 'set'];
    const plain = modes.map(mode => block('#| label: ' + mode + '\n#| mode: ' + mode + '\n#| packages: scipy')).join('\n');
    const checker = 'import networkx\ndef check(response, symbols):\n    return {"correct": True}';
    const custom = block('#| label: custom\n#| mode: custom\n#| packages: networkx\n#| checker: |\n' + checker.split('\n').map(line => '#|   ' + line).join('\n'));
    const pool = block('#| label: pool\n#| pool: true\n#| mode: custom\n#| packages: networkx\n#| checker: |\n' + checker.split('\n').map(line => '#|   ' + line).join('\n'), 'Answer: _[]\n---\nAnother: _[]');
    const generated = block('#| label: generated\n#| variables: |\n#|   a = pick([1, 2])\n#| field-labels: Answer\n#| note: a={#a#}\n#| mode: custom\n#| packages: numpy, scipy\n#| checker: |\n#|   import fractions\n#|   def check(response, symbols):\n#|       return {"correct": response["answers"]["Answer"] == response["teacher"]["Answer"]}', 'Answer: _[{#a#}]');
    writeFileSync(join(dir, 'lesson.qmd'), '---\nformat: html\nfilters: [capture.lua, math-exercise]\nmath-exercise: {feedback: false}\n---\n\n' + plain + custom + pool + generated);
    const output = join(dir, 'imports.json');
    const result = spawnSync(quarto, ['render', 'lesson.qmd'], {cwd: dir, env: {...renderEnv, CTM_VARIANTS: 'review', MATH_IMPORT_CAPTURE: output}, encoding: 'utf8', timeout: 120000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const fragments = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(fragments.length, 10);
    for (const mode of modes) {
      const entry = fragments.find(x => x.origin === 'math-exercise ' + mode + ' checker');
      assert.equal(entry.source, '');
      assert.deepEqual(entry.packages, ['scipy']);
    }
    for (const name of ['custom', 'pool']) {
      const entry = fragments.find(x => x.origin === 'math-exercise ' + name + ' checker');
      assert.equal(entry.source.trimEnd(), checker);
      assert.deepEqual(entry.packages, ['networkx']);
    }
    const variants = fragments.filter(x => x.origin.startsWith('math-exercise generated variant '));
    assert.equal(variants.length, 2);
    assert.ok(variants.every(x => /import fractions/.test(x.source) && !x.source.includes('{#')));
    assert.equal(new Set(variants.map(x => x.source)).size, 1, 'native checker reads exact context instead of interpolating code');
    assert.ok(variants.every(x => x.source.includes('response["teacher"]["Answer"]')));
    assert.ok(variants.every(x => JSON.stringify(x.packages) === '["numpy","scipy"]'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

for (const malformed of ['boolean', 'invalid']) test('local mode diagnoses a ' + malformed + ' collector; CDN remains usable', {skip: !available && 'Quarto required'}, () => {
  const local = run('local', false, malformed);
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /local assets need CTM Assessment's author Python collector/);
  assert.doesNotMatch(local.stderr, /attempt to index/);
  const cdn = run('cdn', false, malformed);
  assert.equal(cdn.status, 0, cdn.stderr);
});
