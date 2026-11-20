// Ableton Push pads (8×8), "Chromatic" note layout in fourths, as on Push 1, 2 and 3:
// each pad to the right is one semitone up, each row up is a fourth (5 semitones).
// So a chord type always has the same shape, whatever the key: that's what we show.
//
// The grid starts on the tonic (bottom-left pad), like Push does. Pads of the key's scale
// are lit softly, the tonic stronger, the chord's pads in violet and its bass in blue.

const PUSH_ROW = 5; // semitones between rows

class PushView {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.state = "";
    this.base = 48;   // pitch of the bottom-left pad
    this.scale = [];  // pitch classes of the key's scale
    this.tonic = 0;
    this.chord = null; // { bass, notes }
    new ResizeObserver(() => this.draw(true)).observe(canvas);
  }

  // The key, and the chords of the progression: the grid stays put for the whole
  // progression, starting on the tonic an octave below the lowest chord note.
  setProgression(tonic, minor, voicings) {
    this.tonic = tonic;
    const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    this.scale = steps.map((s) => (tonic + s) % 12);
    const low = Math.min(...voicings.flatMap((v) => v.notes)) - 12;
    this.base = low - ((low - tonic) % 12 + 12) % 12;
    this.draw();
  }

  show(voicing) {
    this.chord = voicing;
    this.draw();
  }

  // The pads to light for a chord: each chord note can sit on several pads; take the
  // most compact group (smallest box), so it looks like the shape you'd play.
  shape(voicing) {
    const notes = [...new Set(voicing.notes)];
    const where = (p) => {
      const spots = [];
      for (let r = 0; r < 8; r++) {
        const c = p - this.base - r * PUSH_ROW;
        if (c >= 0 && c < 8) spots.push([r, c]);
      }
      return spots;
    };
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
        if ((this.base + r * PUSH_ROW + c) % 12 === bassPc) { bass = [r, c]; break; }
      }
    }
    return { pads: best || [], bass };
  }

  draw(force = false) {
    const key = JSON.stringify([this.chord, this.scale, this.base, this.canvas.clientWidth]);
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
        const pc = (this.base + r * PUSH_ROW + c) % 12;
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
