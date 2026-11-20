// Roman numerals → chords in a key → notes to play.
//
// The data (data.js) writes chords relative to the tonic, the chromatic way:
// "bVImaj7" = a major 7th chord built a minor sixth above the tonic. Lower case = minor
// ("vi7" = minor 7th). "IV/5" = the IV chord over the 5th of the key in the bass.

const ROMAN_DEGREES = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]; // semitones of each degree in a major scale
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

// The 12 keys offered, spelled the usual way.
const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// "bVImaj7/b3" → { acc: -1, step: 5, lower: false, quality: "maj7", bass: {acc, step} }
// step = 0..6 (I..VII), acc = −1 flat, +1 sharp.
const NUMERAL_RE = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)([^/]*)(?:\/([b#]?)(\d))?$/;

function parseNumeral(text) {
  const m = NUMERAL_RE.exec(text);
  if (!m) return null;
  const [, acc, roman, quality, bassAcc, bassDeg] = m;
  const accOf = (a) => (a === "b" ? -1 : a === "#" ? 1 : 0);
  return {
    text,
    acc: accOf(acc),
    step: ROMAN_DEGREES.indexOf(roman.toUpperCase()),
    lower: roman === roman.toLowerCase(),
    quality,
    bass: bassDeg ? { acc: accOf(bassAcc), step: Number(bassDeg) - 1 } : null,
  };
}

// Semitones above the root for a quality. `lower`: the numeral is lower case (minor).
function chordIntervals(quality, lower) {
  let q = quality;
  let third = lower ? 3 : 4, fifth = 7, dim = false;
  if (q.startsWith("°")) { third = 3; fifth = 6; dim = true; q = q.slice(1); }
  else if (q.startsWith("+")) { third = 4; fifth = 8; q = q.slice(1); }
  if (q === "5") return [0, 7]; // power chord: no third
  if (q.includes("sus4")) third = 5;
  else if (q.includes("sus2")) third = 2;
  q = q.replace(/sus[24]/, "");

  const notes = new Set([0, third, fifth]);
  let ext = 0;
  const maj = /^\(?maj(\d+)/.exec(q);
  const num = /^(\d+)/.exec(q);
  if (dim && q.startsWith("7")) notes.add(9);            // °7: diminished seventh
  else if (maj) { notes.add(11); ext = +maj[1]; }       // maj7, maj9…: major seventh
  else if (num && num[1] === "6") notes.add(9);          // 6: major sixth
  else if (num) { notes.add(10); ext = +num[1]; }        // 7, 9, 11, 13: minor seventh
  if (ext >= 9) notes.add(14);
  if (ext >= 11) notes.add(17);
  if (ext >= 13) notes.add(21);
  if (q.includes("add9")) notes.add(14);
  if (q.includes("add11")) notes.add(17);
  // Altered tensions: b9, #9, #11, b13 replace the plain ones.
  if (q.includes("b9")) { notes.delete(14); notes.add(13); }
  if (q.includes("#9")) { notes.delete(14); notes.add(15); }
  if (q.includes("#11")) { notes.delete(17); notes.add(18); }
  if (/b13|13b/.test(q)) { notes.delete(21); notes.add(20); }
  return [...notes].sort((a, b) => a - b);
}

// A degree (step + accidental) in a key → { pc: 0..11, name: "Ab" }.
// Spelled from the letters: in E major the III is G#, not Ab.
function spell(key, step, acc) {
  const tonicLetter = LETTERS.indexOf(KEY_NAMES[key][0]);
  const letter = (tonicLetter + step) % 7;
  const pc = (key + MAJOR_STEPS[step] + acc + 12) % 12;
  const diff = (pc - LETTER_PC[letter] + 12) % 12; // 0, 1 = #, 2 = ##, 11 = b, 10 = bb
  const mark = { 0: "", 1: "#", 2: "##", 11: "b", 10: "bb" }[diff] ?? "";
  return { pc, name: LETTERS[letter] + mark };
}

// A numeral in a key → everything needed to show and play it.
function makeChord(text, key) {
  const n = parseNumeral(text);
  if (!n) return null;
  const root = spell(key, n.step, n.acc);
  const intervals = chordIntervals(n.quality, n.lower);
  const bass = n.bass ? spell(key, n.bass.step, n.bass.acc) : root;

  // Name: lower case means minor, unless the chord has no third (power chord, sus) or is
  // diminished (its "°" already says it).
  const minor = n.lower && !/^(°|5|.*sus)/.test(n.quality);
  let q = n.quality;
  if (minor) q = q.startsWith("maj") ? `m(${q})` : "m" + q;
  const name = root.name + q + (n.bass ? "/" + bass.name : "");
  return { numeral: text, name, root: root.pc, bass: bass.pc, intervals };
}

// Choose the notes: the bass low, the other notes in the middle of the keyboard,
// each chord placed as close as possible to the previous one ("voice leading"), so the
// hands barely move and the progression sounds smooth.
const VOICE_LOW = 52, VOICE_HIGH = 76; // E3..E5

function voiceChord(chord, previous) {
  const pcs = [...new Set(chord.intervals.map((i) => (chord.root + i) % 12))];
  // Try every inversion and octave; keep the closest to the previous voicing.
  const target = previous && previous.length ? previous : [60, 64, 67];
  let best = null, bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = pcs.slice(inv).concat(pcs.slice(0, inv));
    for (let start = VOICE_LOW; start < VOICE_LOW + 12; start++) {
      if (start % 12 !== order[0]) continue;
      const notes = [start];
      for (const pc of order.slice(1)) {
        let p = notes[notes.length - 1] + 1;
        while (p % 12 !== pc) p++;
        notes.push(p);
      }
      if (notes[notes.length - 1] > VOICE_HIGH) continue;
      const cost = distance(notes, target);
      if (cost < bestCost) { best = notes; bestCost = cost; }
    }
  }
  const bass = 36 + ((chord.bass - 36) % 12 + 12) % 12; // C2..B2
  return { bass, notes: best || pcs.map((pc) => 60 + pc) };
}

// How far two voicings are: each note goes to the closest note of the other chord.
function distance(a, b) {
  let d = 0;
  for (const x of a) d += Math.min(...b.map((y) => Math.abs(x - y)));
  for (const y of b) d += Math.min(...a.map((x) => Math.abs(x - y)));
  return d;
}
