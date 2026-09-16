/**
 * check-deck.mjs — automated sanity report for one or more decks before the
 * human read-through: count, average length, kind mix, off-profile content
 * (offices, cars, alcohol …), filler tails, repeated sentence starts, and an
 * optional regex of grammar that must NOT appear in that Teil.
 *
 * Usage: node scripts/check-deck.mjs src/data/pl-a2-1.json [more decks] [--forbid "regex"]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const forbid = args.includes('--forbid') ? new RegExp(args[args.indexOf('--forbid') + 1], 'iu') : null;
const files = args.filter((a) => a.endsWith('.json'));

// Whole-word match with Unicode letters (\b does not understand ł, ą, ñ …).
const word = (alts) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, 'iu');
const OFF = {
  pl: word('szef|szefowa|szefem|biur[oa]|biurze|spotkani[ea]|spotkaniu|piw[oa]|piwem|win[oa]|winem|wódk[aię]|bar|barze|barów|imprez[aęy]|imprezie|samoch[oó]d|samochodu|samochodem|aut[oa]|autem|akcje|giełd[ay]|giełdzie'),
  es: word('jefe|jefa|oficina|reuni[oó]n|cerveza|cervezas|vino|copas|bar|bares|fiesta|fiestas|coche|coches|aparcar|acciones|bolsa'),
};

for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const S = d.sentences;
  const words = S.map((s) => s.target.split(/\s+/).length);
  const avg = (words.reduce((a, b) => a + b, 0) / S.length).toFixed(1);
  const kinds = {};
  for (const s of S) kinds[s.kind || '?'] = (kinds[s.kind || '?'] || 0) + 1;
  const off = S.filter((s) => OFF[d.lang]?.test(s.target)).map((s) => s.n);
  const tails = S.filter((s) => /,\s*(vale|tío|okej|dobra|no)[.!?]?$|¿(vale|sabes)\?$/i.test(s.target)).map((s) => s.n);
  const starts = {};
  for (const s of S) { const k = s.target.toLowerCase().split(/\s+/).slice(0, 2).join(' '); starts[k] = (starts[k] || 0) + 1; }
  const repeated = Object.entries(starts).filter(([, c]) => c >= 6).map(([k, c]) => `${k} ×${c}`);
  const forb = forbid ? S.filter((s) => forbid.test(s.target)).map((s) => s.n) : [];
  const noDe = S.filter((s) => !s.de || s.de.trim().length < 3).map((s) => s.n);
  const dupDe = S.length - new Set(S.map((s) => s.de.trim().toLowerCase())).size;
  console.log(`\n${d.id}: ${S.length} sentences, avg ${avg} words`);
  console.log(`  kinds: ${JSON.stringify(kinds)}`);
  console.log(`  off-profile: ${off.join(',') || 'none'}`);
  console.log(`  filler tails: ${tails.join(',') || 'none'}`);
  console.log(`  repeated starts: ${repeated.join(' | ') || 'none'}`);
  if (forbid) console.log(`  forbidden grammar: ${forb.join(',') || 'none'}`);
  console.log(`  missing German: ${noDe.join(',') || 'none'}; duplicate German lines: ${dupDe}`);
}
