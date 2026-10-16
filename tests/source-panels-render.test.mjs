import assert from 'node:assert/strict';
import test from 'node:test';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
for (const namespaced of [false, true]) test(`source and policy panels stay separate (${namespaced ? 'named policy, namespaced install' : 'shared defaults'})`, {skip: available ? false : 'Quarto is required'}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-source-panels-'));
  try {
    cpSync(new URL('../_extensions/math-exercise', import.meta.url), join(dir, '_extensions/math-exercise'), {recursive:true});
    const shared = join(dir, '_extensions', namespaced ? 'Erasmus-CTM/ai-feedback' : 'ai-feedback');
    cpSync(process.env.AI_FEEDBACK_EXTENSION, shared, {recursive:true});
    mkdirSync(join(dir, '_filters'));
    cpSync(new URL('../_filters/example-source.lua', import.meta.url), join(dir, '_filters/example-source.lua'));
    const policy = 'ai-feedback:\n  policies:\n    custom-hint:\n      steps:\n        - step-prompt: Ask about the first algebraic step.\n';
    writeFileSync(join(dir, 'policy.yml'), policy);
    const metadata = namespaced ? 'ai-feedback:\n  page-policy-files: policy.yml\n' : '';
    writeFileSync(join(dir, 'lesson.qmd'), '---\nformat: html\nfilters: [_filters/example-source.lua, math-exercise]\n' + metadata + '---\n\n```{math-exercise}\n#| label: example\n' + (namespaced ? '#| feedback-policy: custom-hint\n' : '') + 'Compute 2+2: _[4].\n```\n');
    const result = spawnSync(quarto, ['render','lesson.qmd'], {cwd:dir,encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stderr || result.error?.message);
    const dom = new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));
    const doc = dom.window.document;
    const source = doc.querySelector('details[data-source-kind="exercise"]');
    const yaml = doc.querySelector('details[data-source-kind="policy"]');
    assert.ok(source && yaml);
    assert.equal(source.parentElement,yaml.parentElement);
    assert.equal(source.open,false); assert.equal(yaml.open,false);
    assert.equal(source.querySelectorAll('code.language-yaml').length,0);
    assert.equal(yaml.querySelectorAll('code.language-markdown').length,0);
    assert.equal(yaml.querySelector('code').textContent,readFileSync(join(shared,'feedback-defaults.yml'),'utf8'));
    assert.match(yaml.textContent,/Ask exactly one guiding question/);
    assert.match(yaml.textContent,/Provide a concise complete worked solution/);
    if (namespaced) assert.equal(yaml.querySelectorAll('code')[1].textContent,policy);
    source.open=true; assert.equal(yaml.open,false);
    yaml.open=true; source.open=false; assert.equal(yaml.open,true);
    dom.window.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
