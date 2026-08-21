'use strict';

const crypto = require('node:crypto');
const { writeAudit } = require('./audit');
const { beginTenantTransaction, uuidV7 } = require('./db');
const { ApiError } = require('./errors');

const TERMINAL_STATUSES = new Set([
  'CLASSIFIED',
  'EAR99',
  'INSUFFICIENT_INFORMATION',
  'CANDIDATE_SET_INADEQUATE',
  'NEEDS_HUMAN_REVIEW',
  'FAILED'
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
}

function productFingerprint(product) {
  return hash({
    name: String(product.name || '').trim(),
    description: String(product.description || '').trim(),
    specifications: product.specifications || null,
    origin_country: product.origin_country || null,
    us_content_pct: product.us_content_pct ?? null
  });
}

function normaliseExtraction(output) {
  if (!output || typeof output !== 'object') throw providerError('MODEL_OUTPUT_INVALID', 'Extraction response is not an object');
  const category = output.category === null || output.category === undefined ? null : Number(output.category);
  if (category !== null && (!Number.isInteger(category) || category < 0 || category > 9)) {
    throw providerError('MODEL_OUTPUT_INVALID', 'Extraction category is invalid');
  }
  const productGroup = output.product_group === null || output.product_group === undefined
    ? null
    : String(output.product_group).trim().toUpperCase();
  if (productGroup !== null && !['A', 'B', 'C', 'D', 'E'].includes(productGroup)) {
    throw providerError('MODEL_OUTPUT_INVALID', 'Extraction product group is invalid');
  }
  const rawParameters = Array.isArray(output.technical_parameters)
    ? output.technical_parameters
    : Object.entries(output.key_parameters || {}).map(([parameter, value]) => ({ parameter, value, unit: null }));
  const parameters = rawParameters
    .map((parameter) => ({
      parameter: String(parameter.parameter || '').trim().toLowerCase(),
      value: Number(parameter.value),
      unit: parameter.unit ? String(parameter.unit).trim().toUpperCase() : null
    }))
    .filter((parameter) => parameter.parameter && Number.isFinite(parameter.value));
  const missing = Array.isArray(output.missing_for_classification)
    ? output.missing_for_classification
    : (Array.isArray(output.insufficient_fields) ? output.insufficient_fields : []);
  return {
    category,
    productGroup,
    parameters,
    categoryConfidence: Number(output.category_confidence ?? output.confidence ?? 0),
    insufficientDetail: Boolean(output.insufficient_detail),
    missing: missing.map((item) => String(item).trim()).filter(Boolean),
    functionalDescription: String(output.functional_description || '').trim()
  };
}

function normaliseReasoning(output, candidates) {
  if (!output || typeof output !== 'object') throw providerError('MODEL_OUTPUT_INVALID', 'Reasoning response is not an object');
  const outcome = String(output.outcome || (output.eccn === 'EAR99' ? 'EAR99' : '')).toUpperCase();
  if (!['CLASSIFIED', 'EAR99', 'INSUFFICIENT_INFORMATION', 'CANDIDATE_SET_INADEQUATE'].includes(outcome)) {
    throw providerError('MODEL_OUTPUT_INVALID', 'Reasoning outcome is invalid');
  }
  const candidateCodes = new Set(candidates.map((candidate) => candidate.eccn));
  const eccn = output.eccn && String(output.eccn).toUpperCase() !== 'EAR99' ? String(output.eccn).toUpperCase() : null;
  if (outcome === 'CLASSIFIED' && (!eccn || !candidateCodes.has(eccn))) {
    throw providerError('MODEL_OUTPUT_INVALID', 'Reasoning selected a candidate that was not supplied');
  }
  if (outcome !== 'CLASSIFIED' && eccn) throw providerError('MODEL_OUTPUT_INVALID', 'Non-classified outcome included an ECCN');
  const confidence = Number(output.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw providerError('MODEL_OUTPUT_INVALID', 'Reasoning confidence is invalid');
  }
  const reasoning = String(output.reasoning || '').trim();
  if (!reasoning) throw providerError('MODEL_OUTPUT_INVALID', 'Reasoning explanation is required');
  const prohibited = /no licence is required|this transaction is compliant|you may proceed|the party is clean/i;
  if (prohibited.test(reasoning)) throw providerError('MODEL_OUTPUT_INVALID', 'Reasoning includes prohibited determination language');
  const rejected = Array.isArray(output.rejected_candidates) ? output.rejected_candidates : [];
  const missing = Array.isArray(output.missing_information) ? output.missing_information : [];
  const cited = output.cited_entry ? String(output.cited_entry) : (eccn ? candidates.find((candidate) => candidate.eccn === eccn)?.heading : null);
  return { outcome, eccn, confidence, reasoning, rejected, missing, cited };
}

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function invokeAnthropic(config, agent, input, modelClient) {
  if (modelClient) return modelClient({ agent, input });
  if (!config.anthropicApiKey) throw providerError('MODEL_PROVIDER_UNAVAILABLE', 'ANTHROPIC_API_KEY is not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), agent.timeout_seconds * 1000);
  try {
    const response = await fetch(config.anthropicBaseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: agent.model_id,
        max_tokens: agent.max_tokens,
        temperature: Number(agent.temperature),
        system: agent.system_prompt,
        messages: [{ role: 'user', content: JSON.stringify(input) }]
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const upstreamMessage = String(payload?.error?.message || '').replace(/\s+/g, ' ').trim();
      const detail = upstreamMessage ? `: ${upstreamMessage.slice(0, 500)}` : '';
      throw providerError('MODEL_PROVIDER_FAILED', `Model provider returned ${response.status}${detail}`);
    }
    const text = payload?.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw providerError('MODEL_OUTPUT_INVALID', 'Model provider did not return text output');
    try {
      return JSON.parse(text);
    } catch {
      throw providerError('MODEL_OUTPUT_INVALID', 'Model output was not valid JSON');
    }
  } catch (error) {
    if (error.name === 'AbortError') throw providerError('MODEL_TIMEOUT', 'Model call timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function activeControlListVersion(client) {
  const result = await client.query(
    `SELECT id, regime, version_label, effective_from, source, loaded_at
       FROM control_list_versions
      WHERE regime = 'EAR' AND status = 'ACTIVE' AND is_current = TRUE`
  );
  if (result.rowCount !== 1) throw providerError('STALE_REFERENCE_DATA', 'Exactly one active EAR control-list version is required');
  return result.rows[0];
}

async function publishedAgent(client, code) {
  const result = await client.query(
    `SELECT id, agent_code, version_label, model_id, system_prompt, max_tokens,
            temperature, timeout_seconds, max_retries
       FROM agent_versions
      WHERE agent_code = $1 AND status = 'PUBLISHED'
      ORDER BY published_at DESC, id DESC
      LIMIT 1`,
    [code]
  );
  if (!result.rows[0]) throw providerError('AGENT_CONFIGURATION_UNAVAILABLE', `No published ${code} agent version exists`);
  return result.rows[0];
}

async function effectiveThreshold(client, tenantId) {
  const result = await client.query(
    `SELECT COALESCE(tt.value, td.platform_default) AS value
       FROM threshold_definitions td
       LEFT JOIN tenant_thresholds tt ON tt.code = td.code AND tt.tenant_id = $1
      WHERE td.code = 'CLASSIFY_MIN_CONF'`,
    [tenantId]
  );
  if (!result.rows[0]) throw providerError('THRESHOLD_CONFIGURATION_UNAVAILABLE', 'CLASSIFY_MIN_CONF is not configured');
  return Number(result.rows[0].value);
}

async function stageTwoCandidates(client, { versionId, extraction, productDescription }) {
  const parameters = JSON.stringify(extraction.parameters);
  const result = await client.query(
    `WITH extracted AS (
       SELECT lower(parameter) AS parameter, value::numeric AS value, upper(unit) AS unit
         FROM jsonb_to_recordset($4::jsonb) AS x(parameter TEXT, value NUMERIC, unit TEXT)
     )
     SELECT e.eccn, e.heading, e.full_text, e.reasons_for_control,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'parameter_name', p.parameter_key,
                  'threshold_value', p.threshold_value,
                  'threshold_unit', p.unit,
                  'comparison_operator', p.operator
                )
              ) FILTER (WHERE p.id IS NOT NULL),
              '[]'::jsonb
            ) AS parameters
       FROM eccn_entries e
       LEFT JOIN eccn_parameters p
         ON p.version_id = e.version_id AND p.eccn = e.eccn
      WHERE e.version_id = $1
        AND e.is_current = TRUE
        AND ($2::smallint IS NULL OR e.category = $2)
        AND ($3::char(1) IS NULL OR e.product_group = $3)
        AND NOT EXISTS (
          SELECT 1
            FROM eccn_parameters candidate_parameter
            JOIN extracted input_parameter
              ON lower(candidate_parameter.parameter_key) = input_parameter.parameter
             AND (
               candidate_parameter.unit IS NULL
               OR input_parameter.unit IS NULL
               OR upper(candidate_parameter.unit) = input_parameter.unit
             )
           WHERE candidate_parameter.version_id = e.version_id
             AND candidate_parameter.eccn = e.eccn
             AND NOT (
               (candidate_parameter.operator = 'GT' AND input_parameter.value > candidate_parameter.threshold_value)
               OR (candidate_parameter.operator = 'GTE' AND input_parameter.value >= candidate_parameter.threshold_value)
               OR (candidate_parameter.operator = 'LT' AND input_parameter.value < candidate_parameter.threshold_value)
               OR (candidate_parameter.operator = 'LTE' AND input_parameter.value <= candidate_parameter.threshold_value)
               OR (candidate_parameter.operator = 'EQ' AND input_parameter.value = candidate_parameter.threshold_value)
               OR (candidate_parameter.operator = 'RANGE' AND input_parameter.value = candidate_parameter.threshold_value)
             )
        )
      GROUP BY e.version_id, e.eccn, e.heading, e.full_text, e.reasons_for_control
      ORDER BY
        CASE WHEN $2::smallint IS NULL THEN similarity(e.full_text, $5) ELSE 0 END DESC,
        e.eccn
      LIMIT 10`,
    [versionId, extraction.category, extraction.productGroup, parameters, productDescription]
  );
  return result.rows;
}

async function insertAgentRun(client, { tenantId, resultId, stage, agentVersionId, input, output, status, errorCode }) {
  await client.query(
    `INSERT INTO classification_agent_runs (
       id, tenant_id, classification_result_id, stage, agent_version_id,
       status, input_hash, output, error_code, completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [uuidV7(), tenantId, resultId, stage, agentVersionId, status, hash(input), JSON.stringify(output || {}), errorCode || null]
  );
}

async function createPendingResult(client, { job, activeVersion, extractionAgent }) {
  const resultId = uuidV7();
  await client.query(
    `INSERT INTO classification_results (
       id, tenant_id, product_id, case_id, agent_version_id, control_list_version_id,
       eccn, is_ear99, confidence, reasoning, candidates_considered, rejection_reasons,
       status, requires_human_review, cited_entry, cached
     ) VALUES ($1, $2, $3, $4, $5, $6, NULL, FALSE, 0, $7, ARRAY[]::text[], '[]'::jsonb,
               'PENDING', FALSE, NULL, FALSE)`,
    [
      resultId, job.tenant_id, job.product_id, job.case_id, extractionAgent.id, activeVersion.id,
      'Classification is pending structured attribute extraction.'
    ]
  );
  await client.query(
    `UPDATE classification_jobs SET classification_result_id = $2, control_list_version_id = $3
      WHERE id = $1`,
    [job.id, resultId, activeVersion.id]
  );
  return resultId;
}

async function completeResult(client, {
  resultId, agentVersionId, status, eccn, isEar99, confidence, reasoning,
  candidates, rejected, requiresHumanReview, citedEntry, requiresRevalidation = false
}) {
  await client.query(
    `UPDATE classification_results
        SET agent_version_id = $2,
            status = $3,
            eccn = $4,
            is_ear99 = $5,
            confidence = $6,
            reasoning = $7,
            candidates_considered = $8,
            rejection_reasons = $9,
            requires_human_review = $10,
            cited_entry = $11,
            requires_revalidation = $12,
            completed_at = now()
      WHERE id = $1`,
    [
      resultId, agentVersionId, status, eccn || null, isEar99, confidence, reasoning,
      candidates.map((candidate) => candidate.eccn), JSON.stringify(rejected || []),
      requiresHumanReview, citedEntry || null, requiresRevalidation
    ]
  );
}

async function claimJob(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH next_job AS (
         SELECT id
           FROM classification_jobs
          WHERE status = 'QUEUED' AND available_at <= now()
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE classification_jobs job
          SET status = 'PROCESSING', claimed_at = now(), attempts = attempts + 1
         FROM next_job
        WHERE job.id = next_job.id
      RETURNING job.*`
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markJobFailure(pool, job, error) {
  const client = await pool.connect();
  try {
    await beginTenantTransaction(client, job.tenant_id);
    await client.query(
      `UPDATE classification_jobs
          SET status = 'FAILED', completed_at = now(), error_code = $2, error_detail = $3
        WHERE id = $1`,
      [job.id, error.code || 'CLASSIFICATION_FAILED', String(error.message || 'Classification failed').slice(0, 2000)]
    );
    if (job.classification_result_id) {
      await completeResult(client, {
        resultId: job.classification_result_id,
        agentVersionId: (await publishedAgent(client, 'CLASSIFIER_EXTRACTION')).id,
        status: 'FAILED',
        eccn: null,
        isEar99: false,
        confidence: 0,
        reasoning: 'Classification could not complete and requires compliance officer review.',
        candidates: [],
        rejected: [],
        requiresHumanReview: true,
        citedEntry: null
      });
    }
    await writeAudit(client, {
      tenantId: job.tenant_id,
      caseId: job.case_id,
      eventType: 'CLASSIFICATION_FAILED',
      actorType: 'AGENT',
      afterState: { job_id: job.id, error_code: error.code || 'CLASSIFICATION_FAILED' }
    });
    await client.query('COMMIT');
  } catch (failureError) {
    await client.query('ROLLBACK');
    throw failureError;
  } finally {
    client.release();
  }
}

function createClassificationService({ pool, config, modelClient }) {
  async function enqueue(client, { tenantId, caseId, requestedBy, productId = null }) {
    const activeVersion = await activeControlListVersion(client);
    const products = await client.query(
      `SELECT cp.id AS case_product_id, cp.product_id, p.name, p.description, p.specifications,
              p.origin_country, p.us_content_pct, p.product_fingerprint
         FROM case_products cp
         JOIN products p ON p.id = cp.product_id AND p.tenant_id = cp.tenant_id
        WHERE cp.tenant_id = $1 AND cp.case_id = $2
          AND ($3::uuid IS NULL OR cp.product_id = $3)
        ORDER BY cp.created_at`,
      [tenantId, caseId, productId]
    );
    if (!products.rowCount) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['products'] });

    const outcomes = [];
    for (const product of products.rows) {
      const cached = await client.query(
        `SELECT *
           FROM classification_results
          WHERE tenant_id = $1 AND product_id = $2 AND control_list_version_id = $3
            AND status IN ('CLASSIFIED', 'EAR99') AND requires_revalidation = FALSE
          ORDER BY created_at DESC
          LIMIT 1`,
        [tenantId, product.product_id, activeVersion.id]
      );
      if (cached.rows[0]) {
        const source = cached.rows[0];
        const resultId = uuidV7();
        await client.query(
          `INSERT INTO classification_results (
             id, tenant_id, product_id, case_id, agent_version_id, control_list_version_id,
             eccn, is_ear99, confidence, reasoning, candidates_considered, rejection_reasons,
             requires_revalidation, confirmed_by, created_at, status, requires_human_review,
             cited_entry, cached, completed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE, NULL, now(),
                     $13, $14, $15, TRUE, now())`,
          [
            resultId, tenantId, product.product_id, caseId, source.agent_version_id, source.control_list_version_id,
            source.eccn, source.is_ear99, source.confidence, source.reasoning,
            source.candidates_considered, JSON.stringify(source.rejection_reasons), source.status,
            source.requires_human_review, source.cited_entry
          ]
        );
        outcomes.push({ product_id: product.product_id, classification_result_id: resultId, cached: true, status: source.status });
        continue;
      }

      const fingerprint = hash({
        product: product.product_fingerprint || productFingerprint(product),
        control_list_version_id: activeVersion.id
      });
      const inserted = await client.query(
        `INSERT INTO classification_jobs (
           id, tenant_id, case_id, case_product_id, product_id, request_fingerprint,
           requested_by, control_list_version_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING
         RETURNING id, status`,
        [uuidV7(), tenantId, caseId, product.case_product_id, product.product_id, fingerprint, requestedBy, activeVersion.id]
      );
      if (inserted.rows[0]) {
        outcomes.push({ product_id: product.product_id, job_id: inserted.rows[0].id, cached: false, status: inserted.rows[0].status });
      } else {
        const existing = await client.query(
          `SELECT id, status
             FROM classification_jobs
            WHERE tenant_id = $1 AND case_product_id = $2 AND request_fingerprint = $3
              AND status IN ('QUEUED', 'PROCESSING')
            ORDER BY created_at DESC
            LIMIT 1`,
          [tenantId, product.case_product_id, fingerprint]
        );
        outcomes.push({ product_id: product.product_id, job_id: existing.rows[0]?.id, cached: false, status: existing.rows[0]?.status || 'QUEUED' });
      }
    }
    return { controlListVersion: activeVersion, outcomes };
  }

  async function processNext() {
    const job = await claimJob(pool);
    if (!job) return null;
    const client = await pool.connect();
    try {
      await beginTenantTransaction(client, job.tenant_id);
      const productResult = await client.query(
        `SELECT p.*
           FROM products p
          WHERE p.id = $1 AND p.tenant_id = $2`,
        [job.product_id, job.tenant_id]
      );
      const product = productResult.rows[0];
      if (!product) throw providerError('PRODUCT_NOT_FOUND', 'Queued product no longer exists');
      const activeVersion = await activeControlListVersion(client);
      const extractionAgent = await publishedAgent(client, 'CLASSIFIER_EXTRACTION');
      const resultId = job.classification_result_id
        || await createPendingResult(client, { job, activeVersion, extractionAgent });
      job.classification_result_id = resultId;

      const extractionInput = {
        product_name: product.name,
        technical_description: product.description,
        specifications: product.specifications || {},
        country_of_origin: product.origin_country || null
      };
      let activeStage = 'EXTRACTION';
      let activeAgent = extractionAgent;
      let activeInput = extractionInput;
      let extractionRaw;
      try {
        extractionRaw = await invokeAnthropic(config, extractionAgent, extractionInput, modelClient);
        const extraction = normaliseExtraction(extractionRaw);
        await insertAgentRun(client, {
          tenantId: job.tenant_id, resultId, stage: 'EXTRACTION', agentVersionId: extractionAgent.id,
          input: extractionInput, output: extractionRaw, status: 'COMPLETED'
        });
        if (extraction.missing.length) {
          await completeResult(client, {
            resultId, agentVersionId: extractionAgent.id, status: 'INSUFFICIENT_INFORMATION',
            eccn: null, isEar99: false, confidence: 0,
            reasoning: `Classification requires additional product information: ${extraction.missing.join(', ')}.`,
            candidates: [], rejected: [], requiresHumanReview: true, citedEntry: null
          });
          await client.query(`UPDATE classification_jobs SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [job.id]);
          await writeAudit(client, {
            tenantId: job.tenant_id, caseId: job.case_id, eventType: 'CLASSIFICATION_REQUIRES_INFORMATION',
            actorType: 'AGENT', agentVersionId: extractionAgent.id,
            afterState: { classification_result_id: resultId, missing_information: extraction.missing }
          });
          await client.query('COMMIT');
          return { jobId: job.id, resultId, status: 'INSUFFICIENT_INFORMATION' };
        }

        const candidates = await stageTwoCandidates(client, {
          versionId: activeVersion.id, extraction, productDescription: `${product.name} ${product.description}`
        });
        if (!candidates.length) {
          await completeResult(client, {
            resultId, agentVersionId: extractionAgent.id, status: 'CANDIDATE_SET_INADEQUATE',
            eccn: null, isEar99: false, confidence: 0,
            reasoning: 'No adequately supported control-list candidates survived deterministic filtering; compliance officer review is required.',
            candidates: [], rejected: [], requiresHumanReview: true, citedEntry: null
          });
          await client.query(`UPDATE classification_jobs SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [job.id]);
          await writeAudit(client, {
            tenantId: job.tenant_id, caseId: job.case_id, eventType: 'CLASSIFICATION_CANDIDATE_SET_INADEQUATE',
            actorType: 'AGENT', agentVersionId: extractionAgent.id,
            afterState: { classification_result_id: resultId, stage_3_called: false }
          });
          await client.query('COMMIT');
          return { jobId: job.id, resultId, status: 'CANDIDATE_SET_INADEQUATE' };
        }

        const reasoningAgent = await publishedAgent(client, 'CLASSIFIER_REASONING');
        const reasoningInput = {
          product: extractionInput,
          extracted_attributes: extraction,
          candidates: candidates.map((candidate) => ({
            eccn: candidate.eccn,
            heading: candidate.heading,
            full_text: candidate.full_text,
            reasons_for_control: candidate.reasons_for_control,
            parameters: candidate.parameters
          }))
        };
        activeStage = 'REASONING';
        activeAgent = reasoningAgent;
        activeInput = reasoningInput;
        const reasoningRaw = await invokeAnthropic(config, reasoningAgent, reasoningInput, modelClient);
        const reasoning = normaliseReasoning(reasoningRaw, candidates);
        await insertAgentRun(client, {
          tenantId: job.tenant_id, resultId, stage: 'REASONING', agentVersionId: reasoningAgent.id,
          input: reasoningInput, output: reasoningRaw, status: 'COMPLETED'
        });
        const threshold = await effectiveThreshold(client, job.tenant_id);
        const terminalStatus = reasoning.outcome;
        const requiresReview = reasoning.outcome !== 'CLASSIFIED' && reasoning.outcome !== 'EAR99'
          || reasoning.confidence < threshold;
        const currentVersion = await activeControlListVersion(client);
        await completeResult(client, {
          resultId,
          agentVersionId: reasoningAgent.id,
          status: terminalStatus,
          eccn: reasoning.eccn,
          isEar99: terminalStatus === 'EAR99',
          confidence: reasoning.confidence,
          reasoning: reasoning.reasoning,
          candidates,
          rejected: reasoning.rejected,
          requiresHumanReview: requiresReview,
          citedEntry: reasoning.cited,
          requiresRevalidation: currentVersion.id !== activeVersion.id
        });
        await client.query(`UPDATE classification_jobs SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [job.id]);
        await writeAudit(client, {
          tenantId: job.tenant_id, caseId: job.case_id, eventType: 'CLASSIFICATION_COMPLETED',
          actorType: 'AGENT', agentVersionId: reasoningAgent.id,
          afterState: {
            classification_result_id: resultId,
            status: terminalStatus,
            eccn: reasoning.eccn,
            confidence: reasoning.confidence,
            requires_human_review: requiresReview,
            control_list_version_id: activeVersion.id
          }
        });
        await client.query('COMMIT');
        return { jobId: job.id, resultId, status: terminalStatus };
      } catch (error) {
        if (resultId) {
          await insertAgentRun(client, {
            tenantId: job.tenant_id, resultId, stage: activeStage, agentVersionId: activeAgent.id,
            input: activeInput, output: {}, status: 'FAILED', errorCode: error.code || 'CLASSIFICATION_FAILED'
          }).catch(() => {});
        }
        throw error;
      }
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      await markJobFailure(pool, job, error);
      return { jobId: job.id, resultId: job.classification_result_id || null, status: 'FAILED', errorCode: error.code || 'CLASSIFICATION_FAILED' };
    } finally {
      client.release();
    }
  }

  async function getCaseResults(client, { tenantId, caseId }) {
    const result = await client.query(
      `SELECT cp.product_id, p.name AS product_name, cr.id, cr.eccn, cr.is_ear99,
              cr.confidence, cr.reasoning, cr.cited_entry, cr.status,
              cr.requires_revalidation, cr.requires_human_review, cr.cached,
              cr.agent_version_id, av.agent_code, av.version_label,
              cr.control_list_version_id, clv.version_label AS control_list_version,
              job.id AS job_id, job.status AS job_status, job.error_code
         FROM case_products cp
         JOIN products p ON p.id = cp.product_id AND p.tenant_id = cp.tenant_id
         LEFT JOIN LATERAL (
           SELECT *
             FROM classification_results
            WHERE tenant_id = cp.tenant_id AND case_id = cp.case_id AND product_id = cp.product_id
            ORDER BY created_at DESC
            LIMIT 1
         ) cr ON TRUE
         LEFT JOIN agent_versions av ON av.id = cr.agent_version_id
         LEFT JOIN control_list_versions clv ON clv.id = cr.control_list_version_id
         LEFT JOIN LATERAL (
           SELECT *
             FROM classification_jobs
            WHERE tenant_id = cp.tenant_id AND case_id = cp.case_id AND product_id = cp.product_id
            ORDER BY created_at DESC
            LIMIT 1
         ) job ON TRUE
        WHERE cp.tenant_id = $1 AND cp.case_id = $2
        ORDER BY cp.created_at`,
      [tenantId, caseId]
    );
    return result.rows;
  }

  return { enqueue, getCaseResults, processNext };
}

function createClassificationWorker(service, config) {
  let timer = null;
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await service.processNext();
    } finally {
      busy = false;
    }
  }
  return {
    start() {
      if (timer || !config.classificationWorkerEnabled) return;
      timer = setInterval(() => tick().catch((error) => process.stderr.write(`Classification worker error: ${error.message}\n`)), config.classificationWorkerPollMs);
      tick().catch((error) => process.stderr.write(`Classification worker error: ${error.message}\n`));
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = {
  TERMINAL_STATUSES,
  createClassificationService,
  createClassificationWorker,
  normaliseExtraction,
  normaliseReasoning,
  productFingerprint,
  stageTwoCandidates
};