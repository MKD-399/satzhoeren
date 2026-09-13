export interface Sentence {
  n: number;
  /** The sentence in the language being learned. */
  target: string;
  /** German translation. */
  de: string;
}

export type Lang = 'es' | 'pl';

export interface Deck {
  id: string;
  lang: Lang;
  langLabel: string;
  level: string;
  part: number;
  title: string;
  sentences: Sentence[];
}

/** Which side is shown first; the other side is revealed on tap. */
export type DisplayMode = 'target' | 'de';

export interface Settings {
  /** Playback rate, 0.6 – 1.4. */
  speed: number;
  /** Silence after each sentence (seconds) for repeating aloud. */
  pauseSec: number;
  display: DisplayMode;
  night: boolean;
  random: boolean;
  /** 1-based inclusive range within the deck. */
  from: number;
  to: number;
  /** Practice only the starred sentences of the deck (ignores from/to). */
  starredOnly: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  pauseSec: 3,
  display: 'target',
  night: false,
  random: false,
  from: 1,
  to: 200,
  starredOnly: false,
};
