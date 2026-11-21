// Any chord by its name: its notes and their roles, where to play it on the guitar (the
// hand-written shape of shapes.js first, then shapes computed along the neck), and how
// to play it on a piano. Names are read by ../songbook/chordsym.js (parseSymbol).

// "Am7", "F#m7b5", "D/F#" → { root, bass, intervals, ... } or null.
function chordOf(name) {
  const c = parseSymbol(String(name || ""));
  if (!c) return null;
  // chordsym/theory don't alter the fifth for "7b5" / "7#5": do it here.
  if (/b5|-5/.test(c.quality) && !/^°/.test(c.quality)) c.intervals = c.intervals.map((i) => (i === 7 ? 6 : i));
  else if (/#5|\+5/.test(c.quality)) c.intervals = c.intervals.map((i) => (i === 7 ? 8 : i));
  return c;
}

const pcsKey = (c) => [...new Set(c.intervals.map((i) => (c.root + i) % 12))].sort((a, b) => a - b).join(",");
// Two names for the same chord ("A#m" and "Bbm", "AM7" and "Amaj7")?
const sameChord = (a, b) => a.root === b.root && a.bass === b.bass && pcsKey(a) === pcsKey(b);

// The hand-written shape for this chord, if there is one.
function handShape(chord) {
  return SHAPES.find((s) => { const c = chordOf(s.name); return c && sameChord(c, chord); }) || null;
}

// The role of a note in the chord, the way musicians name it: R, b3, 3, 5, b7, 9…
function roleOf(chord, pc) {
  const has = (i) => chord.intervals.some((x) => x % 12 === i);
  const d = (pc - chord.root + 12) % 12;
  const seventh = has(10) || has(11);
  switch (d) {
    case 0: return "R";
    case 1: return "b9";
    case 2: return has(3) || has(4) ? "9" : "2";
    case 3: return has(4) ? "#9" : "b3";
    case 4: return "3";
    case 5: return has(3) || has(4) ? "11" : "4";
    case 6: return has(7) ? "#11" : "b5";
    case 7: return "5";
    case 8: return has(7) ? "b13" : "#5";
    case 9: return seventh ? "13" : has(6) && has(3) ? "bb7" : "6";
    case 10: return "b7";
    default: return "7";
  }
}
const ROLE_WORDS = {
  R: "root", b3: "minor third", 3: "major third", 5: "fifth", b5: "flat fifth", "#5": "sharp fifth",
  b7: "minor seventh", 7: "major seventh", bb7: "diminished seventh", 2: "second", 4: "fourth",
  6: "sixth", 9: "ninth", b9: "flat ninth", "#9": "sharp ninth", 11: "eleventh", "#11": "sharp eleventh",
  13: "thirteenth", b13: "flat thirteenth",
};
// Note names spelled for the chord, from the letter of each role: E major has a G#, not
// an Ab; C diminished a Gb, not an F#. { pitch class: name } for the 12 notes.
const ROLE_STEP = { R: 0, b9: 1, 9: 1, 2: 1, "#9": 1, b3: 2, 3: 2, 4: 3, 11: 3, "#11": 3, b5: 4, 5: 4, "#5": 4, b13: 5, 6: 5, 13: 5, bb7: 6, b7: 6, 7: 6 };
function spellingOf(chord) {
  const rootName = (/^[A-G][#b]?/.exec(chord.text) || ["C"])[0];
  const names = {};
  for (let pc = 0; pc < 12; pc++) {
    const letter = (LETTERS.indexOf(rootName[0]) + ROLE_STEP[roleOf(chord, pc)]) % 7;
    const mark = { 0: "", 1: "#", 2: "##", 11: "b", 10: "bb" }[(pc - LETTER_PC[letter] + 12) % 12];
    names[pc] = mark === undefined ? PC_NAMES[pc] : LETTERS[letter] + mark;
  }
  return names;
}

// { pitch class: role } for the notes given.
function rolesFor(chord, pitches) {
  const roles = {};
  for (const p of pitches) roles[p % 12] = roleOf(chord, p % 12);
  return roles;
}

// ---- Guitar: shapes along the neck ----

// The best shape with the hand at fret `low` (4 frets: always playable), with the same
// rules and scores as ../progressions/guitar.js (scoreShape): bass note lowest, the
// important notes there, at most 4 fingers.
function shapeAt(chord, low) {
  const pcs = chord.intervals.map((i) => (chord.root + i) % 12);
  const fifth = (chord.root + 7) % 12;
  // Every note but the fifth (and, for big chords, maybe the tensions). Not the last resort
  // of guitar.js (root and bass only): along the neck, a full chord or nothing.
  const levels = [
    pcs.filter((pc) => pc !== fifth || pcs.length <= 3),
    pcs.filter((pc, k) => (pc !== fifth || pcs.length <= 3) && chord.intervals[k] < 12),
  ];
  const allowed = new Set(pcs.concat(chord.bass));
  const frets = low <= 2 ? [0, low, low + 1, low + 2, low + 3] : [low, low + 1, low + 2, low + 3];
  const options = TUNING.map((open) => [-1, ...frets.filter((f) => allowed.has((open + f) % 12))]);
  for (const req of levels) {
    const required = new Set(req);
    let best = null, bestScore = Infinity;
    const shape = new Array(6);
    const walk = (s) => {
      if (s === 6) {
        if (shape.filter((f) => f >= 0).length < 3) return; // at least 3 strings
        const score = scoreShape(shape, chord, required, null, low);
        if (score < bestScore) { bestScore = score; best = shape.slice(); }
        return;
      }
      for (const f of options[s]) {
        // Muted strings only below or above the strings played.
        if (f !== -1 && s > 0 && shape[s - 1] === -1 && shape.slice(0, s).some((x) => x !== -1)) continue;
        shape[s] = f;
        walk(s + 1);
      }
    };
    walk(0);
    if (best) return best;
  }
  return null;
}

// Every way to play it, low on the neck first: [{ frets, from: "hand" | "given" | "computed" }].
// `given`: a shape passed in (the Songbook's), shown first.
function positionsFor(chord, given) {
  const out = [];
  const add = (frets, from) => {
    if (frets && !out.some((o) => o.frets.join() === frets.join())) out.push({ frets, from });
  };
  if (given) add(given, "given");
  const hand = handShape(chord);
  if (hand) add(hand.frets, "hand");
  const computed = [];
  for (let low = 1; low <= 10; low++) {
    const f = shapeAt(chord, low);
    if (f && !computed.some((c) => c.join() === f.join())) computed.push(f);
  }
  const lowest = (f) => { const x = f.filter((v) => v > 0); return x.length ? Math.min(...x) : 0; };
  computed.sort((a, b) => lowest(a) - lowest(b)).slice(0, 6).forEach((f) => add(f, "computed"));
  return out;
}

// Pitches of a shape, low string first (null strings left out).
const shapePitches = (frets) => frets.map((f, s) => (f < 0 ? null : TUNING[s] + f)).filter((p) => p !== null);

// ---- Piano: the chord in root position around middle C, the bass note below if "/" ----
function pianoVoicing(chord) {
  const base = 48 + chord.root; // C3..B3
  const notes = chord.intervals.map((i) => base + i);
  if (chord.bass !== chord.root) notes.unshift(base - (((base - chord.bass) % 12) || 12)); // just under the chord
  return notes;
}
