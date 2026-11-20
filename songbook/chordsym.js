// Chord symbols as written on chord sheets: "F#m7", "Cadd9", "D/F#", "EbM7"…
// Read them, transpose them, name them in a key, turn them into roman numerals.
// Builds on ../progressions/theory.js (chordIntervals, LETTERS, MAJOR_STEPS…).

const SYMBOL_RE = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/;
const ACC = { "#": 1, b: -1, "": 0 };

// "F#m7/E" → { root: 6, bass: 4, minor: true, quality: "7", triad: "min" }
// What may follow the root: m, maj, 7, sus4, add9, b5, dim, aug, (9)… nothing else, so that
// words like "Chorus" or "Bridge" are not taken for C and B chords.
const QUALITY_OK = /^(?:maj|min|m|M|-|dim|aug|\+|°|ø|sus|add|no|b|#|\d|\(|\)|,)*$/;

function parseSymbol(text) {
  const m = SYMBOL_RE.exec(text.trim());
  if (!m || !QUALITY_OK.test(m[3])) return null;
  const [, letter, acc, q0, bassLetter, bassAcc] = m;
  const root = (LETTER_PC[LETTERS.indexOf(letter)] + ACC[acc] + 12) % 12;
  const bass = bassLetter ? (LETTER_PC[LETTERS.indexOf(bassLetter)] + ACC[bassAcc || ""] + 12) % 12 : root;

  // Quality, rewritten the way theory.js reads it (the minor "m" is kept apart).
  let q = q0, minor = false;
  if (/^(m(?!aj)|min|-)/.test(q)) { minor = true; q = q.replace(/^(min|m|-)/, ""); }
  q = q.replace(/^M(?=\d)/, "maj").replace(/^dim/, "°").replace(/^(aug|\+)/, "+");
  const triad = /^°/.test(q) ? "dim" : /^\+/.test(q) ? "aug" : /^5$|sus/.test(q) ? "open" : minor ? "min" : "maj";
  return { text, root, bass, minor, quality: q, triad, intervals: chordIntervals(q, minor) };
}

// Name a pitch class in a key: the letter follows the degree (E major → G#, not Ab).
// tonic: pitch class; tonicName: how the tonic is written ("Eb", "F#").
const DEGREE_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
function nameIn(pc, tonic, tonicName) {
  const [step, acc] = DEGREE_SPELL[(pc - tonic + 12) % 12];
  const letter = (LETTERS.indexOf(tonicName[0]) + step) % 7;
  const target = (tonic + MAJOR_STEPS[step] + acc + 12) % 12;
  const diff = (target - LETTER_PC[letter] + 12) % 12;
  return LETTERS[letter] + ({ 0: "", 1: "#", 2: "##", 11: "b", 10: "bb" }[diff] ?? "");
}

// Usual spelling of a tonic: major keys like KEY_NAMES, minor keys with sharps up to G#.
const MINOR_TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const tonicName = (pc, minor) => (minor ? MINOR_TONICS : KEY_NAMES)[pc];

// The symbol moved by `semis` semitones, spelled for the new key.
function transposeSymbol(chord, semis, key) {
  if (!semis) return chord.text; // untouched: keep the sheet's own spelling
  const t = (key.tonic + semis + 120) % 12;
  const name = tonicName(t, key.minor);
  const m = SYMBOL_RE.exec(chord.text);
  const rest = m[3];
  const root = nameIn((chord.root + semis + 120) % 12, t, name);
  const bass = chord.bass !== chord.root ? "/" + nameIn((chord.bass + semis + 120) % 12, t, name) : "";
  return root + rest + bass;
}

// Roman numeral in the key: "vi7", "bVII", "IV/5" (like the progressions data).
const NUMERALS = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"];
const DEGREES = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];
function numeralOf(chord, key) {
  let r = NUMERALS[(chord.root - key.tonic + 12) % 12];
  if (chord.minor || chord.triad === "dim") r = r.toLowerCase();
  let s = r + chord.quality;
  if (chord.bass !== chord.root) s += "/" + DEGREES[(chord.bass - key.tonic + 12) % 12];
  return s;
}

// ---- Key of a song (same method as tools/progressions/key.py) ----

const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TRIAD_PCS = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], open: [0, 7] };

// chords: every chord of the song in order; starts: first chord of each section.
function guessKey(chords, starts) {
  const hist = new Array(12).fill(0);
  for (const c of chords) {
    for (const i of TRIAD_PCS[c.triad]) hist[(c.root + i) % 12] += 1;
    hist[c.root] += 1;
    if (c.bass !== c.root) hist[c.bass] += 0.5;
  }
  const isTonic = (c, t, minor) => c.root === t && (c.triad === "open" || c.triad === (minor ? "min" : "maj"));
  const share = (list, t, minor) => list.filter((c) => isTonic(c, t, minor)).length / list.length;
  let best = { tonic: 0, minor: false }, bestScore = -Infinity;
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const profile = minor ? PROFILE_MINOR : PROFILE_MAJOR;
      const score = correlation(hist, hist.map((_, i) => profile[(i - t + 12) % 12]))
        + 0.4 * share(chords, t, minor) + 0.4 * share(starts, t, minor)
        + 0.2 * (isTonic(chords[chords.length - 1], t, minor) ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = { tonic: t, minor }; }
    }
  }
  return best;
}

function correlation(a, b) {
  const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
  let num = 0, da = 0, db = 0;
  a.forEach((x, i) => { num += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// A key written on the sheet ("Am", "Bbm", "E") → { tonic, minor }.
function parseKey(text) {
  const m = /^([A-G])([#b]?)(m?)$/.exec((text || "").trim());
  if (!m) return null;
  return { tonic: (LETTER_PC[LETTERS.indexOf(m[1])] + ACC[m[2]] + 12) % 12, minor: m[3] === "m" };
}
