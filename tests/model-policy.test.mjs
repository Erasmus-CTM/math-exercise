import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
  new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url),
  'utf8',
);

function response(status, content = 'What should you calculate first?') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    async text() { return 'mock provider error'; },
    async json() {
      return { choices: [{ finish_reason: 'stop', message: { content } }] };
    },
  };
}

function loadBundle(fetchImpl) {
  const requests = [];
  const storage = new Map();
  const context = {
    AbortController,
    console,
    document: { addEventListener() {} },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return fetchImpl(body, requests.length);
    },
    window: {
      __mathExerciseConfig: { lang: 'en' },
      __mathExerciseTestMode: true,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.window.__mathExerciseTestApi, requests };
}

function cfg(model) {
  return {
    baseUrl: 'https://strict-provider.invalid/v1',
    apiKey: 'test-only',
    model,
  };
}

async function feedback(api, model, visual = null) {
  return api.callLLM(
    'Calculate 2 + 2.',
    '<field>5</field>',
    '<field>incorrect</field>',
    [],
    1,
    cfg(model),
    visual,
  );
}

test('model classification filters embeddings and marks advisory categories', () => {
  const { api } = loadBundle(() => response(200));

  assert.equal(api.modelPolicy('intfloat/multilingual-e5-large-instruct').incompatible, true);
  assert.equal(api.modelPolicy('Qwen/Qwen3-Embedding-8B').incompatible, true);
  assert.equal(api.modelPolicy('moonshotai/Kimi-K2.6-instant').recommended, true);
  assert.equal(api.modelPolicy('NorwAI/NorwAI-Magistral-24B-reasoning').slow, true);
  assert.equal(api.modelPolicy('mistralai/Mistral-Medium-3.5-128B').recommended, true);
});

test('unknown providers receive only the portable baseline body', async () => {
  const { api, requests } = loadBundle(() => response(200));
  await feedback(api, 'provider/custom-chat-model');

  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['max_tokens', 'messages', 'model']);
});

test('provider errors outside compatibility negotiation are not retried', async () => {
  const { api, requests } = loadBundle(() => response(500));

  await assert.rejects(feedback(api, 'provider/custom-chat-model'), /API 500/);
  assert.equal(requests.length, 1);
});

test('known Kimi and GLM families receive documented thinking controls', async () => {
  const { api, requests } = loadBundle(() => response(200));
  await feedback(api, 'moonshotai/Kimi-K2.6');
  await feedback(api, 'nvidia/GLM-5.2-NVFP4');

  assert.equal(requests[0].body.thinking.type, 'disabled');
  assert.equal(requests[1].body.thinking.type, 'disabled');
});

test('gpt-oss receives low effort and no returned reasoning request', async () => {
  const { api, requests } = loadBundle(() => response(200));
  await feedback(api, 'openai/gpt-oss-120b');

  assert.equal(requests[0].body.include_reasoning, false);
  assert.match(requests[0].body.messages[0].content, /^Reasoning: low/);
});

test('strict provider rejects optional controls once, then uses cached baseline', async () => {
  const { api, requests } = loadBundle((body) => {
    return body.thinking ? response(422) : response(200);
  });

  await feedback(api, 'moonshotai/Kimi-K2.6');
  await feedback(api, 'moonshotai/Kimi-K2.6');

  assert.equal(requests.length, 3);
  assert.ok(requests[0].body.thinking);
  assert.equal(requests[1].body.thinking, undefined);
  assert.equal(requests[2].body.thinking, undefined);
  assert.equal(api.loadCapability(cfg('').baseUrl, 'moonshotai/Kimi-K2.6'), 'unsupported');
});

test('image fallback preserves accepted model tuning', async () => {
  const { api, requests } = loadBundle((body) => {
    return Array.isArray(body.messages[1].content) ? response(415) : response(200);
  });

  await feedback(api, 'moonshotai/Kimi-K2.6', {
    image: 'data:image/png;base64,AAAA',
  });

  assert.equal(requests.length, 2);
  assert.ok(Array.isArray(requests[0].body.messages[1].content));
  assert.equal(typeof requests[1].body.messages[1].content, 'string');
  assert.equal(requests[1].body.thinking.type, 'disabled');
  assert.equal(api.loadCapability(cfg('').baseUrl, 'moonshotai/Kimi-K2.6'), 'supported');
});
