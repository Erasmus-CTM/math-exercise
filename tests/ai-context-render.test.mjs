import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadPage, typesetMathJax, requestFeedback, clickFeedback } from './helpers/ai-context.mjs';

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;

for (const renderer of ['mathjax', 'katex']) {
  test(`Quarto ${renderer}: source survives rendering, nested tabs and request serialization`,
    { skip: available ? false : 'Quarto is required; set QUARTO_BIN or install quarto' }, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'math-exercise-context-'));
      let page;
      try {
        await cp(new URL('../_extensions/math-exercise/', import.meta.url), path.join(dir, '_extensions/math-exercise'), { recursive: true });
        let fixture = await readFile(new URL('./fixtures/ai-context.qmd', import.meta.url), 'utf8');
        fixture = fixture.replace('html-math-method: mathjax', 'html-math-method: ' + renderer)
          .replace('REPLACE_WITH_OVERSIZED_MATH_PARAGRAPH', 'Oversized formula $\\frac{' + 'x+'.repeat(800) + '1}{l}$ ends here.');
        await writeFile(path.join(dir, 'fixture.qmd'), fixture);
        await cp(process.env.AI_FEEDBACK_EXTENSION, path.join(dir, '_extensions/ai-feedback'), {recursive:true});
        const render = spawnSync(quarto, ['render', 'fixture.qmd', '--to', 'html'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
        assert.equal(render.status, 0, render.stderr || render.error?.message);
        const html = await readFile(path.join(dir, 'fixture.html'), 'utf8');
        page = loadPage(html);
        const cell = label => page.document.querySelector(`[data-label="${label}"]`);

        const source = page.document.querySelector('#coil-context [data-ai-feedback-tex]');
        assert.equal(source.dataset.aiFeedbackTex, String.raw`\frac{N}{l}`);
        const auto = page.api.resolveContexts(cell('auto'))[0].text;
        assert.ok(auto.includes(String.raw`\(10^{-7}\)`));
        assert.ok(auto.includes(String.raw`\(\frac{N}{l}\)`));
        assert.doesNotMatch(auto, /DO_NOT_SEND_CODE/);
        const budget = page.api.resolveContexts(cell('budget'))[0].text;
        assert.equal(budget, String.raw`Recent whole paragraph: \(\frac{N}{l}\), strøm, blåbær.`);
        assert.ok(budget.length <= 1500);

        const before = await requestFeedback(page, cell('explicit'), ['Inductance']);
        assert.ok(before.includes(String.raw`\(\frac{N}{l}\)`));
        assert.match(before, /\\\[\s*\\begin\{aligned\}/);
        assert.ok(before.includes(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`));
        assert.ok(before.includes('[Inductance]'));
        assert.doesNotMatch(before, /SECRET_|DO_NOT_SEND_|data-answer/);

        // The page-level MathJax pass can precede the exercise's KaTeX pass.
        // Both the task and its external context must be independent of timing.
        if (renderer === 'mathjax') typesetMathJax(page, 4);
        const after = await requestFeedback(page, cell('explicit'), ['Inductance']);
        assert.equal(after, before);
        assert.equal(page.api.resolveContexts(cell('none')).length, 0);
        const captioned = await requestFeedback(page, cell('auto'), ['Density']);
        assert.ok(captioned.includes(String.raw`Density $\frac{N}{l}$`));
        assert.doesNotMatch(captioned, /SECRET_|DO_NOT_SEND_CODE/);

        const pool = cell('pool');
        page.window.Math.random = () => 0;
        page.api.setupCell(pool);
        for (let draw = 0; draw < 2; draw++) {
          if (draw) {
            page.window.Math.random = () => 0.75;
            pool.querySelector('.math-pool-reload').click();
          }
          pool.querySelector('input').value = 'STUDENT_WORK';
          const payload = await clickFeedback(page, pool);
          assert.doesNotMatch(payload, /SECRET_|data-answer/);
          assert.ok(payload.includes('[Answer]'));
          assert.ok(payload.includes('STUDENT_WORK'));
          const task = JSON.parse(payload).task;
          assert.ok(task.includes(draw ? String.raw`\frac{4\pi\mu_0N^2a^2}{l}` : String.raw`\frac{N}{l}`));
          assert.doesNotMatch(task, /STUDENT_WORK/);
        }
        assert.deepEqual(page.warnings, []);
      } finally {
        page?.dom.window.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
}
