'use strict';

const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';
// DOCUMENT agent uses a high-context model; configurable via env
const GROQ_DOCUMENT_MODEL = process.env.GROQ_DOCUMENT_MODEL || 'openai/gpt-oss-120b';

// ── helpers ──────────────────────────────────────────────────────────────────

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isArabicContent(detectedLanguage, userPrompt) {
  if (detectedLanguage && String(detectedLanguage).toLowerCase().includes('ar')) return true;
  // Quick heuristic: Arabic Unicode block (U+0600–U+06FF)
  if (userPrompt && /[؀-ۿ]/.test(String(userPrompt).slice(0, 500))) return true;
  return false;
}

function isGroqQuotaError(error) {
  if (error.status === 429 || error.status === 413) return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('quota') || msg.includes('rate_limit') || msg.includes('rate limit')
    || msg.includes('tokens per minute') || msg.includes('tpm') || msg.includes('too large');
}

function isGroqModelUnavailable(error) {
  return error.status === 404;
}

function isGeminiQuotaError(error) {
  const msg = String(error.message || '').toLowerCase();
  return error.status === 429 || msg.includes('quota') || msg.includes('resource_exhausted');
}

function isGeminiUnavailable(error) {
  const msg = String(error.message || '').toLowerCase();
  // 503 = overloaded, not configured = skip immediately
  return error.status === 503 || msg.includes('service unavailable') || msg.includes('high demand')
    || msg.includes('not found') || msg.includes('no longer available');
}

// ── provider implementations ─────────────────────────────────────────────────

async function callAnthropic({ apiKey, baseUrl, model, systemPrompt, userPrompt, maxTokens, timeoutSeconds }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (timeoutSeconds || 60) * 1000);
  try {
    const response = await fetch(baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = String(payload?.error?.message || '').replace(/\s+/g, ' ').trim();
      const err = providerError('MODEL_PROVIDER_FAILED', `Model provider returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
      err.status = response.status;
      throw err;
    }
    const text = payload?.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw providerError('MODEL_OUTPUT_INVALID', 'Model provider did not return text output');
    return { text, provider: 'Anthropic', model };
  } catch (error) {
    if (error.name === 'AbortError') throw providerError('MODEL_TIMEOUT', 'Model call timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGroq({ apiKey, model, systemPrompt, userPrompt, maxTokens, skipReasoning = false }) {
  if (!apiKey) throw providerError('MODEL_PROVIDER_UNAVAILABLE', 'GROQ_API_KEY is not configured');
  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  try {
    // gpt-oss-120b: context window = 8000 total (input+output); DOCUMENT input ~2171 → max output = 5829; use 5500
    // gpt-oss-20b: caps at 2048 output
    const gptOssCap = model.includes('120b') ? 5500 : 2048;
    const effectiveMax = model.includes('gpt-oss') ? Math.min(maxTokens, gptOssCap)
      : model.includes('qwen') ? Math.min(maxTokens, 900)
      : maxTokens;
    const request = {
      model,
      max_tokens: effectiveMax,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };
    // Skip reasoning_effort for DOCUMENT agents (need clean JSON) and for non-gpt-oss models
    if (model.includes('gpt-oss') && !skipReasoning) request.reasoning_effort = 'low';
    const completion = await client.chat.completions.create(request);
    const message = completion.choices?.[0]?.message || {};
    // Use || not ?? so that empty string "" falls back to reasoning_content (reasoning models)
    const content = message.content || message.reasoning_content || message.reasoning;
    const text = Array.isArray(content)
      ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
      : content;
    if (!text) {
      console.warn(`Groq empty output — content: ${JSON.stringify(message.content)?.slice(0,50)}, reasoning_content len: ${String(message.reasoning_content||'').length}, finish_reason: ${completion.choices?.[0]?.finish_reason}`);
      throw providerError('MODEL_OUTPUT_INVALID', 'Groq did not return text output');
    }
    return { text, provider: 'Groq', model };
  } catch (error) {
    if (error.code && String(error.code).startsWith('MODEL_')) throw error;
    const wrapped = providerError('MODEL_PROVIDER_FAILED', error.message || 'Groq request failed');
    wrapped.status = error.status;
    throw wrapped;
  }
}

async function callGemini({ apiKey, systemPrompt, userPrompt, maxTokens, timeoutMs = 30000 }) {
  if (!apiKey) throw providerError('MODEL_PROVIDER_UNAVAILABLE', 'GEMINI_API_KEY is not configured');
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.1
      }
    });
    // Race against a timeout so a slow/503 Gemini doesn't block the fallback chain
    const result = await Promise.race([
      model.generateContent(userPrompt),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Gemini request timed out'), { status: 503 })), timeoutMs))
    ]);
    const text = result.response.text();
    if (!text) throw providerError('MODEL_OUTPUT_INVALID', 'Gemini did not return text output');
    return { text, provider: 'Gemini', model: geminiModel };
  } catch (error) {
    if (error.code && String(error.code).startsWith('MODEL_')) throw error;
    const wrapped = providerError('MODEL_PROVIDER_FAILED', error.message || 'Gemini request failed');
    wrapped.status = error.status;
    throw wrapped;
  }
}

// ── Groq with model fallback ──────────────────────────────────────────────────

async function callGroqWithFallback({ apiKey, systemPrompt, userPrompt, maxTokens, agentType }) {
  // DOCUMENT agent gets a dedicated high-context model without reasoning mode (needs clean JSON)
  const primaryModel = agentType === 'DOCUMENT' ? GROQ_DOCUMENT_MODEL : GROQ_MODEL;
  const skipReasoning = agentType === 'DOCUMENT';
  try {
    console.log(`Provider: Groq | Model: ${primaryModel} | Agent: ${agentType || 'unknown'}`);
    return await callGroq({ apiKey, model: primaryModel, systemPrompt, userPrompt, maxTokens, skipReasoning });
  } catch (error) {
    const needsFallback = isGroqModelUnavailable(error) || isGroqQuotaError(error);
    if (needsFallback) {
      // For DOCUMENT: fall back to gpt-oss-20b (smaller, different TPM pool); for others: use configured fallback
      const fallback = agentType === 'DOCUMENT' ? GROQ_FALLBACK_MODEL : GROQ_FALLBACK_MODEL;
      if (fallback === primaryModel) throw error; // no different model to try
      const reason = isGroqQuotaError(error) ? 'quota/TPM limit' : 'model unavailable';
      console.warn(`Falling back from Groq(${primaryModel}) to Groq(${fallback}): ${reason}`);
      console.log(`Provider: Groq | Model: ${fallback} | Agent: ${agentType || 'unknown'}`);
      return callGroq({ apiKey, model: fallback, systemPrompt, userPrompt, maxTokens, skipReasoning });
    }
    throw error;
  }
}

// ── main entry point ──────────────────────────────────────────────────────────

async function callAIAgent({
  systemPrompt,
  userPrompt,
  maxTokens = 1000,
  model = 'claude-haiku-4-5-20251001',
  timeoutSeconds = 60,
  agent_type = null,
  detected_language = null,
  config = {}
}) {
  const anthropicApiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  const groqApiKey      = config.groqApiKey      || process.env.GROQ_API_KEY;
  const geminiApiKey    = config.geminiApiKey    || process.env.GEMINI_API_KEY;
  const isProduction    = (process.env.NODE_ENV || config.nodeEnv) === 'production';
  const arabic          = isArabicContent(detected_language, userPrompt);
  const isDocAgent      = agent_type === 'DOCUMENT';
  const preferGemini    = (isDocAgent || arabic) && Boolean(geminiApiKey);

  if (arabic) {
    console.log(`Arabic content detected — using Gemini-first routing | Agent: ${agent_type || 'unknown'}`);
  }

  // ── Development routing: Gemini → Groq → Anthropic (all agents) ─────────
  if (!isProduction) {
    // Gemini first for all dev agents — free tier, no daily quota exhaustion
    if (geminiApiKey) {
      console.log(`Provider: Gemini | Model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash'} | Agent: ${agent_type || 'unknown'}`);
      try {
        return await callGemini({ apiKey: geminiApiKey, systemPrompt, userPrompt, maxTokens, timeoutMs: 25000 });
      } catch (geminiError) {
        const skipMsg = isGeminiUnavailable(geminiError) ? 'unavailable/overloaded' : geminiError.message;
        console.warn(`Falling back from Gemini to Groq: ${skipMsg}`);
      }
    }
    // Groq second
    try {
      return await callGroqWithFallback({ apiKey: groqApiKey, systemPrompt, userPrompt, maxTokens, agentType: agent_type });
    } catch (groqError) {
      if (!anthropicApiKey) throw groqError;
      console.warn(`Falling back from Groq to Anthropic: ${groqError.message}`);
      console.log(`Provider: Anthropic | Model: ${model} | Agent: ${agent_type || 'unknown'}`);
      return callAnthropic({ apiKey: anthropicApiKey, model, systemPrompt, userPrompt, maxTokens, timeoutSeconds });
    }
  }

  // ── Production routing: Anthropic → Gemini → Groq ────────────────────────
  console.log(`Provider: Anthropic | Model: ${model} | Agent: ${agent_type || 'unknown'}`);
  try {
    return await callAnthropic({ apiKey: anthropicApiKey, model, systemPrompt, userPrompt, maxTokens, timeoutSeconds });
  } catch (anthropicError) {
    if (!geminiApiKey) throw anthropicError;
    console.warn(`Falling back from Anthropic to Gemini: ${anthropicError.message}`);
    console.log(`Provider: Gemini | Model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash'} | Agent: ${agent_type || 'unknown'}`);
    try {
      return await callGemini({ apiKey: geminiApiKey, systemPrompt, userPrompt, maxTokens });
    } catch (geminiError) {
      if (!groqApiKey) throw geminiError;
      console.warn(`Falling back from Gemini to Groq: ${geminiError.message}`);
      return callGroqWithFallback({ apiKey: groqApiKey, systemPrompt, userPrompt, maxTokens, agentType: agent_type });
    }
  }
}

module.exports = { callAIAgent };
