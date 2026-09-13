import { ChevronDown, Headphones, Loader2, Moon, Pause, Pencil, Play, Repeat, Settings2, Shuffle, SkipBack, SkipForward, Star, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DECKS } from './decks';
import { usePlayer } from './usePlayer';
import { WriteView } from './WriteView';
import { DEFAULT_SETTINGS, type Deck, type Sentence, type Settings } from './types';

const SETTINGS_KEY = 'sh_settings';
const DECK_KEY = 'sh_deck';
const starsKey = (deckId: string) => `sh_stars_${deckId}`;

type View = 'listen' | 'write';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...p };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadStars(deckId: string): Set<number> {
  try {
    const raw = localStorage.getItem(starsKey(deckId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : []);
  } catch {
    return new Set();
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [deckId, setDeckId] = useState<string>(() => {
    try { return localStorage.getItem(DECK_KEY) || DECKS[0].id; } catch { return DECKS[0].id; }
  });
  const deck = useMemo(() => DECKS.find((d) => d.id === deckId) ?? DECKS[0], [deckId]);
  const [view, setView] = useState<View>('listen');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [stars, setStars] = useState<Set<number>>(() => loadStars(deck.id));

  const player = usePlayer(deck, settings, stars);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, [settings]);
  useEffect(() => {
    try { localStorage.setItem(DECK_KEY, deck.id); } catch { /* ignore */ }
    setStars(loadStars(deck.id));
  }, [deck.id]);
  useEffect(() => {
    try { localStorage.setItem(starsKey(deck.id), JSON.stringify([...stars])); } catch { /* ignore */ }
  }, [stars, deck.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.night ? 'nacht' : 'tag';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.night ? '#000000' : '#1F6F8B');
  }, [settings.night]);

  // Hide translations again whenever the display side flips.
  useEffect(() => { setRevealed(new Set()); }, [settings.display, deck.id]);

  // Dictation has its own audio; the listening player stays paused meanwhile.
  const pausePlayer = player.pause;
  useEffect(() => { if (view === 'write') pausePlayer(); }, [view, pausePlayer]);

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

  const toggleReveal = useCallback((n: number) => {
    setRevealed((prev) => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  }, []);
  const toggleStar = useCallback((n: number) => {
    setStars((prev) => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  }, []);

  // Keep the current sentence in view while playing — no scrolling by hand.
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  useEffect(() => {
    if (!player.playing || view !== 'listen') return;
    rowRefs.current.get(player.current)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [player.current, player.playing, view]);

  const inRange = useMemo(() => new Set(player.order), [player.order]);
  const posLabel = player.order.length
    ? `${Math.max(0, player.order.indexOf(player.current)) + 1} / ${player.order.length}`
    : 'keine Sätze';

  return (
    <div className="min-h-dvh bg-surface text-ink">
      {/* ── Top bar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-edge bg-surface/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight">{deck.title}</div>
            <div className="truncate text-xs text-ink-muted">
              {posLabel}
              {settings.starredOnly && ' · ★ markierte'}
              {settings.random && ' · zufällig'}
              {player.loopN !== null && ` · Schleife Satz ${player.loopN}`}
            </div>
          </div>
          {view === 'listen' && (
            <>
              <button onClick={player.prev} aria-label="Vorheriger Satz" className="rounded-full p-2 text-ink-muted hover:text-ink">
                <SkipBack size={20} />
              </button>
              <button
                onClick={player.toggle}
                aria-label={player.playing ? 'Pause' : 'Abspielen'}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition active:scale-95"
              >
                {player.loading ? <Loader2 size={26} className="animate-spin" /> : player.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
              </button>
              <button onClick={player.next} aria-label="Nächster Satz" className="rounded-full p-2 text-ink-muted hover:text-ink">
                <SkipForward size={20} />
              </button>
            </>
          )}
          <button onClick={() => setSheetOpen(true)} aria-label="Einstellungen" className="rounded-full p-2 text-ink-muted hover:text-ink">
            <Settings2 size={22} />
          </button>
        </div>
        {player.error && view === 'listen' && (
          <div className="mx-auto max-w-2xl px-4 pb-2 text-xs text-red-500">{player.error}</div>
        )}
      </header>

      {/* ── Content ────────────────────────────────────────────── */}
      {view === 'listen' ? (
        <main className="mx-auto max-w-2xl px-3 pb-32 pt-3">
          {settings.starredOnly && stars.size === 0 && (
            <div className="mb-3 rounded-2xl border border-edge bg-card px-4 py-3 text-sm text-ink-muted">
              Noch kein Satz markiert. Tippe auf den Stern neben einem Satz, dann landet er hier.
            </div>
          )}
          <ul className="space-y-1.5">
            {deck.sentences.map((s) => (
              <SentenceRow
                key={s.n}
                s={s}
                display={settings.display}
                active={player.current === s.n}
                playing={player.playing && player.current === s.n}
                looping={player.loopN === s.n}
                starred={stars.has(s.n)}
                dimmed={!inRange.has(s.n)}
                revealed={revealed.has(s.n)}
                onReveal={() => toggleReveal(s.n)}
                onStar={() => toggleStar(s.n)}
                onPlay={() => (player.playing && player.current === s.n ? player.pause() : player.play(s.n))}
                onLoop={() => player.toggleLoop(s.n)}
                refCb={(el) => { if (el) rowRefs.current.set(s.n, el); else rowRefs.current.delete(s.n); }}
              />
            ))}
          </ul>
          <p className="mt-8 text-center text-xs text-ink-muted">
            Tippe auf einen Satz für die Übersetzung. Die Wiedergabe läuft in Dauerschleife, bis du Pause drückst.
          </p>
        </main>
      ) : (
        <main className="pb-32">
          <WriteView deck={deck} pool={player.order} />
        </main>
      )}

      {/* ── Bottom tabs ────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-edge bg-surface/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto grid max-w-2xl grid-cols-2">
          <Tab on={view === 'listen'} onClick={() => setView('listen')} icon={<Headphones size={20} />} label="Hören" />
          <Tab on={view === 'write'} onClick={() => setView('write')} icon={<Pencil size={20} />} label="Schreiben" />
        </div>
      </nav>

      {sheetOpen && (
        <SettingsSheet
          settings={settings}
          deck={deck}
          starCount={stars.size}
          onPatch={patch}
          onDeck={setDeckId}
          onReshuffle={player.reshuffle}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

function Tab({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${on ? 'text-brand' : 'text-ink-muted'}`}>
      {icon}
      {label}
    </button>
  );
}

/* ── Row ──────────────────────────────────────────────────────────── */

function SentenceRow(props: {
  s: Sentence; display: Settings['display'];
  active: boolean; playing: boolean; looping: boolean; starred: boolean; dimmed: boolean; revealed: boolean;
  onReveal: () => void; onStar: () => void; onPlay: () => void; onLoop: () => void;
  refCb: (el: HTMLLIElement | null) => void;
}) {
  const { s, display, active, playing, looping, starred, dimmed, revealed } = props;
  const primary = display === 'target' ? s.target : s.de;
  const secondary = display === 'target' ? s.de : s.target;
  return (
    <li
      ref={props.refCb}
      className={[
        'flex items-start gap-1.5 rounded-2xl border px-2.5 py-2.5 transition-colors',
        active ? 'border-brand/40 bg-active' : 'border-edge bg-card',
        dimmed ? 'opacity-40' : '',
      ].join(' ')}
    >
      <span className={`mt-1 w-6 shrink-0 text-right text-xs tabular-nums ${active ? 'font-semibold text-brand' : 'text-ink-muted'}`}>{s.n}</span>
      <button onClick={props.onReveal} className="min-w-0 flex-1 px-1 text-left">
        <div className={`text-[17px] leading-snug ${active ? 'font-medium' : ''}`}>{primary}</div>
        {revealed && <div className="mt-1 text-[14px] leading-snug text-ink-muted">{secondary}</div>}
      </button>
      <div className="flex shrink-0 items-center">
        <button
          onClick={props.onStar}
          aria-label={starred ? 'Markierung entfernen' : 'Satz markieren'}
          className={`rounded-full p-1.5 transition ${starred ? 'text-amber-500' : 'text-ink-muted/60 hover:text-ink'}`}
        >
          <Star size={17} fill={starred ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={props.onLoop}
          aria-label="Satz wiederholen"
          className={`rounded-full p-1.5 transition ${looping ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'}`}
        >
          <Repeat size={17} />
        </button>
        <button
          onClick={props.onPlay}
          aria-label={playing ? 'Pause' : 'Satz abspielen'}
          className={`rounded-full p-1.5 transition ${active ? 'text-brand' : 'text-ink-muted hover:text-ink'}`}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
      </div>
    </li>
  );
}

/* ── Settings sheet ───────────────────────────────────────────────── */

function SettingsSheet(props: {
  settings: Settings; deck: Deck; starCount: number;
  onPatch: (p: Partial<Settings>) => void; onDeck: (id: string) => void; onReshuffle: () => void; onClose: () => void;
}) {
  const { settings: st, deck, onPatch, starCount } = props;
  const total = deck.sentences.length;
  const chunks = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let a = 1; a <= total; a += 20) out.push([a, Math.min(a + 19, total)]);
    return out;
  }, [total]);
  const isAll = st.from <= 1 && st.to >= total;
  const stapelLabel = st.starredOnly ? `★ markierte (${starCount})` : isAll ? `alle ${total}` : `${st.from}–${st.to}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={props.onClose}>
      <div
        className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-card px-5 pb-8 pt-4 shadow-2xl"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Einstellungen</h2>
          <button onClick={props.onClose} aria-label="Schließen" className="rounded-full p-2 text-ink-muted hover:text-ink"><X size={20} /></button>
        </div>

        <Section label="Sprache & Stapel">
          <div className="relative">
            <select
              value={deck.id}
              onChange={(e) => props.onDeck(e.target.value)}
              className="w-full appearance-none rounded-xl border border-edge bg-surface px-3 py-2.5 pr-9 text-[15px]"
            >
              {DECKS.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-ink-muted" />
          </div>
        </Section>

        <Section label={`Sprechtempo · ${st.speed.toFixed(2)}×`}>
          <input type="range" min={0.6} max={1.4} step={0.05} value={st.speed} onChange={(e) => onPatch({ speed: Number(e.target.value) })} className="w-full" />
          <div className="flex justify-between text-xs text-ink-muted"><span>langsam</span><span>normal</span><span>schnell</span></div>
        </Section>

        <Section label={`Pause zum Nachsprechen · ${st.pauseSec} s`}>
          <input type="range" min={0} max={10} step={0.5} value={st.pauseSec} onChange={(e) => onPatch({ pauseSec: Number(e.target.value) })} className="w-full" />
          <div className="flex justify-between text-xs text-ink-muted"><span>keine</span><span>10 s</span></div>
        </Section>

        <Section label="Anzeige">
          <div className="grid grid-cols-2 gap-2">
            <Chip on={st.display === 'target'} onClick={() => onPatch({ display: 'target' })}>{deck.langLabel} zuerst</Chip>
            <Chip on={st.display === 'de'} onClick={() => onPatch({ display: 'de' })}>Deutsch zuerst</Chip>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">Die andere Seite erscheint beim Tippen auf den Satz. „Deutsch zuerst" ist der Übersetzungs-Modus.</p>
        </Section>

        <Section label="Reihenfolge">
          <div className="grid grid-cols-2 gap-2">
            <Chip on={!st.random} onClick={() => onPatch({ random: false })}>Der Reihe nach</Chip>
            <Chip on={st.random} onClick={() => { onPatch({ random: true }); props.onReshuffle(); }}><Shuffle size={14} className="mr-1 inline" />Zufällig</Chip>
          </div>
        </Section>

        <Section label={`Stapel · ${stapelLabel}`}>
          <div className="mb-2">
            <Chip on={st.starredOnly} onClick={() => onPatch({ starredOnly: !st.starredOnly })}>
              <Star size={14} className="mr-1 inline" fill={st.starredOnly ? 'currentColor' : 'none'} />Nur markierte Sätze ({starCount})
            </Chip>
          </div>
          <div className={st.starredOnly ? 'pointer-events-none opacity-40' : ''}>
            <div className="flex flex-wrap gap-2">
              <Chip small on={isAll} onClick={() => onPatch({ from: 1, to: total })}>Alle</Chip>
              {chunks.map(([a, b]) => (
                <Chip key={a} small on={st.from === a && st.to === b} onClick={() => onPatch({ from: a, to: b })}>{a}–{b}</Chip>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-ink-muted">von</span>
              <input type="number" min={1} max={total} value={st.from} onChange={(e) => onPatch({ from: clamp(Number(e.target.value), 1, total) })} className="w-20 rounded-lg border border-edge bg-surface px-2 py-1.5 text-center" />
              <span className="text-ink-muted">bis</span>
              <input type="number" min={1} max={total} value={st.to} onChange={(e) => onPatch({ to: clamp(Number(e.target.value), 1, total) })} className="w-20 rounded-lg border border-edge bg-surface px-2 py-1.5 text-center" />
            </div>
          </div>
        </Section>

        <Section label="Bildschirm">
          <div className="grid grid-cols-2 gap-2">
            <Chip on={!st.night} onClick={() => onPatch({ night: false })}><Sun size={14} className="mr-1 inline" />Tag</Chip>
            <Chip on={st.night} onClick={() => onPatch({ night: true })}><Moon size={14} className="mr-1 inline" />Nacht (OLED-schonend)</Chip>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 text-[13px] font-medium text-ink-muted">{label}</div>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-xl border transition',
        small ? 'px-3 py-1.5 text-sm' : 'px-3 py-2.5 text-[15px]',
        on ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-edge bg-surface text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
