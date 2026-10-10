'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const express = require('express');
const multer = require('multer');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { createWorker } = require('tesseract.js');
const { extractDocumentFields } = require('./services/documentExtraction');
const { screenAgainstUaeList } = require('../src/services/uaeControlListService');

const { writeAudit } = require('./audit');
const { ApiError, asyncHandler } = require('./errors');
const execFileAsync = promisify(execFile);

const DOCUMENT_ROLES = ['INITIATOR', 'REVIEWER', 'COMPLIANCE_OFFICER', 'COMPLIANCE_ADMIN', 'CLIENT_ADMIN', 'API_CLIENT', 'SUPER_ADMIN'];
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 }
});

const EXTRACTION_FIELDS = new Set([
  'exporter_name',
  'exporter_country',
  'consignee_name',
  'consignee_country',
  'end_user_name',
  'end_user_country',
  'product_description',
  'part_number',
  'quantity',
  'declared_end_use',
  'destination_country',
  'unit_value',
  'total_value',
  'currency',
  'incoterms',
  'ship_date',
  'invoice_number',
  'country_of_origin'
]);

const PARTY_FIELDS = new Map([
  ['exporter_name', 'EXPORTER'],
  ['consignee_name', 'CONSIGNEE'],
  ['end_user_name', 'END_USER']
]);

const CASE_FIELD_COLUMNS = new Map([
  ['product_description', 'product_description'],
  ['destination_country', 'destination_country'],
  ['declared_end_use', 'declared_end_use'],
  ['part_number', 'product_part_number'],
  ['quantity', 'quantity']
]);

function normaliseExtractionFields(value) {
  if (!Array.isArray(value)) throw new ApiError(502, 'MODEL_OUTPUT_INVALID', { expected: 'JSON array' });
  const seen = new Set();
  return value.map((item) => {
    const field = String(item?.field || '').trim();
    const extractedValue = String(item?.value ?? '').trim();
    const confidence = Number(item?.confidence_score);
    const sourceText = String(item?.source_text || '').trim();
    const sourceLanguage = String(item?.source_language || '').trim().toLowerCase();
    const inferredSourceLanguage = sourceLanguage || (
      item?.arabic_value && item?.english_value ? 'both' : item?.arabic_value ? 'ar' : 'en'
    );
    const arabicValue = item?.arabic_value == null ? null : String(item.arabic_value).trim() || null;
    const englishValue = item?.english_value == null ? null : String(item.english_value).trim() || null;
    if (!EXTRACTION_FIELDS.has(field) || seen.has(field) || !extractedValue
      || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !sourceText) {
      throw new ApiError(502, 'MODEL_OUTPUT_INVALID', { field });
    }
    if (!['en', 'ar', 'both'].includes(inferredSourceLanguage)) {
      throw new ApiError(502, 'MODEL_OUTPUT_INVALID', { field, source_language: inferredSourceLanguage });
    }
    seen.add(field);
    return {
      field,
      value: extractedValue,
      confidence_score: Number(confidence.toFixed(2)),
      source_text: sourceText,
      source_language: inferredSourceLanguage,
      arabic_value: arabicValue,
      english_value: englishValue,
      bilingual_mismatch: item?.bilingual_mismatch === true
    };
  });
}

function extractionError(status, code, message, details = {}) {
  return new ApiError(status, code, { ...details, message });
}

function isEncryptedDocumentError(error) {
  return /password|encrypted|encryption|security settings|invalid password/i.test(String(error?.message || error));
}

async function ocrImage(content) {
  let worker;
  try {
    worker = await createWorker('eng+ara', undefined, {
      langPath: process.env.TESSERACT_LANG_PATH || 'https://tessdata.projectnaptha.com/4.0.0',
      cachePath: path.join(os.tmpdir(), 'tesseract-cache')
    });
    const result = await worker.recognize(content);
    const text = String(result?.data?.text || '').trim();
    if (text.length < 3) throw new Error('OCR returned no readable text');
    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw extractionError(422, 'DOCUMENT_OCR_FAILED', error.message || 'OCR returned unusable output');
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}

async function ocrPdfPages(content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'case-document-'));
  const pdfPath = path.join(tempDir, 'document.pdf');
  const outputPrefix = path.join(tempDir, 'page');
  try {
    await fs.writeFile(pdfPath, content);
    await execFileAsync('pdftoppm', [
      '-png', '-r', '200', '-f', '1', '-l', '3', pdfPath, outputPrefix
    ], { maxBuffer: 1024 * 1024 });
    const pageFiles = (await fs.readdir(tempDir))
      .filter((filename) => filename.startsWith('page-') && filename.endsWith('.png'))
      .sort();
    if (!pageFiles.length) throw new Error('No PDF pages were rendered for OCR');
    const pageText = [];
    for (const pageFile of pageFiles) {
      pageText.push(await ocrImage(await fs.readFile(path.join(tempDir, pageFile))));
    }
    return pageText.join('\n').trim();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isEncryptedDocumentError(error)) {
      throw extractionError(422, 'DOCUMENT_ENCRYPTED', error.message);
    }
    throw extractionError(422, 'DOCUMENT_OCR_FAILED', error.message || 'PDF OCR failed');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractText(document) {
  const filename = String(document.original_filename || '').toLowerCase();
  const mimeType = String(document.mime_type || '').toLowerCase();
  const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
  if (isPdf) {
    let text = '';
    try {
      const parser = new PDFParse({ data: document.content });
      try {
        const result = await parser.getText();
        text = String(result.text || '').trim();
      } finally {
        await parser.destroy();
      }
    } catch (error) {
      if (isEncryptedDocumentError(error)) {
        throw extractionError(422, 'DOCUMENT_ENCRYPTED', error.message);
      }
      throw extractionError(422, 'DOCUMENT_PARSE_FAILED', error.message || 'PDF parsing failed');
    }
    if (text.length >= 50) return text;
    const ocrText = await ocrPdfPages(document.content);
    if (ocrText.length < 3) {
      throw extractionError(422, 'DOCUMENT_TEXT_EMPTY', 'The PDF contained no readable text.');
    }
    return ocrText;
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || filename.endsWith('.docx')) {
    try {
      const result = await mammoth.extractRawText({ buffer: document.content });
      const text = String(result.value || '').trim();
      if (text.length < 3) {
        throw extractionError(422, 'DOCUMENT_TEXT_EMPTY', 'The Word document contained no readable text.');
      }
      return text;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw extractionError(422, 'DOCUMENT_PARSE_FAILED', error.message || 'DOCX parsing failed');
    }
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || /\.(jpe?g|png)$/i.test(filename)) {
    return ocrImage(document.content);
  }
  throw extractionError(400, 'UNSUPPORTED_DOCUMENT_FORMAT', 'The uploaded document format is not supported.');
}

async function publishedDocumentAgent(client) {
  const result = await client.query(
    `SELECT id, agent_code, version_label, model_id, system_prompt, max_tokens,
            temperature, timeout_seconds, max_retries
       FROM agent_versions
      WHERE agent_code = 'DOCUMENT' AND status = 'PUBLISHED'
      ORDER BY published_at DESC, id DESC
      LIMIT 1`
  );
  if (!result.rows[0]) throw new ApiError(503, 'AGENT_CONFIGURATION_UNAVAILABLE', { agent_code: 'DOCUMENT' });
  return result.rows[0];
}

function chain(middleware, roles, agentCode) {
  return [
    middleware.authenticate,
    middleware.resolveTenant,
    middleware.openTransaction,
    (request, response, next) => {
      request.requiredAgent = agentCode || null;
      next();
    },
    middleware.entitlement,
    middleware.requireRoles(roles)
  ];
}

function documentSelect(includeContent = false) {
  return `SELECT id, case_id, document_type, original_filename, mime_type, size_bytes,
                  detected_language, detected_document_type, detected_languages,
                  extraction_status, extracted_fields, extracted_line_items,
                  extracted_document, compliance_flags, field_confidence,
                  file_hash,
                 extraction_agent_version_id, extraction_confidence_avg,
                 extraction_reviewed_at, extraction_reviewed_by, confirmed_by,
                 uploaded_by, created_at${includeContent ? ', content' : ''}
            FROM case_documents`;
}

function acceptedFields(body) {
  if (!Array.isArray(body?.accepted_fields)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['accepted_fields'] });
  }
  const seen = new Set();
  return body.accepted_fields.map((item) => {
    const field = String(item?.field || '').trim();
    const value = String(item?.value ?? '').trim();
    if (!EXTRACTION_FIELDS.has(field) || seen.has(field) || !value) {
      throw new ApiError(400, 'VALIDATION_FAILED', { fields: [`accepted_fields.${field || 'field'}`] });
    }
    seen.add(field);
    return {
      field,
      value,
      arabic_value: item?.arabic_value == null ? null : String(item.arabic_value).trim() || null,
      english_value: item?.english_value == null ? null : String(item.english_value).trim() || null
    };
  });
}

async function caseDocument(client, tenantId, caseId, documentId, forUpdate = false, includeContent = false) {
  const result = await client.query(
    `${documentSelect(includeContent)}
      WHERE tenant_id = $1 AND case_id = $2 AND id = $3
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tenantId, caseId, documentId]
  );
  return result.rows[0];
}

function averageConfidence(fields) {
  if (!fields.length) return null;
  return Number((fields.reduce((sum, field) => sum + field.confidence_score, 0) / fields.length).toFixed(2));
}

function extractionAudit(caseId, documentId, agentVersionId, fields, confidence, attempts = [], extraction = {}) {
  return {
    caseId,
    eventType: 'DOCUMENT_EXTRACTION',
    agentVersionId,
    afterState: {
      document_id: documentId,
      agent_version_id: agentVersionId,
      field_count: fields.length,
      document_type: extraction.document_type || null,
      line_item_count: extraction.line_items?.length || 0,
      compliance_flag_count: extraction.compliance_flags?.length || 0,
      line_item_count_mismatch: extraction.line_item_count_mismatch === true,
      extraction_confidence_avg: confidence,
      attempts
    },
    rationale: 'AI-generated extraction. Compliance Officer review is required before use in a compliance decision.'
  };
}

function documentRouter({ middleware, config, modelClient, pool }) {
  const router = express.Router({ mergeParams: true });
  const regularChain = chain(middleware, DOCUMENT_ROLES);
  const extractionChain = chain(middleware, DOCUMENT_ROLES, 'DOCUMENT');

  router.get('/', ...regularChain, asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const caseResult = await client.query(
      `SELECT id FROM compliance_cases WHERE tenant_id = $1 AND id = $2`,
      [request.auth.tenant_id, request.params.id]
    );
    if (!caseResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
    const documents = await client.query(
      `${documentSelect()}
         WHERE tenant_id = $1 AND case_id = $2
         ORDER BY created_at DESC, id DESC`,
      [request.auth.tenant_id, request.params.id]
    );
    response.locals.result = { status: 200, body: { documents: documents.rows } };
    response.locals.auditEvent = {
      caseId: request.params.id,
      eventType: 'CASE_DOCUMENTS_VIEWED',
      afterState: { count: documents.rowCount }
    };
    next();
  }), middleware.finalize);

  router.post('/', ...regularChain, upload.single('file'), asyncHandler(async (request, response, next) => {
    if (!request.file) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['file'] });
    const documentType = String(request.body?.document_type || 'OTHER').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,32}$/.test(documentType)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['document_type'] });
    }
    const client = response.locals.dbClient;
    const caseResult = await client.query(
      `SELECT id FROM compliance_cases WHERE tenant_id = $1 AND id = $2`,
      [request.auth.tenant_id, request.params.id]
    );
    if (!caseResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
    const id = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO case_documents (
         id, tenant_id, case_id, document_type, storage_key, original_filename,
         mime_type, size_bytes, content, extraction_status, uploaded_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'UPLOADED', $10)
       RETURNING id, case_id, document_type, original_filename, mime_type,
                 size_bytes, extraction_status, uploaded_by, created_at`,
      [
        id, request.auth.tenant_id, request.params.id, documentType, `database:${id}`,
        request.file.originalname, request.file.mimetype || 'application/octet-stream',
        request.file.size, request.file.buffer, request.auth.user_id
      ]
    );
    response.locals.result = { status: 201, body: { document: result.rows[0] } };
    response.locals.auditEvent = {
      caseId: request.params.id,
      eventType: 'CASE_DOCUMENT_UPLOADED',
      afterState: {
        document_id: id,
        document_type: documentType,
        original_filename: request.file.originalname,
        size_bytes: request.file.size
      }
    };
    next();
  }), middleware.finalize);

  router.post('/:docId/extract', ...extractionChain, asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const document = await caseDocument(client, request.auth.tenant_id, request.params.id, request.params.docId, false, true);
    if (!document) throw new ApiError(404, 'NOT_FOUND');
    if (!document.content) throw new ApiError(422, 'DOCUMENT_CONTENT_UNAVAILABLE');
    const text = await extractText(document);
    if (!text) throw new ApiError(422, 'DOCUMENT_TEXT_EMPTY');
    const agent = await publishedDocumentAgent(client);
    const input = {
      document_text: text,
      original_filename: document.original_filename,
      document_type: document.document_type
    };
    const extraction = await extractDocumentFields({
      agent,
      input,
      config,
      modelClient
    });
    const fields = extraction.fields;
    const confidence = averageConfidence(fields);

    // UAE Control List — flag any extracted HS code or product name against the UAE list
    const complianceFlags = Array.isArray(extraction.compliance_flags) ? [...extraction.compliance_flags] : [];
    if (pool) {
      try {
        const hsField = fields.find((f) => f.field === 'hs_code' || f.field === 'tariff_code');
        const productField = fields.find((f) => f.field === 'product_name' || f.field === 'goods_description');
        const uaeResult = await screenAgainstUaeList(pool, {
          productName: productField?.value || null,
          scientificName: null,
          casNumber: null,
          hsCode: hsField?.value || null
        });
        if (uaeResult.status === 'UAE_CONTROLLED' || uaeResult.status === 'UAE_DECLARATION_REQUIRED') {
          complianceFlags.push({
            flag: uaeResult.status,
            source: 'UAE_NATIONAL_CONTROL_LIST',
            matched_entry_id: uaeResult.matchedEntryId,
            match_score: uaeResult.matchScore,
            matched_name: uaeResult.entry?.scientificName || uaeResult.entry?.productName || null,
            severity: uaeResult.status === 'UAE_DECLARATION_REQUIRED' ? 'HIGH' : 'MEDIUM'
          });
        }
      } catch {
        // UAE screening failure must not block extraction
      }
    }

    await client.query(
      `UPDATE case_documents
          SET extracted_fields = $4::jsonb,
              extracted_line_items = $5::jsonb,
              extracted_document = $6::jsonb,
              compliance_flags = $7::jsonb,
              detected_document_type = $8,
              detected_languages = $9::jsonb,
              field_confidence = $10::jsonb,
              extraction_agent_version_id = $11,
              extraction_confidence_avg = $12,
              extraction_status = 'EXTRACTED'
        WHERE tenant_id = $1 AND case_id = $2 AND id = $3`,
      [
        request.auth.tenant_id, request.params.id, request.params.docId,
        JSON.stringify(fields),
        JSON.stringify(extraction.line_items || []),
        JSON.stringify(extraction.document || {}),
        JSON.stringify(complianceFlags),
        extraction.document_type || null,
        JSON.stringify(extraction.document_language || []),
        JSON.stringify(Object.fromEntries(fields.map((field) => [field.field, field.confidence_score]))),
        agent.id,
        confidence
      ]
    );
    response.locals.result = {
      status: 200,
      body: {
        document_id: document.id,
        agent_version_id: agent.id,
        fields,
        extraction_confidence_avg: confidence,
        extraction_status: extraction.extraction_status,
        document_type: extraction.document_type,
        document_language: extraction.document_language,
        line_items: extraction.line_items,
        line_item_count: extraction.line_items?.length || 0,
        compliance_flags: extraction.compliance_flags,
        line_item_count_mismatch: extraction.line_item_count_mismatch,
        retry_used: extraction.retry_used,
        disclaimer: 'AI-generated extraction. Review all fields before applying.'
      }
    };
    response.locals.auditEvent = extractionAudit(request.params.id, document.id, agent.id, fields, confidence, extraction.attempts, extraction);
    next();
  }), middleware.finalize);

  router.post('/:docId/apply-extraction', ...regularChain, asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const document = await caseDocument(client, request.auth.tenant_id, request.params.id, request.params.docId, true);
    if (!document) throw new ApiError(404, 'NOT_FOUND');
    if (!Array.isArray(document.extracted_fields)) throw new ApiError(409, 'EXTRACTION_REQUIRED');
    const fields = acceptedFields(request.body);
    if (!fields.length) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['accepted_fields'] });
    const extractedByName = new Map(document.extracted_fields.map((field) => [field.field, field]));
    for (const field of fields) {
      if (!extractedByName.has(field.field)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { fields: [`accepted_fields.${field.field}`] });
      }
    }

    const applied = [];
    for (const field of fields) {
      const original = extractedByName.get(field.field);
      const englishValue = field.english_value || original.english_value || (original.source_language === 'ar' ? null : field.value);
      const arabicValue = field.arabic_value || original.arabic_value || (original.source_language === 'ar' ? field.value : null);
      const appliedValue = field.field === 'destination_country' ? field.value.toUpperCase() : field.value;
      if (PARTY_FIELDS.has(field.field)) {
        const partyRole = PARTY_FIELDS.get(field.field);
        const existing = await client.query(
          `SELECT cp.party_id, p.legal_name, p.arabic_name
             FROM case_parties cp
             JOIN parties p ON p.id = cp.party_id AND p.tenant_id = cp.tenant_id
            WHERE cp.tenant_id = $1 AND cp.case_id = $2 AND cp.party_role = $3`,
          [request.auth.tenant_id, request.params.id, partyRole]
        );
        if (!existing.rows[0]) {
          const partyId = crypto.randomUUID();
          const englishName = englishValue || field.value;
          const arabicName = arabicValue;
          await client.query(
            `INSERT INTO parties (id, tenant_id, legal_name, arabic_name, name_script)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              partyId,
              request.auth.tenant_id,
              englishName,
              arabicName,
              arabicName && !englishValue ? 'ARABIC' : 'LATIN'
            ]
          );
          await client.query(
            `INSERT INTO case_parties (id, tenant_id, case_id, party_id, party_role)
             VALUES ($1, $2, $3, $4, $5)`,
            [crypto.randomUUID(), request.auth.tenant_id, request.params.id, partyId, partyRole]
          );
        }
      } else if (CASE_FIELD_COLUMNS.has(field.field)) {
        const column = CASE_FIELD_COLUMNS.get(field.field);
        if (column === 'destination_country') {
          const country = await client.query(
            `SELECT 1 FROM countries WHERE code = $1 AND is_active = TRUE`,
            [field.value.toUpperCase()]
          );
          if (!country.rows[0]) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['accepted_fields.destination_country'] });
        }
        const current = await client.query(
          `SELECT ${column} AS value FROM compliance_cases WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [request.auth.tenant_id, request.params.id]
        );
        if (!current.rows[0]) throw new ApiError(404, 'NOT_FOUND');
        await client.query(
          `UPDATE compliance_cases SET ${column} = $3 WHERE tenant_id = $1 AND id = $2`,
          [request.auth.tenant_id, request.params.id, appliedValue]
        );
        if (column === 'declared_end_use') {
          await client.query(
            `UPDATE compliance_cases SET stated_end_use = $3
              WHERE tenant_id = $1 AND id = $2`,
            [request.auth.tenant_id, request.params.id, appliedValue]
          );
        }
      }
      applied.push({
        ...field,
        value: appliedValue || field.value,
        arabic_value: arabicValue,
        english_value: englishValue,
        overridden: field.value !== original.value
      });
    }

    await client.query(
      `UPDATE case_documents
          SET extraction_reviewed_at = now(),
              extraction_reviewed_by = $4,
              extraction_status = 'APPLIED'
        WHERE tenant_id = $1 AND case_id = $2 AND id = $3`,
      [request.auth.tenant_id, request.params.id, request.params.docId, request.auth.user_id]
    );
    response.locals.result = {
      status: 200,
      body: {
        case: (await client.query(
          `SELECT * FROM compliance_cases WHERE tenant_id = $1 AND id = $2`,
          [request.auth.tenant_id, request.params.id]
        )).rows[0],
        document_id: request.params.docId,
        applied_fields: applied
      }
    };
    response.locals.auditEvents = applied.map((field) => ({
      caseId: request.params.id,
      eventType: 'FIELD_APPLIED_FROM_EXTRACTION',
      afterState: {
        document_id: request.params.docId,
        field: field.field,
        value: field.value,
        overridden: field.overridden
      },
      rationale: 'Accepted by Compliance Officer from reviewed document extraction.'
    }));
    next();
  }), middleware.finalize);

  return router;
}

module.exports = {
  DOCUMENT_ROLES,
  MAX_FILE_SIZE,
  documentRouter,
  normaliseExtractionFields,
  extractText,
  publishedDocumentAgent,
  averageConfidence
};