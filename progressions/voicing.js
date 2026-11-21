// Voicings: which notes of each chord the right hand plays, and where.
//
// - close: all the chord notes packed together, each chord as near as possible to the
//   previous one (smooth voice leading). The default.
// - open:  the same, with every other note raised an octave: wide and airy (1-5-3-7).
// - drop2: the close voicing with its second note from the top dropped an octave, the
//   classic jazz guitar / piano spread.
// - shell: rootless, the bass already plays the root: the third and the seventh (the
//   notes that say what the chord is), plus its tensions (9, 11, 13).
// Every voicing is worked out from a close one placed in its own range, so the voice
// leading stays smooth whatever the style.

const VOICINGS = {
  close: { label: "Close", low: 52, high: 76 },
  open: { label: "Open", low: 48, high: 67 },
  drop2: { label: "Drop 2", low: 60, high: 84 },
  shell: { label: "Shell", low: 50, high: 72 },
};

// The pitch classes the right hand plays, for a style.
function voicingPcs(chord, style) {
  const all = [...new Set(chord.intervals.map((i) => (chord.root + i) % 12))];
  if (style !== "shell") return all;
  const has = (i) => chord.intervals.includes(i);
  const third = [4, 3, 5, 2].find(has);    // the third, or the sus note
  const seventh = [10, 11, 9].find(has);   // 7, maj7, 6 (or °7)
  const tensions = chord.intervals.filter((i) => i > 12);
  const keep = [third, seventh !== undefined ? seventh : 7, ...tensions].filter((i) => i !== undefined);
  // A slash chord: the bass isn't the root, so the hand keeps it.
  if (chord.bass !== chord.root) keep.push(0);
  const pcs = [...new Set(keep.map((i) => (chord.root + i) % 12))];
  return pcs.length >= 2 ? pcs : all;
}

// Close notes → the notes of the style.
function spreadVoicing(notes, style) {
  const n = notes.slice().sort((a, b) => a - b);
  if (style === "open") return n.map((p, i) => (i % 2 ? p + 12 : p)).sort((a, b) => a - b);
  if (style === "drop2" && n.length >= 3) {
    n[n.length - 2] -= 12;
    return n.sort((a, b) => a - b);
  }
  return n;
}

// One { bass, notes } per chord. Twice round the loop, keeping the second round: the last
// chord then also leads smoothly into the first.
function voiceProgression(chords, style = "close") {
  const v = VOICINGS[style] || VOICINGS.close;
  let prev = null;
  const out = [];
  for (let round = 0; round < 2; round++) {
    chords.forEach((c, i) => {
      const pcs = voicingPcs(c, style);
      const mid = (v.low + v.high) / 2;
      const target = prev || [mid - 4, mid, mid + 3];
      const close = placeClosest(pcs, target, v.low, v.high) || pcs.map((pc) => 60 + pc);
      prev = close;
      out[i] = { bass: bassNote(c), notes: spreadVoicing(close, style) };
    });
  }
  return out;
}
