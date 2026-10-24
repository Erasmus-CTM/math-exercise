import {readFileSync} from 'node:fs';
import path from 'node:path';
import {test, expect} from 'playwright/test';
import {ctmLibs} from '../helpers/ctm-libs.mjs';

// A transport fixture, not a complete offline bundle. Use the installed npm
// test KaTeX files to exercise real module/CSS/font requests and AMD coexistence.
// The ordinary example-site browser audit separately uses the exact CDN build.
const assetTable = JSON.parse(readFileSync(path.join(ctmLibs, 'assets.json'), 'utf8'));
const assetSource = readFileSync(path.join(ctmLibs, 'assets.js'), 'utf8');
const runtimeSource = readFileSync(path.join(ctmLibs, 'runtime/pyodide-runtime.js'), 'utf8');
const localeSource = ['ctm-locale.js', 'common.js', 'math-exercise.js']
  .map(file => readFileSync(path.join(ctmLibs, 'locales', file), 'utf8')).join('\n');
const source = readFileSync(new URL('../../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');
const fixture = new URL('../../node_modules/katex/', import.meta.url);
const fixtureVersion = JSON.parse(readFileSync(new URL('package.json', fixture), 'utf8')).version;
const entry = assetTable.assets.katex;
const escape = code => code.replace(/<\/script/gi, '<\\/script');
const media = name => name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.css') ? 'text/css'
  : name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf';

for (const mode of ['cdn', 'local']) test(mode + ': nested-page KaTeX uses canonical own modules alongside AMD', async ({browser}, info) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], unexpected = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const pageURL = 'http://127.0.0.1:4173/nested/asset-control.html';
  const base = mode === 'local' ? '../_ctm-assets/' + entry.local.replace('{version}', entry.version)
    : entry.cdn.replace('{version}', entry.version);
  const absolute = new URL(base, pageURL).href;
  const html = '<!doctype html><link rel="icon" href="data:,"><div class="math-exercise-text"><div class="math-exercise-question">\\(a^2+b^2\\)</div></div>'
    + '<script>window.define=function(){throw Error("AMD intercepted KaTeX")};window.define.amd={};'
    + 'globalThis.CTM_ASSETS=' + JSON.stringify({v: 1, mode, bases: {katex: base}}) + ';</script>'
    + '<script>' + escape(assetSource) + '</script><script>' + escape(runtimeSource) + '</script><script>' + escape(localeSource) + '</script>'
    + '<script>' + escape(source) + '</script>';
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url === pageURL) return route.fulfill({status: 200, contentType: 'text/html', body: html});
    if (url.startsWith(absolute)) {
      const relative = url.slice(absolute.length);
      requests.push(relative);
      if (!/^dist\/(?:katex\.mjs|katex\.min\.css|contrib\/auto-render\.mjs|fonts\/[A-Za-z0-9_.-]+\.(?:woff2?|ttf))$/.test(relative)) {
        unexpected.push(url); return route.abort();
      }
      return route.fulfill({status: 200, contentType: media(relative),
        headers: {'access-control-allow-origin': '*'}, body: readFileSync(new URL(relative, fixture))});
    }
    unexpected.push(url); return route.abort();
  });
  try {
    await page.goto(pageURL);
    await page.evaluate(() => MathExerciseRuntime.whenInitialUIReady());
    await expect(page.locator('.math-exercise-question .katex')).toHaveCount(1);
    await page.evaluate(async () => { await document.fonts.ready; });
    expect(await page.evaluate(() => CTMAssets.url('katex', 'dist/katex.mjs'))).toBe(absolute + 'dist/katex.mjs');
    expect(requests).toEqual(expect.arrayContaining(['dist/katex.mjs', 'dist/contrib/auto-render.mjs', 'dist/katex.min.css']));
    expect(requests.some(file => file.startsWith('dist/fonts/'))).toBe(true);
    expect(requests.some(file => file.includes('+esm'))).toBe(false);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    info.annotations.push({type: 'asset-transport-control', description: JSON.stringify({mode,
      canonicalVersion: entry.version, fixtureVersion, requests})});
  } finally {
    await context.close();
  }
});
