/**
 * generate-sentences.mjs — produces a 200-sentence deck from a spec file via
 * Gemini (text). Runs once per deck; the app never calls an AI.
 *
 * Usage:
 *   node scripts/generate-sentences.mjs scripts/specs/es-b1-1.json [--count 200] [--batch 25]
 *   node scripts/generate-sentences.mjs scripts/specs/es-b1-1.json --replace 26-50,92,150
 *       → keeps the existing deck, regenerates only those sentence numbers.
 *
 * Every prompt merges scripts/specs/_profile.json (Michelle's themes, sentence
 * types, content to avoid) with the deck spec (grammar focus of that Teil).
 *
 * Quality gates per batch: JSON shape, word count in range, no duplicates
 * (accent-/case-insensitive), no banned textbook phrases, German present.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash'];

const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith('--'));
if (!specPath) { console.error('usage: node scripts/generate-sentences.mjs <spec.json> [--count N] [--batch N] [--replace a-b,c]'); process.exit(1); }
const flag = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const COUNT = Number(flag('--count', 200));
const BATCH = Number(flag('--batch', 25));
const REPLACE = flag('--replace', null);
const EMPHASIS = flag('--emphasis', '');

const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
const key = env.match(/GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1];
if (!key) { console.error('GEMINI_API_KEY missing in .env.local'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });
const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));
const profile = JSON.parse(readFileSync(join(ROOT, 'scripts', 'specs', '_profile.json'), 'utf8'));
const THEMES = spec.themes?.length ? spec.themes : profile.themes;

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      target: { type: Type.STRING, description: 'The sentence in the target language, natural spoken register, with correct punctuation.' },
      de: { type: Type.STRING, description: 'Natural German translation (how a German would actually say it), not word-for-word.' },
      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Grammar structures used, short labels.' },
      kind: { type: Type.STRING, description: 'statement | question | answer | request | negation | story' },
    },
    required: ['target', 'de', 'tags', 'kind'],
  },
};

function buildPrompt(theme, previous, n) {
  const [lo, hi] = spec.wordRange;
  const prev = previous.slice(-150).map((p) => '- ' + p).join('\n') || '(none yet)';
  return [
    `You write sentences for a listen-and-repeat language trainer. Language: ${spec.langName}. Level: ${spec.level}.`,
    `THE LEARNER: ${profile.learner}`,
    '',
    `Produce exactly ${n} sentences she would plausibly say, write, hear or read herself. Never textbook, never "example sentence" flavour, never generic. Concrete, specific, alive: a message to a friend, a thought on a hard day, a line in an enquiry e-mail, something said before going on stage.`,
    '',
    `GRAMMAR FOCUS (about 60% of the sentences must clearly use one of these, in a natural way): ${spec.focus}`,
    `ALWAYS ALSO USE (the other ~40%): ${spec.always}`,
    `DO NOT USE: ${spec.avoidGrammar}`,
    `THEME FOR THIS BATCH (anchor most sentences here, a few may drift): ${theme}`,
    'SENTENCE TYPES to cover across the batch (mix them, first person dominates):',
    ...profile.sentenceTypes.map((t) => `- ${t}`),
    'CONTENT TO AVOID, always:',
    ...profile.avoidContent.map((t) => `- ${t}`),
    `REGISTER: ${spec.register}`,
    `LENGTH: ${lo} to ${hi} words. A couple may be shorter or longer if it sounds natural; a tiny two-sentence story may reach 30 words.`,
    'MIX OF KINDS within the batch: roughly 30% statement, 30% question (real ones), 15% answer/reaction to something someone said, 10% request, 10% negation/declining, 5% tiny story. Questions are NOT optional.',
    EMPHASIS ? `EXTRA EMPHASIS FOR THIS BATCH: ${EMPHASIS}` : '',
    'Use yo/tú most, but also él/ella/nosotros/vosotros/ellos and usted at least once each per batch.',
    'VARIETY: no two sentences should start with the same two words. Do not reuse the same main verb more than twice in the batch. Different names, places, objects.',
    `FORBIDDEN (textbook markers): ${spec.bannedPhrases.join(' | ')}.`,
    '',
    'German translation: how a German her age would say it in the same situation, same register, not literal.',
    '',
    'Do NOT repeat or closely paraphrase any of these existing sentences:',
    prev,
  ].join('\n');
}

async function generateBatch(theme, previous, n) {
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: buildPrompt(theme, previous, n),
          config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 1.0 },
        });
        const arr = JSON.parse(res.text || '[]');
        if (!Array.isArray(arr)) throw new Error('not an array');
        return arr;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e);
        if (/404|not found/i.test(msg)) break;
        if (/429|503|RESOURCE_EXHAUSTED|overloaded/i.test(msg)) { await sleep(5000 * 2 ** attempt); continue; }
        if (attempt < 3) { await sleep(1500); continue; }
      }
    }
  }
  throw lastErr;
}

function parseSlots(s) {
  const out = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= b; i++) out.push(i);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

// ── Existing deck (for --replace) ─────────────────────────────────
const outPath = join(ROOT, 'src', 'data', `${spec.id}.json`);
const existing = REPLACE && existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null;
const slots = REPLACE ? parseSlots(REPLACE) : null;
if (REPLACE && !existing) { console.error('--replace needs an existing deck at', outPath); process.exit(1); }

const seen = new Set();
const keptTargets = [];
if (existing) for (const s of existing.sentences) if (!slots.includes(s.n)) { seen.add(norm(s.target)); keptTargets.push(s.target); }

const TARGET = slots ? slots.length : COUNT;
const accepted = [];
const rejects = { dup: 0, len: 0, banned: 0, shape: 0 };
const [lo, hi] = spec.wordRange;
let themeIdx = ((spec.part - 1) * Math.ceil(COUNT / BATCH)) % THEMES.length;
let round = 0;

while (accepted.length < TARGET && round < Math.ceil(TARGET / BATCH) * 3) {
  round++;
  const theme = THEMES[themeIdx++ % THEMES.length];
  const need = Math.min(BATCH, TARGET - accepted.length);
  process.stdout.write(`batch ${round}: ${need} x "${theme.slice(0, 48)}" `);
  let batch;
  try { batch = await generateBatch(theme, [...keptTargets, ...accepted.map((a) => a.target)], need); }
  catch (e) { console.log(`FAILED: ${e?.message || e}`); await sleep(3000); continue; }
  let ok = 0;
  for (const s of batch) {
    if (!s || typeof s.target !== 'string' || typeof s.de !== 'string' || !s.target.trim() || !s.de.trim()) { rejects.shape++; continue; }
    const target = s.target.trim().replace(/\s+/g, ' ');
    const de = s.de.trim().replace(/\s+/g, ' ');
    const w = words(target);
    const isStory = String(s.kind || '') === 'story';
    if (w < lo - 2 || w > (isStory ? 32 : hi + 4)) { rejects.len++; continue; }
    if (spec.bannedPhrases.some((b) => norm(target).includes(norm(b)))) { rejects.banned++; continue; }
    const k = norm(target);
    if (seen.has(k)) { rejects.dup++; continue; }
    seen.add(k);
    accepted.push({ target, de, tags: Array.isArray(s.tags) ? s.tags.map(String).slice(0, 5) : [], kind: String(s.kind || '') });
    ok++;
    if (accepted.length >= TARGET) break;
  }
  console.log(`+${ok} -> ${accepted.length}/${TARGET}`);
  await sleep(800);
}

let deck;
if (existing) {
  deck = existing;
  slots.forEach((n, i) => {
    const r = accepted[i];
    const idx = deck.sentences.findIndex((s) => s.n === n);
    if (r && idx >= 0) deck.sentences[idx] = { n, target: r.target, de: r.de, tags: r.tags, kind: r.kind };
  });
  console.log(`replaced ${Math.min(accepted.length, slots.length)} of ${slots.length} slots: ${slots.join(',')}`);
} else {
  deck = {
    id: spec.id, lang: spec.lang, langLabel: spec.langLabel, level: spec.level, part: spec.part, title: spec.title,
    sentences: accepted.map((s, i) => ({ n: i + 1, target: s.target, de: s.de, tags: s.tags, kind: s.kind })),
  };
}
mkdirSync(join(ROOT, 'src', 'data'), { recursive: true });
writeFileSync(outPath, JSON.stringify(deck, null, 2) + '\n');

const kinds = {};
const tagCount = {};
for (const s of accepted) { kinds[s.kind] = (kinds[s.kind] || 0) + 1; for (const t of s.tags) tagCount[t] = (tagCount[t] || 0) + 1; }
console.log(`\n${spec.id}: ${accepted.length} new sentences -> ${outPath}`);
console.log('rejected:', rejects);
console.log('kinds:', kinds);
console.log('top tags:', Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, c]) => `${t}=${c}`).join(', '));
const avg = accepted.reduce((a, s) => a + words(s.target), 0) / Math.max(1, accepted.length);
console.log(`avg words: ${avg.toFixed(1)}`);
