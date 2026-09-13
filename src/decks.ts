import type { Deck } from './types';
import esB1_1 from './data/es-b1-1.json';

export const DECKS: Deck[] = [esB1_1 as Deck];

const pad = (n: number) => String(n).padStart(3, '0');

/** Static MP3 for one sentence, produced once by scripts/generate-audio.mjs. */
export function audioUrl(deck: Deck, n: number): string {
  const deckDir = deck.id.replace(/^[a-z]{2}-/, '');
  return `${import.meta.env.BASE_URL}audio/${deck.lang}/${deckDir}/${pad(n)}.mp3`;
}
