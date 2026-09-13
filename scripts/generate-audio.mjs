/**
 * generate-audio.mjs — speaks every sentence of a deck once via Gemini TTS
 * and stores it as a small MP3 under public/audio/<lang>/<deck>/NNN.mp3.
 *
 * Runs ONCE per deck. The app never calls any AI at runtime.
 *
 * Usage:  node scripts/generate-audio.mjs src/data/es-b1-1.json [--voice Sulafat] [--force]
 *
 * Gemini returns raw PCM (16-bit, mono, 24 kHz). ffmpeg trims leading /
 * trailing silence and encodes to 48 kbps mono MP3 (~4 s ≈ 25 KB).
 */
import { GoogleGenAI, Modality } from '@google/genai';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

const args = process.argv.slice(2);
const deckPath = args.find((a) => !a.startsWith('--'));
if (!deckPath) { console.error('usage: node scripts/generate-audio.mjs <deck.json> [--voice X] [--force]'); process.exit(1); }
const voice = args.includes('--voice') ? args[args.indexOf('--voice') + 1] : 'Sulafat';
const force = args.includes('--force');

const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
const key = env.match(/GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1];
if (!key) { console.error('GEMINI_API_KEY missing in .env.local'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });

const deck = JSON.parse(readFileSync(resolve(deckPath), 'utf8'));
const deckDir = deck.id.replace(/^[a-z]{2}-/, '');
const outDir = join(ROOT, 'public', 'audio', deck.lang, deckDir);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usage = { in: 0, out: 0 };

async function tts(text) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });
      const part = res.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!part?.data) throw new Error('no audio in response');
      const u = res.usageMetadata || {};
      usage.in += u.promptTokenCount || 0; usage.out += u.candidatesTokenCount || 0;
      return { pcm: Buffer.from(part.data, 'base64'), mime: part.mimeType || '' };
    } catch (e) {
      const msg = String(e?.message || e);
      const rate = /429|RESOURCE_EXHAUSTED|503|overloaded/i.test(msg);
      if (rate && attempt < 4) { const d = 4000 * 2 ** attempt; console.log(`   rate-limited, waiting ${d / 1000}s`); await sleep(d); continue; }
      throw e;
    }
  }
}

function encode(pcm, mime, outFile) {
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000);
  return new Promise((res, rej) => {
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.15',
      '-codec:a', 'libmp3lame', '-b:a', '48k', outFile,
    ]);
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error(err || `ffmpeg exit ${c}`))));
    ff.stdin.end(pcm);
  });
}

let done = 0, skipped = 0, chars = 0;
for (const s of deck.sentences) {
  const file = join(outDir, `${String(s.n).padStart(3, '0')}.mp3`);
  if (existsSync(file) && !force) { skipped++; continue; }
  process.stdout.write(`${String(s.n).padStart(3)}  ${s.target}\n`);
  const { pcm, mime } = await tts(s.target);
  await encode(pcm, mime, file);
  chars += s.target.length; done++;
  await sleep(1200);
}
console.log(`\n${deck.id}: ${done} generated, ${skipped} already existed, ${chars} chars spoken → ${outDir}`);
