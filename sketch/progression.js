// Chord progressions in and out of a sketch, as roman numerals (I, vi, bVII, IVmaj7…),
// read and voiced by ../progressions/theory.js (parseNumeral, makeChord, voiceChord).
//
// - In: "?prog=i-bVI-bIII-bVII&tonic=9" (a link from the Progressions page) becomes a
//   scene: pad chords (one per bar, voice-led), a bass on the roots and a simple beat.
// - Out: a melodic clip is reduced to one chord per bar and written as numerals, to be
//   played by Focus music.

const Progression = {
  // Numerals → chords with notes: [{ name, root, notes: [pitches], bass: pitch }].
  voice(numerals, tonic) {
    const out = [];
    let prev = null;
    for (const text of numerals) {
      const c = makeChord(text, tonic);
      if (!c) continue;
      const v = voiceChord(c, prev);
      prev = v.notes;
      out.push({ name: c.name, root: c.root, notes: v.notes, bass: v.bass });
    }
    return out;
  },

  // Chords → the bars they fill: up to 4 chords, one per bar (3 chords: the last one
  // twice); 5 to 8 chords, two per bar. Returns { bars, slots: [{ chord, s, l }] }.
  layout(chords) {
    const list = chords.slice(0, 8);
    if (list.length > 4) {
      const half = STEPS_PER_BAR / 2;
      return { bars: 4, slots: list.map((chord, i) => ({ chord, s: i * half, l: half })) };
    }
    const bars = list.length <= 1 ? 1 : list.length === 2 ? 2 : 4;
    const slots = list.map((chord, i) => ({ chord, s: i * STEPS_PER_BAR, l: STEPS_PER_BAR }));
    if (list.length === 3) slots[2].l = 2 * STEPS_PER_BAR;
    return { bars, slots };
  },

  // A pad clip holding the chords.
  padClip(chords, name = "Chords") {
    const { bars, slots } = this.layout(chords);
    const clip = newClip(bars, name);
    for (const { chord, s, l } of slots) for (const p of chord.notes) clip.notes.push({ p, s, l, v: 0.62 });
    return clip;
  },

  // A bass on the roots: the root held, a short repeat before the next chord.
  bassClip(chords, name = "Roots") {
    const { bars, slots } = this.layout(chords);
    const clip = newClip(bars, name);
    for (const { chord, s, l } of slots) {
      clip.notes.push({ p: chord.bass, s, l: l - 3, v: 0.8 });
      clip.notes.push({ p: chord.bass, s: s + l - 2, l: 2, v: 0.55 });
    }
    return clip;
  },

  // A simple, quiet beat: kick, snare on 2 and 4, eighth-note hats.
  beatClip(name = "Beat") {
    const clip = newClip(1, name);
    const hit = (p, s, v) => clip.notes.push({ p, s, l: 1, v });
    [0, 10].forEach((s) => hit(36, s, 0.9));
    [4, 12].forEach((s) => hit(38, s, 0.7));
    for (let s = 0; s < 16; s += 2) hit(42, s, s % 4 ? 0.55 : 0.35);
    return clip;
  },

  // ---- Out: a clip → numerals ----

  // Chord shapes we recognize, with how they are written as numerals.
  SHAPES: [
    { iv: [0, 4, 7], lower: false, q: "" },
    { iv: [0, 3, 7], lower: true, q: "" },
    { iv: [0, 4, 7, 10], lower: false, q: "7" },
    { iv: [0, 4, 7, 11], lower: false, q: "maj7" },
    { iv: [0, 3, 7, 10], lower: true, q: "7" },
    { iv: [0, 3, 6], lower: true, q: "°" },
    { iv: [0, 5, 7], lower: false, q: "sus4" },
    { iv: [0, 2, 7], lower: false, q: "sus2" },
  ],
  ROMAN: ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"],

  // One numeral per bar of the clip. Each bar: how long each pitch class sounds in it
  // (louder and lower notes count more), then the chord shape that best explains it.
  // Empty bars repeat the previous chord. Null if the clip has no notes.
  fromClip(clip, key) {
    if (!clip.notes.length) return null;
    const out = [];
    for (let bar = 0; bar < clip.bars; bar++) {
      const a = bar * STEPS_PER_BAR, b = a + STEPS_PER_BAR;
      const weight = Array(12).fill(0);
      let low = null;
      for (const n of clip.notes) {
        const overlap = Math.min(b, n.s + n.l) - Math.max(a, n.s);
        if (overlap <= 0) continue;
        weight[n.p % 12] += overlap * (0.5 + n.v);
        if (low === null || n.p < low) low = n.p;
      }
      if (low === null) { if (out.length) out.push(out[out.length - 1]); continue; }
      out.push(this.bestNumeral(weight, low % 12, key));
    }
    // A clip whose first bars are empty: they take the first chord found.
    while (out.length < clip.bars) out.unshift(out[0]);
    return out;
  },

  bestNumeral(weight, bassPc, key) {
    const total = weight.reduce((x, y) => x + y, 0);
    let best = null, bestScore = -Infinity;
    for (let root = 0; root < 12; root++) {
      for (const shape of this.SHAPES) {
        const pcs = shape.iv.map((i) => (root + i) % 12);
        const covered = pcs.reduce((sum, pc) => sum + weight[pc], 0);
        const missing = pcs.filter((pc) => weight[pc] === 0).length;
        // Explained sound, minus what is left out, minus tones the chord adds for nothing;
        // a small bonus when the lowest note is the root, a small cost for bigger chords.
        const score = covered - 0.8 * (total - covered) - missing * 0.35 * (total / 3)
          + (root === bassPc ? total * 0.12 : 0) - pcs.length * 0.01;
        if (score > bestScore) { bestScore = score; best = { root, shape }; }
      }
    }
    const roman = this.ROMAN[(best.root - key + 12) % 12];
    const body = best.shape.lower ? roman.replace(/[IV]+/, (r) => r.toLowerCase()) : roman;
    return body + best.shape.q;
  },
};
