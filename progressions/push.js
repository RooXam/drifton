// Ableton Push pads (8×8), in one of its two note layouts (Push 1, 2 and 3):
// - "chromatic": each pad to the right is one semitone up, each row up is a fourth
//   (5 semitones). A chord type always has the same shape, whatever the key.
// - "inkey": only the notes of the scale. Each pad to the right is the next note of the
//   scale, each row up is three scale steps higher (a fourth again). No wrong notes, but
//   a chord borrowed from outside the scale can't be played whole.
//
// The grid starts on the tonic (bottom-left pad), like Push does. Pads of the key's scale
// are lit softly, the tonic stronger, the chord's pads in violet and its bass in blue.

const PUSH_ROW = 5; // semitones between rows (chromatic layout)

class PushView {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.state = "";
    this.base = 48;   // pitch of the bottom-left pad
    this.scale = [];  // pitch classes of the key's scale
    this.tonic = 0;
    this.chord = null; // { bass, notes }
    this.layout = "chromatic";
    this.steps = [0, 2, 4, 5, 7, 9, 11]; // the scale, in semitones above the tonic
    this.missing = []; // chord notes (pitch classes) the "inkey" grid doesn't have
    new ResizeObserver(() => this.draw(true)).observe(canvas);
  }

  // The key, and the chords of the progression: the grid stays put for the whole
  // progression, starting on the tonic an octave below the lowest chord note.
  setProgression(tonic, minor, voicings) {
    this.tonic = tonic;
    this.steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    this.scale = this.steps.map((s) => (tonic + s) % 12);
    const low = Math.min(...voicings.flatMap((v) => v.notes)) - 12;
    this.base = low - ((low - tonic) % 12 + 12) % 12;
    this.draw();
  }

  setLayout(layout) {
    this.layout = layout;
    this.draw();
  }

  // The note of the pad on row r (0 = bottom), column c (0 = left).
  pitchAt(r, c) {
    if (this.layout !== "inkey") return this.base + r * PUSH_ROW + c;
    const d = r * 3 + c; // scale steps above the tonic
    return this.base + 12 * Math.floor(d / 7) + this.steps[d % 7];
  }

  show(voicing) {
    this.chord = voicing;
    this.draw();
  }

  // The pads to light for a chord: each chord note can sit on several pads; take the
  // most compact group (smallest box), so it looks like the shape you'd play.
  shape(voicing) {
    const where = (p) => {
      const spots = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (this.pitchAt(r, c) === p) spots.push([r, c]);
      return spots;
    };
    // Notes with no pad (outside the scale, in the "inkey" layout) are left out.
    const all = [...new Set(voicing.notes)];
    const notes = all.filter((p) => where(p).length);
    this.missing = [...new Set(all.filter((p) => !where(p).length).map((p) => p % 12))];
    let best = null, bestSize = Infinity;
    const pick = (i, chosen) => {
      if (i === notes.length) {
        const rs = chosen.map((x) => x[0]), cs = chosen.map((x) => x[1]);
        const size = (Math.max(...rs) - Math.min(...rs) + 1) * (Math.max(...cs) - Math.min(...cs) + 1);
        if (size < bestSize) { bestSize = size; best = chosen.slice(); }
        return;
      }
      for (const s of where(notes[i])) pick(i + 1, chosen.concat([s]));
    };
    pick(0, []);
    // The bass: its pitch class on the lowest pad below the shape.
    const bassPc = ((voicing.bass % 12) + 12) % 12;
    let bass = null;
    for (let r = 0; r < 8 && !bass; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.pitchAt(r, c) % 12 === bassPc) { bass = [r, c]; break; }
      }
    }
    return { pads: best || [], bass };
  }

  draw(force = false) {
    const key = JSON.stringify([this.chord, this.scale, this.base, this.layout, this.canvas.clientWidth]);
    if (!force && key === this.state) return;
    this.state = key;
    const { canvas, g } = this;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim();
    const bassColor = css.getPropertyValue("--c-bass").trim();

    const lit = this.chord ? this.shape(this.chord) : { pads: [], bass: null };
    const isLit = (r, c) => lit.pads.some(([a, b]) => a === r && b === c);
    const isBass = (r, c) => lit.bass && lit.bass[0] === r && lit.bass[1] === c;

    const size = Math.min(H / 8, W / 8);
    const gap = size * 0.14;
    const x0 = (W - size * 8) / 2;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const pc = this.pitchAt(r, c) % 12;
        let color = "#1b1a26";                   // out of the scale: dark
        if (this.scale.includes(pc)) color = "#34304a"; // in the scale: soft
        if (pc === this.tonic) color = "#4b4470";       // tonic: stronger
        if (isLit(r, c)) color = accent;
        if (isBass(r, c)) color = bassColor;
        g.fillStyle = color;
        const x = x0 + c * size + gap / 2;
        const y = H - (r + 1) * size + gap / 2; // row 0 at the bottom, like on the hardware
        g.beginPath();
        g.roundRect ? g.roundRect(x, y, size - gap, size - gap, 4 * dpr) : g.rect(x, y, size - gap, size - gap);
        g.fill();
      }
    }
  }
}
