/**
 * audio-manifest.mjs — writes src/data/_ready.json: the ids of every deck
 * whose MP3s are ALL present under public/audio. The app only offers decks
 * listed there, so a deck whose audio is still being produced never shows
 * up half-finished. Runs automatically before every build.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(ROOT, 'src', 'data');
const ready = [];
const missing = [];
for (const f of readdirSync(dataDir).filter((f) => /^[a-z]{2}-.*\.json$/.test(f))) {
  const deck = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
  const dir = join(ROOT, 'public', 'audio', deck.lang, deck.id.replace(/^[a-z]{2}-/, ''));
  const gaps = deck.sentences.filter((s) => !existsSync(join(dir, `${String(s.n).padStart(3, '0')}.mp3`))).map((s) => s.n);
  if (gaps.length) missing.push(`${deck.id} (${gaps.length} fehlen)`); else ready.push(deck.id);
}
writeFileSync(join(dataDir, '_ready.json'), JSON.stringify(ready.sort(), null, 2) + '\n');
console.log('ready:', ready.join(', ') || 'none');
if (missing.length) console.log('not ready:', missing.join(', '));
