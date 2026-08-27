'use strict';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function invokeGroq(config, agent, input) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw providerError('MODEL_PROVIDER_UNAVAILABLE', 'GROQ_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), agent.timeout_seconds * 1000);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: agent.max_tokens,
        temperature: Number(agent.temperature),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: agent.system_prompt },
          { role: 'user', content: JSON.stringify(input) }
        ]
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const upstreamMessage = String(payload?.error?.message || '').replace(/\s+/g, ' ').trim();
      const detail = upstreamMessage ? `: ${upstreamMessage.slice(0, 500)}` : '';
      throw providerError('MODEL_PROVIDER_FAILED', `Groq provider returned ${response.status}${detail}`);
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw providerError('MODEL_OUTPUT_INVALID', 'Groq provider did not return text output');
    try {
      return JSON.parse(text);
    } catch {
      throw providerError('MODEL_OUTPUT_INVALID', 'Groq model output was not valid JSON');
    }
  } catch (error) {
    if (error.name === 'AbortError') throw providerError('MODEL_TIMEOUT', 'Groq model call timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { invokeGroq };