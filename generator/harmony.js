// Harmony: scales (modes), the chords they contain, and how to move between chords.
//
// A mode is a list of 7 notes, as semitones above the root. D dorian = D E F G A B C.
// Chords are built by stacking every other note of the scale ("thirds"): from degree 0
// of D dorian we get D F A C E = Dm7 plus a 9th. Every chord built this way belongs to
// the mode, so nothing ever sounds "wrong", which is what we want for functional music.

const MODES = {
  ionian:     [0, 2, 4, 5, 7, 9, 11], // major: bright
  lydian:     [0, 2, 4, 6, 7, 9, 11], // major with a raised 4th: floating, dreamy
  mixolydian: [0, 2, 4, 5, 7, 9, 10], // major with a flat 7th: warm
  dorian:     [0, 2, 3, 5, 7, 9, 10], // minor with a raised 6th: soft, not sad
  aeolian:    [0, 2, 3, 5, 7, 8, 10], // natural minor: melancholic
  phrygian:   [0, 1, 3, 5, 7, 8, 10], // minor with a flat 2nd: dark
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

// How likely a move is, by how many scale steps the root moves up.
// 3 steps up (= a fourth) is the strongest, most "natural" move in tonal music;
// moves by a third (2 or 5) are soft and very common in ambient; steps (1, 6) rarer.
const MOVE_WEIGHTS = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 2, 6: 1 };

class Harmony {
  constructor(root, mode) {
    this.setKey(root, mode);
  }

  setKey(root, mode) {
    this.root = root; // pitch class: 0 = C, 2 = D …
    this.mode = mode;
    this.scale = MODES[mode];
    this.style = this.style || "sevenths";
  }

  // "sevenths": chords stacked in thirds (root, 3rd, 5th, 7th, 9th), lush and jazzy.
  // "sus": root, 5th, 2nd and 6th, no third: open, neither happy nor sad, the hazy
  // sound of hazy 90s electronica (sus2 chords with an added sixth).
  // "drone": root and fifth (plus the 2nd for melodies to lean on), held for a long
  // time: the chord barely moves, and only to its neighbours a fourth or fifth away.
  setStyle(style) {
    this.style = style;
  }

  // Pitch class (0–11) of scale degree d (d can go beyond 7: degree 8 = degree 1).
  pc(d) {
    return (this.root + this.scale[mod(d, 7)]) % 12;
  }

  // Semitones between degree d and degree d + k.
  interval(d, k) {
    return mod(this.pc(d + k) - this.pc(d), 12);
  }

  // Pitch classes of the chord on degree d: root, 3rd, 5th, 7th, 9th.
  chordTones(d) {
    const steps = { sus: [0, 4, 1, 5], drone: [0, 4, 1] }[this.style] || [0, 2, 4, 6, 8];
    return steps.map((k) => this.pc(d + k));
  }

  // We skip the diminished chord (no perfect fifth): too tense for this music.
  usable(d) {
    return this.interval(d, 4) === 7;
  }

  chordName(d) {
    if (this.style === "drone") return { name: NOTE_NAMES[this.pc(d)] + "5", roman: ROMAN[mod(d, 7)] + "5" };
    if (this.style === "sus") {
      // C6sus2 (C D G A); with a minor sixth, Csus2(b6).
      const name = NOTE_NAMES[this.pc(d)] + (this.interval(d, 5) === 9 ? "6sus2" : "sus2(b6)");
      return { name, roman: ROMAN[mod(d, 7)] + "sus2" };
    }
    const minor = this.interval(d, 2) === 3;
    const seventh = this.interval(d, 6);
    const quality = minor ? (seventh === 10 ? "m7" : "m(maj7)") : seventh === 11 ? "maj7" : "7";
    const roman = minor ? ROMAN[mod(d, 7)].toLowerCase() : ROMAN[mod(d, 7)];
    return { name: NOTE_NAMES[this.pc(d)] + quality, roman };
  }

  // Pick the next chord: a weighted random choice (a "Markov chain": the next state
  // depends only on the current one). Coming back home (degree 0) gets a bonus.
  nextDegree(from) {
    if (this.style === "drone") {
      // Mostly stay home; now and then lean to the fourth or the fifth, then come back.
      if (from !== 0) return 0;
      if (Math.random() < 0.7) return 0;
      return [3, 4].filter((d) => this.usable(d))[Math.random() < 0.5 ? 0 : 1] ?? 0;
    }
    const options = [];
    for (let d = 0; d < 7; d++) {
      if (d === from || !this.usable(d)) continue;
      let w = MOVE_WEIGHTS[mod(d - from, 7)];
      if (d === 0) w += 1.5;
      options.push([d, w]);
    }
    return weightedPick(options);
  }
}

// ---- Small helpers ----

function mod(a, n) {
  return ((a % n) + n) % n;
}

// options: [[value, weight], …] → one value, chosen with probability ∝ weight.
function weightedPick(options) {
  const total = options.reduce((s, o) => s + o[1], 0);
  let r = Math.random() * total;
  for (const [value, w] of options) {
    r -= w;
    if (r <= 0) return value;
  }
  return options[options.length - 1][0];
}

// Lowest MIDI note with pitch class pc at or above `lo`.
function pitchFrom(pc, lo) {
  let m = lo;
  while (mod(m, 12) !== pc) m++;
  return m;
}

// Voice leading: move from the previous chord to the new one with the smallest moves.
// Each previous note goes to the nearest free note of the new chord; notes shared by
// both chords stay where they are. That is what makes chord changes smooth instead of
// jumping around.
function voiceLead(prev, tones, lo, hi, count) {
  if (prev.length === 0) {
    // First chord: an open voicing, root at the bottom then 5th, 7th, 3rd going up.
    const order = [tones[0], tones[2], tones[3], tones[1]].slice(0, count);
    const out = [];
    let floor = lo;
    for (const pc of order) {
      const m = pitchFrom(pc, floor);
      out.push(m);
      floor = m + 1;
    }
    return out;
  }

  const candidates = [];
  for (let m = lo; m <= hi; m++) if (tones.includes(mod(m, 12))) candidates.push(m);

  const out = [];
  const usedPc = new Set();
  for (const p of [...prev].sort((a, b) => a - b)) {
    let best = null;
    for (const c of candidates) {
      if (out.includes(c) || usedPc.has(mod(c, 12))) continue;
      const better = best === null || Math.abs(c - p) < Math.abs(best - p);
      const tie = best !== null && Math.abs(c - p) === Math.abs(best - p) && Math.random() < 0.5;
      if (better || tie) best = c;
    }
    // No new pitch class left (a chord of 3 notes for 4 voices): double one, nearby.
    if (best === null) {
      for (const c of candidates) if (!out.includes(c) && (best === null || Math.abs(c - p) < Math.abs(best - p))) best = c;
    }
    out.push(best);
    usedPc.add(mod(best, 12));
  }
  return out.sort((a, b) => a - b);
}
