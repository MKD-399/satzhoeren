/**
 * usePlayer — the listening engine.
 *
 * ONE <audio> element does everything. That matters on Android: the first
 * play() happens inside a tap, which unlocks the element; from then on every
 * further play() is triggered from the element's own `ended` event, never
 * from a timer. Timers freeze when the screen is off — media events do not.
 *
 * The pause for repeating aloud is therefore not a setTimeout but a real
 * silent WAV clip that plays through the same element. To the phone it is
 * continuous media playback, so the lock screen keeps it alive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioUrl } from './decks';
import type { Deck, Settings } from './types';

type Phase = 'sentence' | 'gap';

/** A PCM WAV blob of `seconds` of silence (mono, 8 kHz — small). */
function makeSilence(seconds: number): string {
  const rate = 8000;
  const frames = Math.max(1, Math.round(seconds * rate));
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, frames * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function shuffle(a: number[]): number[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export function usePlayer(deck: Deck, settings: Settings) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>('sentence');
  const posRef = useRef(0);
  const loopRef = useRef<number | null>(null);
  const orderRef = useRef<number[]>([]);
  const speedRef = useRef(settings.speed);
  const silenceRef = useRef<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState<number>(() => {
    try { return Number(localStorage.getItem(`sh_pos_${deck.id}`)) || deck.sentences[0]?.n || 1; } catch { return 1; }
  });
  const [loopN, setLoopN] = useState<number | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Play order = the chosen range, optionally shuffled.
  const order = useMemo(() => {
    const ns = deck.sentences.map((s) => s.n).filter((n) => n >= settings.from && n <= settings.to);
    const base = ns.length ? ns : deck.sentences.map((s) => s.n);
    return settings.random ? shuffle(base) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, settings.from, settings.to, settings.random, shuffleSeed]);
  orderRef.current = order;
  speedRef.current = settings.speed;
  loopRef.current = loopN;

  // Silence clip follows the pause setting.
  useEffect(() => {
    if (silenceRef.current) URL.revokeObjectURL(silenceRef.current);
    silenceRef.current = settings.pauseSec > 0 ? makeSilence(settings.pauseSec) : null;
    return () => { if (silenceRef.current) URL.revokeObjectURL(silenceRef.current); silenceRef.current = null; };
  }, [settings.pauseSec]);

  // Speed changes apply mid-sentence, but never to the silence clip.
  useEffect(() => {
    const a = audioRef.current;
    if (a && phaseRef.current === 'sentence') a.playbackRate = settings.speed;
  }, [settings.speed]);

  useEffect(() => {
    try { localStorage.setItem(`sh_pos_${deck.id}`, String(current)); } catch { /* ignore */ }
  }, [current, deck.id]);

  const sentenceOf = useCallback((n: number) => deck.sentences.find((s) => s.n === n), [deck]);

  const warm = useCallback((n: number) => {
    // Pull the next file into the service-worker / HTTP cache early.
    try { void fetch(audioUrl(deck, n), { mode: 'same-origin' }); } catch { /* ignore */ }
  }, [deck]);

  const updateMediaSession = useCallback((n: number) => {
    if (!('mediaSession' in navigator)) return;
    const s = sentenceOf(n);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s?.target ?? deck.title,
        artist: `${n} · ${deck.title}`,
        album: 'Satzhören',
      });
    } catch { /* ignore */ }
  }, [deck.title, sentenceOf]);

  const playSentence = useCallback((n: number) => {
    const a = audioRef.current;
    if (!a) return;
    phaseRef.current = 'sentence';
    setCurrent(n);
    setError(null);
    a.src = audioUrl(deck, n);
    a.playbackRate = speedRef.current;
    updateMediaSession(n);
    a.play().then(() => setPlaying(true)).catch((e) => {
      setPlaying(false);
      setError(`Konnte Satz ${n} nicht abspielen (${(e as Error).message})`);
    });
    const idx = orderRef.current.indexOf(n);
    const next = orderRef.current[(idx + 1) % orderRef.current.length];
    if (next !== undefined && next !== n) warm(next);
  }, [deck, updateMediaSession, warm]);

  const advance = useCallback(() => {
    if (loopRef.current !== null) { playSentence(loopRef.current); return; }
    const o = orderRef.current;
    if (!o.length) return;
    posRef.current = (posRef.current + 1) % o.length;
    playSentence(o[posRef.current]);
  }, [playSentence]);

  // Create the single audio element once.
  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    audioRef.current = a;
    const onEnded = () => {
      if (phaseRef.current === 'sentence' && silenceRef.current) {
        phaseRef.current = 'gap';
        a.src = silenceRef.current;
        a.playbackRate = 1;
        a.play().catch(() => advance());
      } else {
        advance();
      }
    };
    const onError = () => {
      if (!a.src || a.src === window.location.href) return; // cleared src, not a real failure
      if (phaseRef.current === 'gap') { advance(); return; }
      setError('Audio-Datei fehlt oder konnte nicht geladen werden.');
      setPlaying(false);
    };
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
      a.pause();
      a.removeAttribute('src');
      audioRef.current = null;
    };
  }, [advance]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }, []);

  /** Resume = restart the current sentence from its beginning. */
  const play = useCallback((n?: number) => {
    const target = n ?? current;
    const idx = orderRef.current.indexOf(target);
    if (idx >= 0) posRef.current = idx;
    playSentence(target);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }, [current, playSentence]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const next = useCallback(() => { loopRef.current = null; setLoopN(null); advance(); }, [advance]);
  const prev = useCallback(() => {
    const o = orderRef.current;
    if (!o.length) return;
    posRef.current = (posRef.current - 1 + o.length) % o.length;
    playSentence(o[posRef.current]);
  }, [playSentence]);

  /** Loop one sentence forever; tapping the same one again releases it. */
  const toggleLoop = useCallback((n: number) => {
    if (loopN === n) { setLoopN(null); return; }
    setLoopN(n);
    if (!playing || current !== n) play(n);
  }, [loopN, playing, current, play]);

  const reshuffle = useCallback(() => setShuffleSeed((s) => s + 1), []);

  // Lock-screen / headset controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => play());
      ms.setActionHandler('pause', () => pause());
      ms.setActionHandler('nexttrack', () => next());
      ms.setActionHandler('previoustrack', () => prev());
    } catch { /* ignore */ }
    return () => {
      try { (['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]).forEach((x) => ms.setActionHandler(x, null)); } catch { /* ignore */ }
    };
  }, [play, pause, next, prev]);

  // Deck switch: stop and reset position.
  useEffect(() => {
    pause();
    posRef.current = 0;
    setLoopN(null);
    try { setCurrent(Number(localStorage.getItem(`sh_pos_${deck.id}`)) || deck.sentences[0]?.n || 1); } catch { setCurrent(deck.sentences[0]?.n || 1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);

  return { playing, current, loopN, error, order, toggle, play, pause, next, prev, toggleLoop, reshuffle };
}
