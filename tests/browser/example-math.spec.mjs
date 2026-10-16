import {readFileSync} from 'node:fs';
import {test, expect} from 'playwright/test';

// Keep the audit tied to the complete published site, including the legacy
// all-in-one page and generated variants, rather than a few chosen examples.
const project = readFileSync(new URL('../../_quarto.yml', import.meta.url), 'utf8');
const pages = [...project.split('  render:\n')[1].split('\n\n')[0].matchAll(/- (.+)\.qmd/g)].map(match => match[1]);

for (const name of pages) test(`${name}: all task formulas render, including every pool draw`, async ({page}) => {
  await page.goto(`/${name}.html`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => !document.querySelector('.math-reconfig-btn'));
  await page.evaluate(async () => { await window.MathJax?.startup?.promise; });
  const report = await page.evaluate(() => {
    const failures = [];
    let questions = 0, formulas = 0;
    function inspectMath(q, source, label) {
      // Count before HTML parsing: parsing malformed source here would lose
      // the same inequality as the page and conceal the original regression.
      const expected = (source.match(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g) || []).length;
      const actual = q.querySelectorAll('.katex, mjx-container').length;
      const text = q.cloneNode(true);
      text.querySelectorAll('.katex, mjx-container').forEach(node => node.remove());
      if (actual !== expected || /\\[()[\]]/.test(text.textContent) || q.querySelector('.katex-error, mjx-merror, [data-mjx-error]')) {
        failures.push({label, expected, actual, text: text.textContent});
      }
      questions++; formulas += actual;
    }
    function inspect(cell) {
      const q = cell.querySelector('.math-exercise-question');
      inspectMath(q, q.dataset.mathExerciseSource || '', cell.dataset.label);
      if (cell.dataset.variants) {
        const generated = JSON.parse(cell.dataset.variants);
        const record = generated.variants.find(record => record.id === cell.dataset.variantId);
        const source = document.createElement('div');
        source.innerHTML = record.question;
        // Formula counts alone miss escaped Pandoc markup that appears as
        // literal <span> text while its embedded TeX still renders.
        for (const selector of ['p', 'strong', '[data-ai-feedback-tex]', '.math']) {
          if (q.querySelectorAll(selector).length !== source.querySelectorAll(selector).length) {
            failures.push({label: cell.dataset.label, variant: record.id, missingMarkup: selector});
          }
        }
        const solution = generated.solutionTarget ? document.getElementById(generated.solutionTarget)
          : cell.querySelector('.math-variant-solution-body');
        if (record.solution && !solution) failures.push({label: cell.dataset.label, missingSolution: record.id});
        if (record.solution && solution) inspectMath(solution, record.solution, `${cell.dataset.label} solution`);
      }
    }
    const random = Math.random;
    try {
      Math.random = () => 0; // Reload advances by one, covering every task once.
      for (const cell of document.querySelectorAll('.math-exercise-cell')) {
        const tasks = cell.dataset.pool ? JSON.parse(cell.dataset.pool) : [null];
        for (let i = 0; i < tasks.length; i++) {
          if (i) cell.querySelector('.math-pool-reload').click();
          inspect(cell);
        }
      }
      for (const math of document.querySelectorAll('main .math')) {
        if (!math.querySelector('.katex, mjx-container')) {
          failures.push({unrenderedPageMath: math.textContent});
        }
      }
    } finally { Math.random = random; }
    return {failures, questions, formulas};
  });
  test.info().annotations.push({type: 'rendering-audit', description: JSON.stringify(report)});
  expect(report.failures).toEqual([]);
  expect(await page.locator('.katex-error, mjx-merror, [data-mjx-error]').count()).toBe(0);
  if (name === 'custom-assessment') {
    const q = page.locator('[data-label="custom-pythagorean"] .math-exercise-question');
    await expect(q.locator('.katex, mjx-container')).toHaveCount(5);
    await expect(q.locator('input')).toHaveCount(3);
    await page.locator('[data-label="custom-pythagorean"] .math-exercise-caption').click();
    await q.screenshot({path: test.info().outputPath('pythagorean-fixed.png')});
  }
});
