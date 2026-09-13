/**
 * WriteView — dictation practice.
 *
 * One random sentence from the current pool is played; Michelle types what
 * she hears; the app checks it word by word and shows the differences.
 * Foreground-only (she is looking at the screen while typing), so a plain
 * short Audio element is fine here — no tape needed.
 */
import { Check, Eye, RotateCcw, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioUrl } from './decks';
import type { Deck, Sentence } from './types';

type Verdict = 'correct' | 'accents' | 'wrong';

/** Lowercase, strip punctuation, collapse whitespace. Accents are kept. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[¿¡?!.,;:"'«»„“”‘’()\-–—…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Additionally drop diacritics — used only to tell "wrong" from "just the accents". */
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}

function judge(input: string, target: string): Verdict {
  const a = normalize(input);
  const b = normalize(target);
  if (a === b) return 'correct';
  if (deaccent(a) === deaccent(b)) return 'accents';
  return 'wrong';
}

/** Word-level marks: which target words the input got wrong (accent-insensitive). */
function wordMarks(input: string, target: string): boolean[] {
  const a = normalize(input).split(' ');
  const b = normalize(target).split(' ');
  return b.map((w, i) => deaccent(a[i] ?? '') !== deaccent(w));
}

export function WriteView(props: { deck: Deck; pool: number[]; onPlayingChange?: (p: boolean) => void }) {
  const { deck, pool } = props;
  const sentences = useMemo(() => {
    const byN = new Map(deck.sentences.map((s) => [s.n, s]));
    return pool.map((n) => byN.get(n)).filter((s): s is Sentence => !!s);
  }, [deck, pool]);

  const [item, setItem] = useState<Sentence | null>(null);
  const [input, setInput] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [shown, setShown] = useState(false);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastRef = useRef<number | null>(null);

  const pick = useCallback(() => {
    if (!sentences.length) { setItem(null); return; }
    let cand = sentences[Math.floor(Math.random() * sentences.length)];
    if (sentences.length > 1) while (cand.n === lastRef.current) cand = sentences[Math.floor(Math.random() * sentences.length)];
    lastRef.current = cand.n;
    setItem(cand);
    setInput('');
    setVerdict(null);
    setShown(false);
  }, [sentences]);

  const speak = useCallback((s: Sentence | null) => {
    if (!s) return;
    const a = audioRef.current ?? (audioRef.current = new Audio());
    a.src = audioUrl(deck, s.n);
    a.play().catch(() => { /* user will tap again */ });
  }, [deck]);

  // First sentence on mount / pool change, spoken right away.
  useEffect(() => { pick(); }, [pick]);
  useEffect(() => { if (item) { speak(item); inputRef.current?.focus(); } }, [item, speak]);
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const check = () => {
    if (!item || !input.trim()) return;
    const v = judge(input, item.target);
    setVerdict(v);
    setScore((sc) => ({ right: sc.right + (v === 'correct' ? 1 : 0), total: sc.total + 1 }));
  };

  if (!sentences.length) {
    return (
      <div className="mx-auto max-w-2xl px-5 pt-16 text-center text-ink-muted">
        Kein Satz im aktuellen Stapel. Wähle in den Einstellungen einen Stapel oder markiere Sätze mit dem Stern.
      </div>
    );
  }
  if (!item) return null;

  const marks = verdict && verdict !== 'correct' ? wordMarks(input, item.target) : null;
  const targetWords = item.target.split(/\s+/);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6">
      <div className="mb-5 flex items-center justify-between text-xs text-ink-muted">
        <span>Schreiben, was du hörst</span>
        <span className="tabular-nums">{score.right} / {score.total} richtig</span>
      </div>

      <button
        onClick={() => speak(item)}
        className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition active:scale-95"
        aria-label="Satz anhören"
      >
        <Volume2 size={34} />
      </button>

      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (verdict) pick(); else check(); } }}
        disabled={!!verdict}
        rows={3}
        placeholder="Hier tippen …"
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
        className="w-full resize-none rounded-2xl border border-edge bg-card px-4 py-3 text-[17px] leading-snug outline-none focus:border-brand disabled:opacity-80"
      />

      {verdict && (
        <div className={[
          'mt-3 rounded-2xl border px-4 py-3',
          verdict === 'correct' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : verdict === 'accents' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-rose-300 bg-rose-50 text-rose-900',
        ].join(' ')}>
          <div className="mb-1 text-sm font-medium">
            {verdict === 'correct' ? 'Richtig!' : verdict === 'accents' ? 'Fast. Nur die Akzente oder Sonderzeichen weichen ab.' : 'Nicht ganz.'}
          </div>
          {verdict !== 'correct' && (
            <div className="text-[17px] leading-snug">
              {targetWords.map((w, i) => (
                <span key={i} className={marks?.[i] ? 'rounded bg-white/70 px-0.5 font-semibold underline decoration-2' : ''}>{w}{i < targetWords.length - 1 ? ' ' : ''}</span>
              ))}
            </div>
          )}
          <div className="mt-1 text-sm opacity-80">{item.de}</div>
        </div>
      )}

      {!verdict && shown && (
        <div className="mt-3 rounded-2xl border border-edge bg-card px-4 py-3">
          <div className="text-[17px] leading-snug">{item.target}</div>
          <div className="mt-1 text-sm text-ink-muted">{item.de}</div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button onClick={() => speak(item)} className="flex items-center justify-center gap-1.5 rounded-xl border border-edge bg-card px-3 py-3 text-sm">
          <RotateCcw size={16} /> Nochmal
        </button>
        {verdict ? (
          <button onClick={pick} className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-3 text-sm font-medium text-white">
            Nächster Satz
          </button>
        ) : (
          <>
            <button onClick={() => setShown((v) => !v)} className="flex items-center justify-center gap-1.5 rounded-xl border border-edge bg-card px-3 py-3 text-sm">
              <Eye size={16} /> Zeigen
            </button>
            <button onClick={check} disabled={!input.trim()} className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-3 text-sm font-medium text-white disabled:opacity-40">
              <Check size={16} /> Prüfen
            </button>
          </>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-ink-muted">Groß-/Kleinschreibung und Satzzeichen zählen nicht. Akzente werden gesondert gemeldet.</p>
    </div>
  );
}
