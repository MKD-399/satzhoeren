/**
 * audio-manifest.mjs — writes src/data/_ready.json: the ids of every deck
 * whose MP3s are ALL present under public/audio. The app only offers decks
 * listed there, so a deck whose audio is still being produced never shows
 * up half-finished. Runs automatically before every build.
 *
 * Also writes src/data/_audio.json: a short content hash per ready deck. The
 * app appends it to every MP3 URL (?v=…), so re-recording a deck changes its
 * URLs and the PWA's CacheFirst audio cache can never serve stale clips
 * (it did: es-b1-1 #1–20 kept playing the prototype deck's recordings).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(ROOT, 'src', 'data');
const ready = [];
const missing = [];
const versions = {};
for (const f of readdirSync(dataDir).filter((f) => /^[a-z]{2}-.*\.json$/.test(f))) {
  const deck = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
  const dir = join(ROOT, 'public', 'audio', deck.lang, deck.id.replace(/^[a-z]{2}-/, ''));
  const file = (s) => join(dir, `${String(s.n).padStart(3, '0')}.mp3`);
  const gaps = deck.sentences.filter((s) => !existsSync(file(s))).map((s) => s.n);
  if (gaps.length) { missing.push(`${deck.id} (${gaps.length} fehlen)`); continue; }
  ready.push(deck.id);
  const h = createHash('sha1');
  for (const s of deck.sentences) h.update(readFileSync(file(s)));
  versions[deck.id] = h.digest('hex').slice(0, 8);
}
writeFileSync(join(dataDir, '_ready.json'), JSON.stringify(ready.sort(), null, 2) + '\n');
writeFileSync(join(dataDir, '_audio.json'), JSON.stringify(Object.fromEntries(Object.entries(versions).sort()), null, 2) + '\n');
console.log('ready:', ready.join(', ') || 'none');
if (missing.length) console.log('not ready:', missing.join(', '));
