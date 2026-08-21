'use strict';

const LEGAL_SUFFIXES = [
  'f z l l c',
  'f z c o',
  'fz llc',
  'fzllc',
  'fzco',
  'fze',
  'dmcc',
  'establishment',
  'est',
  'international',
  'limited',
  'trading',
  'company',
  'gesellschaft mit beschrankter haftung',
  'gmbh',
  'holding',
  'group',
  'gen trdg',
  'intl',
  'pjsc',
  'psc',
  'wll',
  'spc',
  's a',
  'b v',
  'sa',
  'bv',
  'llc',
  'l l c',
  'ltd',
  'corp',
  'inc',
  'co'
].sort((a, b) => b.length - a.length);

const HONORIFICS = [
  'sheikh',
  'sh',
  'al haj',
  'haji',
  'dr',
  'eng',
  'mr',
  'mrs',
  'sayed',
  'sayyid',
  'prof',
  'h e'
].sort((a, b) => b.length - a.length);

const PARTICLE_ALIASES = [
  ['bin', 'ben', 'ibn', 'bn', 'b'],
  ['abu', 'abo', 'abou', 'aboo'],
  ['abd', 'abdul', 'abdel', 'abdal', 'abd al', 'abd el'],
  ['umm', 'om']
];

function foldDiacritics(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '');
}

function asTokens(value) {
  return value.split(/\s+/).filter(Boolean);
}

function cleanText(value) {
  return asTokens(
    foldDiacritics(String(value || ''))
      .toLowerCase()
      .replace(/[-'’`]/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
  ).join(' ');
}

function removeWholeWordPhrases(value, phrases) {
  let output = value;
  for (const phrase of phrases) {
    const pattern = phrase
      .split(' ')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    output = output.replace(new RegExp(`\\b${pattern}\\b`, 'g'), ' ');
  }
  return asTokens(output).join(' ');
}

function normaliseName(rawName) {
  let value = cleanText(rawName);
  value = removeWholeWordPhrases(value, HONORIFICS);
  value = removeWholeWordPhrases(value, LEGAL_SUFFIXES);
  return value;
}

function replaceParticleAliases(tokens) {
  return PARTICLE_ALIASES.reduce((result, aliases) => {
    const aliasSet = new Set(aliases);
    return result.map((token) => aliasSet.has(token) ? aliases[0] : token);
  }, tokens);
}

function generateNameVariants(rawName) {
  const base = normaliseName(rawName);
  if (!base) return [];

  const variants = new Set([base]);
  const tokens = asTokens(base);
  const canonicalParticles = replaceParticleAliases(tokens);
  variants.add(canonicalParticles.join(' '));

  if (/^(al|el|ul)$/.test(canonicalParticles[0])) {
    variants.add(canonicalParticles.slice(1).join(' '));
  }
  if (canonicalParticles.length > 1 && /^(al|el|ul)$/.test(canonicalParticles[0])) {
    variants.add(`${canonicalParticles[0]}${canonicalParticles.slice(1).join('')}`);
  }

  const first = canonicalParticles[0];
  if (first && /^(abd|abdul|abdel|abdal)$/.test(first) && canonicalParticles[1]) {
    variants.add([first, canonicalParticles[1], ...canonicalParticles.slice(2)].join(' '));
    variants.add([`${first}${canonicalParticles[1]}`, ...canonicalParticles.slice(2)].join(' '));
  }

  for (const aliases of PARTICLE_ALIASES) {
    if (canonicalParticles.some((token) => token === aliases[0])) {
      for (const alias of aliases) {
        variants.add(canonicalParticles.map((token) => token === aliases[0] ? alias : token).join(' '));
      }
      variants.add(canonicalParticles.filter((token) => token !== aliases[0]).join(' '));
    }
  }

  return [...variants].filter(Boolean);
}

function detectScript(value) {
  return /[\u0600-\u06ff]/u.test(String(value || '')) ? 'ARABIC' : 'LATIN';
}

function buildNameRecords(rawName, nameType = 'PRIMARY') {
  const variants = generateNameVariants(rawName);
  return variants.map((variant, index) => ({
    nameType: index === 0 ? nameType : 'AKA',
    script: detectScript(rawName),
    rawName: index === 0 ? String(rawName).trim() : variant,
    normalisedName: variant,
    nameTokens: asTokens(variant)
  }));
}

module.exports = {
  buildNameRecords,
  detectScript,
  generateNameVariants,
  normaliseName
};