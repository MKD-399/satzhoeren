/**
 * generate-sentences.mjs — produces a 200-sentence deck from a spec file via
 * Gemini (text). Runs once per deck; the app never calls an AI.
 *
 * Usage: node scripts/generate-sentences.mjs scripts/specs/es-b1-1.json [--count 200] [--batch 25]
 * Writes src/data/<id>.json ({ id, lang, ..., sentences: [{ n, target, de, tags, kind }] }).
 *
 * Quality gates per batch: JSON shape, word count in range, no duplicates
 * (accent-/case-insensitive), no banned textbook phrases, German present.
 * Each batch gets a rotating theme + the previous sentences so it does not repeat.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash'];

const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith('--'));
if (!specPath) { console.error('usage: node scripts/generate-sentences.mjs <spec.json> [--count N] [--batch N]'); process.exit(1); }
const flag = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const COUNT = flag('--count', 200);
const BATCH = flag('--batch', 25);

const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
const key = env.match(/GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1];
if (!key) { console.error('GEMINI_API_KEY missing in .env.local'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });
const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));

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
      kind: { type: Type.STRING, description: 'statement | question | answer | request | negation' },
    },
    required: ['target', 'de', 'tags', 'kind'],
  },
};

function buildPrompt(theme, previous, n) {
  const [lo, hi] = spec.wordRange;
  const prev = previous.slice(-120).map((p) => '- ' + p).join('\n') || '(none yet)';
  return [
    `You write sentences for a listen-and-repeat language trainer. The learner is a German native speaker at level ${spec.level}. Language: ${spec.langName}.`,
    '',
    `Produce exactly ${n} sentences. Each must be something a real person would actually SAY in everyday life. Never textbook, never "example sentence" flavour, never generic. Concrete, specific, alive. Think of real moments: someone texting a friend, complaining to a flatmate, telling a colleague what happened, answering a neighbour.`,
    '',
    `GRAMMAR FOCUS (about 60% of the sentences must clearly use one of these): ${spec.focus}`,
    `ALWAYS ALSO USE (the other ~40%): ${spec.always}`,
    `DO NOT USE: ${spec.avoidGrammar}`,
    `REGISTER: ${spec.register}`,
    `THEME FOR THIS BATCH (anchor most sentences here, a few may drift): ${theme}`,
    `LENGTH: ${lo} to ${hi} words. A couple may be shorter or longer if it sounds natural.`,
    'MIX OF KINDS within the batch: roughly 35% statement, 25% question, 20% answer/reaction (as if replying to something), 10% request/imperative, 10% negation. Use yo/tú most, but also él/ella/nosotros/vosotros/ellos and usted at least once each.',
    'VARIETY: no two sentences should start with the same two words. Do not reuse the same main verb more than twice in the batch. Use different names, places, objects.',
    `FORBIDDEN (textbook markers): ${spec.bannedPhrases.join(' | ')}.`,
    '',
    'German translation: how a German would say it in the same situation, same register, not literal.',
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

const accepted = [];
const seen = new Set();
const rejects = { dup: 0, len: 0, banned: 0, shape: 0 };
const [lo, hi] = spec.wordRange;
let themeIdx = 0;
let round = 0;

while (accepted.length < COUNT && round < (COUNT / BATCH) * 3) {
  round++;
  const theme = spec.themes[themeIdx++ % spec.themes.length];
  const need = Math.min(BATCH, COUNT - accepted.length);
  process.stdout.write(`batch ${round}: ${need} x "${theme.slice(0, 48)}" `);
  let batch;
  try { batch = await generateBatch(theme, accepted.map((a) => a.target), need); }
  catch (e) { console.log(`FAILED: ${e?.message || e}`); await sleep(3000); continue; }
  let ok = 0;
  for (const s of batch) {
    if (!s || typeof s.target !== 'string' || typeof s.de !== 'string' || !s.target.trim() || !s.de.trim()) { rejects.shape++; continue; }
    const target = s.target.trim().replace(/\s+/g, ' ');
    const de = s.de.trim().replace(/\s+/g, ' ');
    const w = words(target);
    if (w < lo - 2 || w > hi + 4) { rejects.len++; continue; }
    if (spec.bannedPhrases.some((b) => norm(target).includes(norm(b)))) { rejects.banned++; continue; }
    const k = norm(target);
    if (seen.has(k)) { rejects.dup++; continue; }
    seen.add(k);
    accepted.push({ target, de, tags: Array.isArray(s.tags) ? s.tags.map(String).slice(0, 5) : [], kind: String(s.kind || '') });
    ok++;
    if (accepted.length >= COUNT) break;
  }
  console.log(`+${ok} -> ${accepted.length}/${COUNT}`);
  await sleep(800);
}

const deck = {
  id: spec.id, lang: spec.lang, langLabel: spec.langLabel, level: spec.level, part: spec.part, title: spec.title,
  sentences: accepted.map((s, i) => ({ n: i + 1, target: s.target, de: s.de, tags: s.tags, kind: s.kind })),
};
mkdirSync(join(ROOT, 'src', 'data'), { recursive: true });
const out = join(ROOT, 'src', 'data', `${spec.id}.json`);
writeFileSync(out, JSON.stringify(deck, null, 2) + '\n');

const kinds = {};
const tagCount = {};
for (const s of accepted) { kinds[s.kind] = (kinds[s.kind] || 0) + 1; for (const t of s.tags) tagCount[t] = (tagCount[t] || 0) + 1; }
console.log(`\n${spec.id}: ${accepted.length} sentences -> ${out}`);
console.log('rejected:', rejects);
console.log('kinds:', kinds);
console.log('top tags:', Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => `${t}=${c}`).join(', '));
const avg = accepted.reduce((a, s) => a + words(s.target), 0) / accepted.length;
console.log(`avg words: ${avg.toFixed(1)}`);
