import type { Deck } from './types';
import ready from './data/_ready.json';

// Every deck JSON under src/data registers itself. A deck may only be
// committed together with its audio files (public/audio/<lang>/<deck>/).
const modules = import.meta.glob<{ default: Deck }>('./data/*.json', { eager: true });

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const DECKS: Deck[] = Object.values(modules)
  .map((m) => m.default)
  .filter((d): d is Deck => !!d && Array.isArray(d.sentences) && d.sentences.length > 0)
  .filter((d) => (ready as string[]).includes(d.id))
  .sort((a, b) =>
    a.lang.localeCompare(b.lang) ||
    LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
    a.part - b.part,
  );

const pad = (n: number) => String(n).padStart(3, '0');

/** Static MP3 for one sentence, produced once by scripts/generate-audio.mjs. */
export function audioUrl(deck: Deck, n: number): string {
  const deckDir = deck.id.replace(/^[a-z]{2}-/, '');
  return `${import.meta.env.BASE_URL}audio/${deck.lang}/${deckDir}/${pad(n)}.mp3`;
}
