// Analyse a MIDI file (read by ../score/midi.js): find its key, cut it into chords, write
// them as roman numerals, in the same format as data.js, so they play like the others.
//
// 1. Chords. Cut the piece per bar (or per beat), weigh the notes sounding in each slice,
//    and try every chord (12 roots × a few qualities): the notes of the chord count for
//    it, the other notes against it, richer chords must earn their extra note, and a
//    root in the bass gets a bonus. The best one names the slice.
// 2. Key. Count how long each of the 12 pitch classes sounds in the whole piece (bass
//    notes count double: they weigh more in how we hear the key). Then compare this
//    profile with the Krumhansl-Kessler key profiles: in listening tests, people rated
//    how well each note "fits" after hearing a key, giving one profile for major and one
//    for minor. Turned to each of the 12 tonics, that's 24 candidate keys, each scored by
//    how well its profile correlates (Pearson correlation) with the piece: the
//    Krumhansl-Schmuckler algorithm. A major key and its relative minor (C major and
//    A minor) share their notes and score almost the same, so the chords break the tie:
//    a key gains points when its tonic chord is played a lot (and first, or last), and
//    when its dominant seventh (V7, which pulls to the tonic) is there.
// 3. Loop. Most songs repeat a few chords: find the group of 2 to 8 chords that covers
//    most of the piece, to keep as the progression.

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Chord qualities tried: notes above the root, and how they're written in a numeral
// (lower = the numeral is lower case).
const CHORD_TYPES = [
  { iv: [0, 4, 7], q: "", lower: false },
  { iv: [0, 3, 7], q: "", lower: true },
  { iv: [0, 3, 6], q: "°", lower: true },
  { iv: [0, 4, 7, 10], q: "7", lower: false },
  { iv: [0, 4, 7, 11], q: "maj7", lower: false },
  { iv: [0, 3, 7, 10], q: "7", lower: true },
  { iv: [0, 3, 6, 10], q: "7b5", lower: true },
  { iv: [0, 3, 6, 9], q: "°7", lower: true },
  { iv: [0, 5, 7], q: "sus4", lower: false },
  { iv: [0, 2, 7], q: "sus2", lower: false },
  { iv: [0, 7], q: "5", lower: false },
];

// Semitones above the tonic → how a numeral writes that degree (as in data.js).
const DEGREES = [["", 0], ["b", 1], ["", 1], ["b", 2], ["", 2], ["", 3], ["#", 3], ["", 4], ["b", 5], ["", 5], ["b", 6], ["", 6]];

function correlation(a, b) {
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Pitch-class profile + chords found ({ root, type, dur }) → { tonic, minor, score, alt },
// the best of the 24 keys; alt: the runner-up when it's nearly as good, else null.
function detectKey(profile, chords = []) {
  const total = chords.reduce((s, c) => s + c.dur, 0) || 1;
  const keys = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    // The profile seen from this tonic: rotated so index 0 is the tonic.
    const rotated = profile.map((_, i) => profile[(i + tonic) % 12]);
    for (const minor of [false, true]) {
      // Its tonic chord: minor (i, i7) or major (I, Imaj7); its dominant seventh: V7.
      const isTonic = (c) => c.root === tonic && c.type.lower === minor && (c.type.q === "" || c.type.q === (minor ? "7" : "maj7"));
      const isDominant = (c) => c.root === (tonic + 7) % 12 && !c.type.lower && c.type.q === "7";
      const share = (test) => chords.filter(test).reduce((s, c) => s + c.dur, 0) / total;
      let score = correlation(rotated, minor ? KK_MINOR : KK_MAJOR);
      score += 0.25 * share(isTonic) + 0.15 * share(isDominant);
      if (chords.length && isTonic(chords[0])) score += 0.05;
      if (chords.length && isTonic(chords[chords.length - 1])) score += 0.05;
      keys.push({ tonic, minor, score });
    }
  }
  keys.sort((a, b) => b.score - a.score);
  return { ...keys[0], alt: keys[0].score - keys[1].score < 0.08 ? keys[1] : null };
}

// The slices to name: [start, end] in seconds, one per bar or per beat.
function slices(song, per) {
  let bars = song.bars.length ? song.bars.slice() : [];
  const beat = 60 / (song.bpm || 120);
  if (!bars.length) for (let t = 0; t < song.duration; t += beat * 4) bars.push(t);
  bars.push(Math.max(song.duration, bars[bars.length - 1] + 0.01));
  const out = [];
  for (let i = 0; i + 1 < bars.length; i++) {
    const [a, b] = [bars[i], bars[i + 1]];
    if (per !== "beat") { out.push([a, b]); continue; }
    // Beats inside the bar: from the file's beats if it has them, else an even split.
    const inside = (song.beats || []).filter((t) => t >= a - 1e-6 && t < b - 1e-6);
    const marks = inside.length ? inside : Array.from({ length: beatsPerBar(song) }, (_, k) => a + ((b - a) * k) / beatsPerBar(song));
    marks.forEach((t, k) => out.push([t, k + 1 < marks.length ? marks[k + 1] : b]));
  }
  return out;
}

const beatsPerBar = (song) => Number(String(song.meter || "4/4").split("/")[0]) || 4;

// The notes heard in a slice: 12 weights (time sounding) and the bass pitch class.
function sliceNotes(song, a, b) {
  const w = new Array(12).fill(0);
  let bass = null, bassPitch = Infinity;
  const notes = song.notes;
  // Notes are sorted by start: skip those that ended long before (binary search).
  let lo = 0, hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].start < a - song.maxLength) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < notes.length; i++) {
    const n = notes[i];
    if (n.start >= b) break;
    const overlap = Math.min(n.end, b) - Math.max(n.start, a);
    if (overlap <= 0) continue;
    w[n.pitch % 12] += overlap * (0.5 + 0.5 * n.velocity);
    // The bass: the lowest note that lasts a good part of the slice.
    if (overlap >= (b - a) * 0.25 && n.pitch < bassPitch) { bassPitch = n.pitch; bass = n.pitch % 12; }
  }
  return { w, bass };
}

// Weights of a slice → the chord that explains them best: { root, type } or null.
function bestChord(w, bass) {
  const total = w.reduce((s, v) => s + v, 0);
  if (!total) return null;
  const share = w.map((v) => v / total);
  let best = null, bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    if (share[root] < 0.04) continue;
    for (const type of CHORD_TYPES) {
      const pcs = type.iv.map((i) => (root + i) % 12);
      let inside = 0;
      for (const pc of pcs) inside += share[pc];
      let score = inside - 0.6 * (1 - inside);
      score -= 0.1 * (pcs.length - 3);              // every extra note must be clearly there
      if (pcs.some((pc) => share[pc] < 0.03)) score -= 0.3; // a chord note barely heard
      if (bass === root) score += 0.08;
      if (type.q.startsWith("sus")) score -= 0.02; // a tie with a plain chord: the plain one
      if (score > bestScore) { bestScore = score; best = { root, type }; }
    }
  }
  return best;
}

// A chord in a key → its numeral, as in data.js: "bVImaj7", "ii7", "IV/5".
function numeralOf(chord, bass, tonic) {
  const [acc, step] = DEGREES[(chord.root - tonic + 12) % 12];
  const roman = ROMAN_DEGREES[step];
  let text = acc + (chord.type.lower ? roman.toLowerCase() : roman) + chord.type.q;
  // Another note in the bass: an inversion ("I/3"), or a chord over a held bass ("IV/5").
  if (bass !== null && bass !== chord.root) {
    const [bAcc, bStep] = DEGREES[(bass - tonic + 12) % 12];
    text += "/" + bAcc + (bStep + 1);
  }
  return text;
}

// The group of 2 to 8 chords that covers most of the sequence (repeats counted without
// overlapping). Null when nothing repeats enough.
function findLoop(seq) {
  let best = null;
  for (let len = 2; len <= 8 && len * 2 <= seq.length; len++) {
    const counts = new Map();
    for (let i = 0; i + len <= seq.length; i++) {
      const k = seq.slice(i, i + len).join(" ");
      if (counts.has(k)) continue;
      // Count the non-overlapping repeats of this group.
      let n = 0;
      for (let j = i; j + len <= seq.length; ) {
        if (seq.slice(j, j + len).join(" ") === k) { n++; j += len; } else j++;
      }
      counts.set(k, n);
      const cover = (n * len) / seq.length;
      if (n >= 2 && (!best || cover > best.cover + 1e-9)) best = { roman: seq.slice(i, i + len), repeats: n, cover };
    }
  }
  return best && best.cover >= 0.5 ? best : null;
}

// The whole analysis. per: "bar" or "beat".
function analyzeSong(song, per = "bar") {
  // 1. Chords, slice by slice (silent slices: the previous chord goes on).
  const found = [];
  for (const [a, b] of slices(song, per)) {
    const { w, bass } = sliceNotes(song, a, b);
    const chord = bestChord(w, bass);
    if (chord) found.push({ ...chord, bass, dur: b - a });
  }

  // 2. Key: time each pitch class sounds, bass notes (below C3) counting double.
  const profile = new Array(12).fill(0);
  for (const n of song.notes) profile[n.pitch % 12] += (n.end - n.start) * (n.pitch < 48 ? 2 : 1);
  const key = detectKey(profile, found);

  // The chords as numerals in that key; the same chord twice in a row is one chord.
  const seq = [];
  for (const c of found) {
    const numeral = numeralOf(c, c.bass, key.tonic);
    if (seq[seq.length - 1] !== numeral) seq.push(numeral);
  }

  // 3. The loop, if the piece repeats one.
  const loop = findLoop(seq);
  return { tonic: key.tonic, minor: key.minor, confidence: key.score, alt: key.alt, chords: seq, loop };
}
