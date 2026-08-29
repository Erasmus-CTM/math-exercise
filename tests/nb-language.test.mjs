import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
  new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url),
  'utf8',
);

function loadBundle(lang, replies = []) {
  const requests = [];
  let replyIndex = 0;
  const context = {
    console,
    document: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const content = replies[Math.min(replyIndex++, replies.length - 1)];
      return {
        ok: true,
        async json() {
          return { choices: [{ finish_reason: 'stop', message: { content } }] };
        },
      };
    },
    window: {
      __mathExerciseConfig: { lang },
      __mathExerciseTestMode: true,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.window.__mathExerciseTestApi, requests };
}

const cfg = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-only',
  model: 'test-model',
};

test('nb prompt names Norwegian Bokmål and keeps the language guard last', () => {
  const { api } = loadBundle('nb');
  const system = api.sysPrompt(1, false);
  const user = api.buildUserPrompt('Regn ut 2 + 2.', '<field>5</field>', '<field>incorrect</field>', []);

  assert.equal(api.locale.outputLanguageCode, 'nb');
  assert.match(user, /^<output_language code="nb">Norwegian Bokmål<\/output_language>/);
  assert.ok(system.endsWith(api.locale.promptLanguageGuard));
  assert.match(system, /utelukkende|alle synlige ord|norsk bokmål/i);
});

test('an obviously non-Latin response is retried once in Norwegian', async () => {
  const { api, requests } = loadBundle('nb', [
    'Попробуйте сначала определить нужную формулу.',
    'Hva er det første uttrykket du bør undersøke?',
  ]);

  const result = await api.callLLM('Oppgave', '<field>Svar</field>', '<field>incorrect</field>', [], 1, cfg, null);

  assert.equal(result, 'Hva er det første uttrykket du bør undersøke?');
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[0].content, /SPRÅKKRAV VED NYTT FORSØK/);
  assert.ok(requests[1].messages[0].content.endsWith(api.locale.promptLanguageRetry));
});

test('two responses in an unexpected script produce a localized error', async () => {
  const { api, requests } = loadBundle('nb', [
    'Сначала найдите подходящую формулу.',
    'Затем подставьте известные значения.',
  ]);

  await assert.rejects(
    api.callLLM('Oppgave', '<field>Svar</field>', '<field>incorrect</field>', [], 1, cfg, null),
    /feil språk to ganger/i,
  );
  assert.equal(requests.length, 2);
});

test('a response in the requested Latin-script language is not retried', async () => {
  const { api, requests } = loadBundle('en', ['Which definition applies here?']);
  const result = await api.callLLM('Task', '<field>Answer</field>', '<field>incorrect</field>', [], 1, cfg, null);

  assert.equal(result, 'Which definition applies here?');
  assert.equal(requests.length, 1);
});
