'use strict';

const crypto = require('node:crypto');
const { buildNameRecords } = require('../shared/normalise');

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function clean(value) {
  return String(value || '').trim();
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined && clean(object[key])) return clean(object[key]);
  }
  return '';
}

function splitValues(value) {
  return [...new Set(clean(value).split(/[;,/|]/).map((part) => part.trim()).filter(Boolean))];
}

function countryCode(value) {
  const candidate = clean(value).toUpperCase();
  return /^[A-Z]{2}$/.test(candidate) ? candidate : null;
}

function entityType(value) {
  const candidate = clean(value).toUpperCase();
  if (/VESSEL|SHIP/.test(candidate)) return 'VESSEL';
  if (/AIRCRAFT|AIRCRAFT/.test(candidate)) return 'AIRCRAFT';
  if (/INDIVIDUAL|PERSON|NATURAL/.test(candidate)) return 'INDIVIDUAL';
  return 'ENTITY';
}

function parseDelimited(payload) {
  const text = Buffer.from(payload).toString('utf8').replace(/^\uFEFF/u, '');
  if (/^\s*</u.test(text)) {
    throw new Error('Expected a CSV payload but received markup');
  }
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => clean(value))) rows.push(row);
  }
  if (rows.length < 2) throw new Error('CSV source did not contain a header and at least one row');

  const headers = rows.shift().map((header) => clean(header).toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
}

function xmlTags(block, tag) {
  const matcher = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...block.matchAll(matcher)].map((match) => decodeXml(match[1]).replace(/<[^>]+>/g, ' ').trim()).filter(Boolean);
}

function xmlTag(block, tags) {
  for (const tag of tags) {
    const values = xmlTags(block, tag);
    if (values.length) return values[0];
  }
  return '';
}

function parseXml(payload) {
  const text = Buffer.from(payload).toString('utf8');
  const entryMatches = [...text.matchAll(/<(sdnEntry|SanctionsEntry|entry|entity)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  if (!entryMatches.length) throw new Error('XML source did not contain recognizable entries');

  return entryMatches.map((match, index) => {
    const block = match[2];
    const firstName = xmlTag(block, ['firstName', 'givenName']);
    const lastName = xmlTag(block, ['lastName', 'surname', 'familyName']);
    const primaryName = xmlTag(block, ['name', 'fullName']) || [firstName, lastName].filter(Boolean).join(' ');
    const identifiers = [];
    const idBlocks = [...block.matchAll(/<id(?:\s[^>]*)?>([\s\S]*?)<\/id>/gi)];
    for (const idBlock of idBlocks) {
      const idValue = xmlTag(idBlock[1], ['idNumber', 'idValue', 'value']);
      if (idValue) identifiers.push({
        idType: xmlTag(idBlock[1], ['idType', 'type']) || 'OTHER',
        idValue,
        countryCode: countryCode(xmlTag(idBlock[1], ['country', 'countryCode']))
      });
    }
    const names = [...new Set([
      ...(primaryName ? [primaryName] : []),
      ...xmlTags(block, 'aka'),
      ...xmlTags(block, 'akaName')
    ])];
    if (!names.length) throw new Error(`XML entry ${index + 1} has no name`);
    return {
      sourceRef: xmlTag(block, ['uid', 'id', 'sourceRef', 'reference'])
        || stableReference(primaryName || names[0], xmlTag(block, ['sdnType', 'entityType', 'type']), xmlTag(block, ['country', 'countryCode']), identifiers),
      entityType: entityType(xmlTag(block, ['sdnType', 'entityType', 'type'])),
      programs: [...new Set(xmlTags(block, 'program'))],
      countryCode: countryCode(xmlTag(block, ['country', 'countryCode'])),
      remarks: xmlTag(block, ['remarks', 'remark', 'notes']),
      names: names.flatMap((name, nameIndex) => buildNameRecords(name, nameIndex === 0 ? 'PRIMARY' : 'AKA')),
      identifiers
    };
  });
}

function parseJson(payload) {
  const parsed = JSON.parse(Buffer.from(payload).toString('utf8'));
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed.entries || parsed.data || parsed.results || parsed.items;
  if (!Array.isArray(rows)) throw new Error('JSON source did not contain an entry array');
  return rows.map((row, index) => rowToEntry(row, index));
}

function stableReference(name, type, country, identifiers) {
  const canonicalIdentity = JSON.stringify({
    name: clean(name).toLowerCase(),
    type: clean(type).toUpperCase(),
    country: countryCode(country),
    identifiers: identifiers
      .map((identifier) => [identifier.idType, identifier.idValue, identifier.countryCode])
      .sort()
  });
  return `derived-${crypto.createHash('sha256').update(canonicalIdentity).digest('hex')}`;
}

function rowToEntry(row, index) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    Array.isArray(value) ? value.join('; ') : value
  ]));
  const name = firstValue(normalized, [
    'name', 'entity_name', 'full_name', 'party_name', 'sdn_name',
    'company_name', 'individual_name', 'subject_name'
  ]) || [normalized.first_name, normalized.last_name].filter(Boolean).join(' ');
  if (!name) throw new Error(`Structured entry ${index + 1} has no name`);

  const identifierFields = Object.entries(normalized).filter(([key, value]) =>
    value && /(passport|tax_id|registration|imo|identifier|id_number)/i.test(key)
  );
  const rowIdentifiers = identifierFields.map(([key, value]) => ({
    idType: key.toUpperCase(),
    idValue: clean(value),
    countryCode: countryCode(normalized.country_code || normalized.country)
  }));

  return {
    sourceRef: firstValue(normalized, [
      'uid', 'id', 'source_ref', 'reference', 'entity_number', 'record_id'
    ]) || stableReference(
      name,
      firstValue(normalized, ['entity_type', 'sdn_type', 'type']),
      firstValue(normalized, ['country_code', 'country', 'nationality']),
      rowIdentifiers
    ),
    entityType: entityType(firstValue(normalized, ['entity_type', 'sdn_type', 'type'])),
    programs: splitValues(firstValue(normalized, ['programs', 'program', 'sanctions_program'])),
    countryCode: countryCode(firstValue(normalized, ['country_code', 'country', 'nationality'])),
    remarks: firstValue(normalized, ['remarks', 'remark', 'notes', 'comments']),
    names: buildNameRecords(name),
    identifiers: rowIdentifiers
  };
}

function deduplicateEntries(entries) {
  const byReference = new Map();
  for (const entry of entries) {
    const existing = byReference.get(entry.sourceRef);
    if (!existing) {
      byReference.set(entry.sourceRef, {
        ...entry,
        programs: [...new Set(entry.programs)],
        names: [...entry.names],
        identifiers: [...entry.identifiers]
      });
      continue;
    }
    existing.programs = [...new Set([...existing.programs, ...entry.programs])];
    existing.names.push(...entry.names);
    existing.identifiers.push(...entry.identifiers);
  }
  return [...byReference.values()].map((entry) => ({
    ...entry,
    names: [...new Map(entry.names.map((name) => [
      `${name.nameType}|${name.normalisedName}|${name.rawName}`,
      name
    ])).values()],
    identifiers: [...new Map(entry.identifiers.map((identifier) => [
      `${identifier.idType}|${identifier.idValue}`,
      identifier
    ])).values()]
  }));
}

function parsePayload(payload, format) {
  const normalizedFormat = String(format || '').toUpperCase();
  let entries;
  if (normalizedFormat === 'CSV') entries = parseDelimited(payload);
  else if (normalizedFormat === 'JSON') entries = parseJson(payload);
  else if (normalizedFormat === 'XML') entries = parseXml(payload);
  else throw new Error(`Unsupported source format: ${format}`);

  const normalizedEntries = normalizedFormat === 'CSV'
    ? entries.map((row, index) => rowToEntry(row, index))
    : entries;
  return deduplicateEntries(normalizedEntries);
}

module.exports = {
  parsePayload,
  parseDelimited,
  parseJson,
  parseXml
};