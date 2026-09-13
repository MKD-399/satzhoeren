/**
 * usePlayer — the listening engine ("tape" model).
 *
 * Android Chrome treats any media clip shorter than ~5 s as a sound effect:
 * no lock-screen controls, no background playback, and the chain of
 * one-clip-per-sentence dies the moment the screen locks. Michelle's phone
 * test proved exactly that.
 *
 * So the app never plays single sentences. It stitches a window of up to
 * TAPE_SIZE sentences plus the repeat-aloud gaps into ONE long WAV blob (a
 * "tape", ~2 min) and plays that through a single <audio> element. To the
 * phone this is a music track: lock screen shows play/pause, playback
 * survives the screen turning off, and moving to the next tape happens from
 * the element's own `ended` event (never from a timer).
 *
 * The current sentence is derived from `timeupdate` against a cue table.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioUrl } from './decks';
import type { Deck, Settings } from './types';

const RATE = 24000;             // Gemini's native sample rate; keeps tapes small
const TAPE_SIZE = 20;           // sentences per tape
const MIN_TAPE_SEC = 6;         // stay clearly above Chrome's 5 s "sound effect" threshold
const DECODE_CACHE_MAX = 80;

interface Cue { n: number; start: number; end: number }
interface Tape {
  url: string;
  cues: Cue[];
  duration: number;
  /** Index into `order` of the first cue, or -1 for a one-off / loop tape. */
  windowStart: number;
  loop: boolean;
}

/* ── Decoding + stitching ─────────────────────────────────────────── */

const decodeCache = new Map<string, Float32Array>();

async function decodePcm(url: string): Promise<Float32Array> {
  const hit = decodeCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  const ab = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(ab);
  const pcm = buf.getChannelData(0).slice();
  decodeCache.set(url, pcm);
  if (decodeCache.size > DECODE_CACHE_MAX) {
    const first = decodeCache.keys().next().value;
    if (first) decodeCache.delete(first);
  }
  return pcm;
}

function wavBlob(samples: Int16Array): Blob {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  const bytes = samples.length * 2;
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  return new Blob([header, samples.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/**
 * Build one tape. `gapSec` is real-time seconds of silence after each
 * sentence; because the element plays at `speed`, the stored gap is scaled so
 * the pause Michelle hears stays what she set.
 */
async function buildTape(deck: Deck, ns: number[], gapSec: number, speed: number, windowStart: number, loop: boolean): Promise<Tape> {
  const pcms = await Promise.all(ns.map((n) => decodePcm(audioUrl(deck, n))));
  const gap = Math.round(gapSec * speed * RATE);
  const oneRound = pcms.reduce((a, p) => a + p.length + gap, 0);
  const minLen = MIN_TAPE_SEC * RATE;
  const repeats = loop ? Math.max(1, Math.ceil(minLen / oneRound)) : 1;
  const tail = !loop && oneRound < minLen ? minLen - oneRound : 0;
  const out = new Int16Array(oneRound * repeats + tail);
  const cues: Cue[] = [];
  let off = 0;
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < pcms.length; i++) {
      const p = pcms[i];
      const start = off / RATE;
      for (let k = 0; k < p.length; k++) {
        const s = p[k];
        out[off + k] = s < -1 ? -32768 : s > 1 ? 32767 : (s * 32767) | 0;
      }
      off += p.length + gap;
      cues.push({ n: ns[i], start, end: off / RATE });
    }
  }
  return { url: URL.createObjectURL(wavBlob(out)), cues, duration: out.length / RATE, windowStart, loop };
}

function shuffle(a: number[]): number[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

const once = (el: HTMLMediaElement, ev: string) => new Promise<void>((res) => el.addEventListener(ev, () => res(), { once: true }));

/* ── Hook ─────────────────────────────────────────────────────────── */

export function usePlayer(deck: Deck, settings: Settings, starred: ReadonlySet<number>) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tapeRef = useRef<Tape | null>(null);
  const nextTapeRef = useRef<{ windowStart: number; promise: Promise<Tape> } | null>(null);
  const posRef = useRef(0);                 // index into order of the current sentence
  const orderRef = useRef<number[]>([]);
  const settingsRef = useRef(settings);
  const deckRef = useRef(deck);
  const loopRef = useRef<number | null>(null);
  const genRef = useRef(0);                 // bumps on every start; stale async work checks it

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<number>(() => {
    try { return Number(localStorage.getItem(`sh_pos_${deck.id}`)) || deck.sentences[0]?.n || 1; } catch { return deck.sentences[0]?.n || 1; }
  });
  const [loopN, setLoopN] = useState<number | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const order = useMemo(() => {
    const all = deck.sentences.map((s) => s.n);
    let base: number[];
    if (settings.starredOnly) {
      base = all.filter((n) => starred.has(n));            // may be empty: nothing to play
    } else {
      const ns = all.filter((n) => n >= settings.from && n <= settings.to);
      base = ns.length ? ns : all;
    }
    return settings.random ? shuffle(base) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, settings.from, settings.to, settings.random, settings.starredOnly, starred, shuffleSeed]);
  orderRef.current = order;
  settingsRef.current = settings;
  deckRef.current = deck;
  loopRef.current = loopN;

  useEffect(() => {
    try { localStorage.setItem(`sh_pos_${deck.id}`, String(current)); } catch { /* ignore */ }
  }, [current, deck.id]);

  const sentenceOf = useCallback((n: number) => deckRef.current.sentences.find((s) => s.n === n), []);

  const setMediaMeta = useCallback((n: number) => {
    if (!('mediaSession' in navigator)) return;
    const s = sentenceOf(n);
    const d = deckRef.current;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s?.target ?? d.title,
        artist: `${n} · ${d.title}`,
        album: 'Satzhören',
      });
    } catch { /* ignore */ }
  }, [sentenceOf]);

  const swapTape = useCallback((t: Tape) => {
    const old = tapeRef.current;
    tapeRef.current = t;
    if (old && old.url !== t.url) URL.revokeObjectURL(old.url);
  }, []);

  const windowOf = (pos: number) => Math.floor(pos / TAPE_SIZE) * TAPE_SIZE;

  /** Kick off building the tape that follows `windowStart` so `ended` can switch instantly. */
  const prefetchNext = useCallback((windowStart: number) => {
    const o = orderRef.current;
    if (!o.length) return;
    let ws = windowStart + TAPE_SIZE;
    if (ws >= o.length) ws = 0;
    if (ws === windowStart) return;              // whole order fits one tape: it just replays
    if (nextTapeRef.current?.windowStart === ws) return;
    const st = settingsRef.current;
    const ns = o.slice(ws, ws + TAPE_SIZE);
    nextTapeRef.current = { windowStart: ws, promise: buildTape(deckRef.current, ns, st.pauseSec, st.speed, ws, false) };
    nextTapeRef.current.promise.catch(() => { nextTapeRef.current = null; });
  }, []);

  /** Load a tape into the element, seek to `startSec`, and play. */
  const runTape = useCallback(async (tape: Tape, startSec: number, gen: number) => {
    const a = audioRef.current;
    if (!a || gen !== genRef.current) { if (gen !== genRef.current) URL.revokeObjectURL(tape.url); return; }
    swapTape(tape);
    a.loop = tape.loop;
    a.src = tape.url;
    await once(a, 'loadedmetadata');
    if (gen !== genRef.current) return;
    a.currentTime = startSec;
    a.playbackRate = settingsRef.current.speed;
    try {
      await a.play();
      if (gen !== genRef.current) return;
      setPlaying(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (!tape.loop && tape.windowStart >= 0) prefetchNext(tape.windowStart);
    } catch (e) {
      setPlaying(false);
      setError(`Wiedergabe blockiert (${(e as Error).message}). Bitte noch einmal auf Play tippen.`);
    }
  }, [swapTape, prefetchNext]);

  /** Start playing the order at index `pos`, building (or reusing) its tape. */
  const startAt = useCallback(async (pos: number) => {
    const o = orderRef.current;
    if (!o.length) return;
    const gen = ++genRef.current;
    const ws = windowOf(pos);
    const st = settingsRef.current;
    posRef.current = pos;
    setCurrent(o[pos]);
    setMediaMeta(o[pos]);
    setError(null);
    try {
      let tape: Tape;
      const cur = tapeRef.current;
      if (cur && !cur.loop && cur.windowStart === ws) {
        tape = cur;
      } else if (nextTapeRef.current?.windowStart === ws) {
        setLoading(true);
        tape = await nextTapeRef.current.promise;
        nextTapeRef.current = null;
      } else {
        setLoading(true);
        tape = await buildTape(deckRef.current, o.slice(ws, ws + TAPE_SIZE), st.pauseSec, st.speed, ws, false);
      }
      setLoading(false);
      const cue = tape.cues[pos - ws];
      await runTape(tape, cue?.start ?? 0, gen);
    } catch (e) {
      setLoading(false);
      setPlaying(false);
      setError(`Audio konnte nicht geladen werden (${(e as Error).message}).`);
    }
  }, [runTape, setMediaMeta]);

  /** Play one sentence on endless repeat (its own short looping tape). */
  const startLoop = useCallback(async (n: number) => {
    const gen = ++genRef.current;
    const st = settingsRef.current;
    setCurrent(n);
    setMediaMeta(n);
    setError(null);
    const idx = orderRef.current.indexOf(n);
    if (idx >= 0) posRef.current = idx;
    try {
      setLoading(true);
      const tape = await buildTape(deckRef.current, [n], st.pauseSec, st.speed, -1, true);
      setLoading(false);
      await runTape(tape, 0, gen);
    } catch (e) {
      setLoading(false);
      setPlaying(false);
      setError(`Audio konnte nicht geladen werden (${(e as Error).message}).`);
    }
  }, [runTape, setMediaMeta]);

  // The single audio element + its event wiring.
  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    audioRef.current = a;
    (window as unknown as { __shAudio?: HTMLAudioElement }).__shAudio = a; // debugging aid only

    const onTime = () => {
      const t = tapeRef.current;
      if (!t || t.loop) return;
      const ct = a.currentTime;
      const i = t.cues.findIndex((c) => ct >= c.start && ct < c.end);
      if (i < 0) return;
      const n = t.cues[i].n;
      posRef.current = t.windowStart + i;
      setCurrent((prev) => {
        if (prev !== n) setMediaMeta(n);
        return n;
      });
    };
    const onEnded = () => {
      const t = tapeRef.current;
      if (!t || t.loop) return;
      const o = orderRef.current;
      let next = t.windowStart + t.cues.length;
      if (next >= o.length) next = 0;
      void startAt(next);
    };
    const onError = () => {
      if (!a.src) return;
      setPlaying(false);
      setError('Audio-Fehler beim Abspielen.');
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
      a.pause();
      a.removeAttribute('src');
      if (tapeRef.current) URL.revokeObjectURL(tapeRef.current.url);
      tapeRef.current = null;
      audioRef.current = null;
    };
  }, [startAt, setMediaMeta]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }, []);

  /** Resume = the current sentence from its beginning (or jump to sentence n). */
  const play = useCallback((n?: number) => {
    if (loopRef.current !== null && (n === undefined || n === loopRef.current)) { void startLoop(loopRef.current); return; }
    if (n !== undefined && loopRef.current !== null) { loopRef.current = null; setLoopN(null); }
    const o = orderRef.current;
    let pos = posRef.current;
    if (n !== undefined) {
      const idx = o.indexOf(n);
      if (idx < 0) { void startLoop(n); return; }     // outside the chosen range: just repeat it
      pos = idx;
    }
    const a = audioRef.current;
    const t = tapeRef.current;
    const ws = windowOf(pos);
    if (a && t && !t.loop && t.windowStart === ws && a.src === t.url) {
      const gen = ++genRef.current;
      posRef.current = pos;
      const cue = t.cues[pos - ws];
      a.currentTime = cue?.start ?? 0;
      a.playbackRate = settingsRef.current.speed;
      setCurrent(o[pos]);
      setMediaMeta(o[pos]);
      a.play().then(() => {
        if (gen !== genRef.current) return;
        setPlaying(true);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      }).catch((e) => { setPlaying(false); setError(`Wiedergabe blockiert (${(e as Error).message}).`); });
      return;
    }
    void startAt(pos);
  }, [startAt, startLoop, setMediaMeta]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const next = useCallback(() => {
    if (loopRef.current !== null) { loopRef.current = null; setLoopN(null); }
    const o = orderRef.current;
    if (!o.length) return;
    play(o[(posRef.current + 1) % o.length]);
  }, [play]);

  const prev = useCallback(() => {
    if (loopRef.current !== null) { loopRef.current = null; setLoopN(null); }
    const o = orderRef.current;
    if (!o.length) return;
    play(o[(posRef.current - 1 + o.length) % o.length]);
  }, [play]);

  const toggleLoop = useCallback((n: number) => {
    if (loopN === n) {
      setLoopN(null);
      loopRef.current = null;
      if (playing) { const idx = orderRef.current.indexOf(n); void startAt(idx >= 0 ? idx : posRef.current); }
      return;
    }
    setLoopN(n);
    loopRef.current = n;
    void startLoop(n);
  }, [loopN, playing, startAt, startLoop]);

  const reshuffle = useCallback(() => setShuffleSeed((s) => s + 1), []);

  // Speed: applies instantly to whatever is playing.
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = settings.speed;
    nextTapeRef.current = null;
  }, [settings.speed]);

  // Pause length: tapes carry the gap, so rebuild the running one at the current sentence.
  const firstPause = useRef(true);
  useEffect(() => {
    if (firstPause.current) { firstPause.current = false; return; }
    nextTapeRef.current = null;
    if (!playing) { if (tapeRef.current) { URL.revokeObjectURL(tapeRef.current.url); tapeRef.current = null; } return; }
    if (loopRef.current !== null) void startLoop(loopRef.current);
    else void startAt(posRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.pauseSec]);

  // Order changed (range / random / deck): drop tapes; keep the current sentence if it is still in range.
  const firstOrder = useRef(true);
  useEffect(() => {
    if (firstOrder.current) { firstOrder.current = false; return; }
    nextTapeRef.current = null;
    const wasPlaying = playing;
    const idx = order.indexOf(current);
    posRef.current = idx >= 0 ? idx : 0;
    if (tapeRef.current && !tapeRef.current.loop) { pause(); URL.revokeObjectURL(tapeRef.current.url); tapeRef.current = null; if (wasPlaying) void startAt(posRef.current); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // Deck switch: stop, restore last position for that deck.
  useEffect(() => {
    pause();
    genRef.current++;
    nextTapeRef.current = null;
    if (tapeRef.current) { URL.revokeObjectURL(tapeRef.current.url); tapeRef.current = null; }
    setLoopN(null); loopRef.current = null;
    let n = deck.sentences[0]?.n || 1;
    try { n = Number(localStorage.getItem(`sh_pos_${deck.id}`)) || n; } catch { /* ignore */ }
    setCurrent(n);
    posRef.current = Math.max(0, orderRef.current.indexOf(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);

  // Lock-screen / headset buttons.
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

  return { playing, loading, current, loopN, error, order, toggle, play, pause, next, prev, toggleLoop, reshuffle };
}
