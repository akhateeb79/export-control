'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invokeGroq } = require('../../src/agents/providers/groq-provider');

test('Groq provider uses the sandbox model and returns classification JSON', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousFetch = global.fetch;
  process.env.GROQ_API_KEY = 'unit-test-key';
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"outcome":"EAR99","confidence":95,"reasoning":"Test response."}' } }]
      })
    };
  };

  try {
    const result = await invokeGroq(
      {},
      { system_prompt: 'Return JSON.', max_tokens: 128, temperature: 0, timeout_seconds: 1 },
      { product_name: 'Test product' }
    );
    assert.deepEqual(result, { outcome: 'EAR99', confidence: 95, reasoning: 'Test response.' });
    assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.authorization, 'Bearer unit-test-key');
    const body = JSON.parse(request.init.body);
    assert.equal(body.model, 'llama-3.1-8b-instant');
    assert.deepEqual(body.response_format, { type: 'json_object' });
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});