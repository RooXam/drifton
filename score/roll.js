// The falling-notes view: a keyboard at the bottom, notes coming down towards it. A note
// reaches the keyboard when it must be played and keeps its key lit while it's held.
// Everything is redrawn on a <canvas> every frame from the song position (seconds).

// Colours in the same family as the site's violet. The first two are usually the right
// hand (violet) and the left hand (aubergine: darker, for the low notes).
const PART_COLORS = ["#8a7fff", "#5c2a8c", "#5ec4f2", "#f2b56d", "#7fdcc8", "#7fa0ff", "#f07ac0", "#ff9688"];
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);

class Roll {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.song = null;
    this.window = 4;        // seconds of song visible above the keyboard
    this.showNames = false; // note names on the notes and keys
    this.fullRange = false; // all 88 keys, instead of the song's range
    // The canvas follows its box size (it fills the space left on the page).
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    this.w = r.width;
    this.h = r.height;
    this.layout();
  }

  setSong(song) {
    this.song = song;
    this.layout();
  }

  // Which keys to show, and where each one is.
  layout() {
    let lo = 48, hi = 83; // 3 octaves from C3 by default
    if (this.fullRange) {
      lo = 21; hi = 108;
    } else if (this.song && this.song.notes.length) {
      lo = this.song.low - (this.song.low % 12);         // down to a C
      hi = this.song.high + 11 - (this.song.high % 12);  // up to a B
      while (hi - lo < 35) { lo -= 6; hi += 6; lo -= lo % 12; hi += 11 - (hi % 12); } // at least 3 octaves
    }
    this.lo = Math.max(21, lo);  // a piano goes from A0 (21)…
    this.hi = Math.min(108, hi); // …to C8 (108)

    let whites = 0;
    for (let p = this.lo; p <= this.hi; p++) if (!isBlack(p)) whites++;
    const ww = this.w / whites;
    this.keyX = [];
    this.keyW = [];
    let i = 0;
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlack(p)) {
        this.keyW[p] = ww * 0.6;
        this.keyX[p] = i * ww - this.keyW[p] / 2; // straddles two white keys
      } else {
        this.keyW[p] = ww;
        this.keyX[p] = i++ * ww;
      }
    }
    this.whiteW = ww;
    this.keyH = Math.min(Math.max(ww * 4.2, 60), 150, this.h * 0.3);
    this.rollH = this.h - this.keyH;
  }

  pxPerSecond() {
    return this.rollH / this.window;
  }

  noteName(p) {
    const names = this.song && this.song.flats ? FLAT_NAMES : SHARP_NAMES;
    return names[p % 12];
  }

  draw(pos, loop) {
    const { g, w, h, rollH, song } = this;
    const pps = this.pxPerSecond();
    const yOf = (t) => rollH - (t - pos) * pps; // song time → height on screen

    // Background: slightly lighter towards the keyboard.
    if (!this.bg || this.bgH !== h) {
      this.bg = g.createLinearGradient(0, 0, 0, rollH);
      this.bg.addColorStop(0, "#07070b");
      this.bg.addColorStop(1, "#13111f");
      this.bgH = h;
    }
    g.fillStyle = this.bg;
    g.fillRect(0, 0, w, h);

    // Lanes: black-key lanes barely lighter, a faint line on each C.
    g.fillStyle = "rgba(255, 255, 255, 0.025)";
    for (let p = this.lo; p <= this.hi; p++) if (isBlack(p)) g.fillRect(this.keyX[p], 0, this.keyW[p], rollH);
    g.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let p = this.lo; p <= this.hi; p++) if (p % 12 === 0) g.fillRect(Math.round(this.keyX[p]), 0, 1, rollH);

    const active = new Map(); // keys lit now: pitch → colours
    if (song) {
      // Bar lines and numbers
      g.font = "11px -apple-system, sans-serif";
      g.textAlign = "left";
      song.bars.forEach((t, i) => {
        const y = yOf(t);
        if (y < -2 || y > rollH) return;
        g.fillStyle = "rgba(255, 255, 255, 0.07)";
        g.fillRect(0, Math.round(y), w, 1);
        g.fillStyle = "#5d5a73";
        g.fillText(String(i + 1), 5, y - 4);
      });

      // Loop: dim what's outside, mark both ends.
      if (loop.on) {
        const ya = yOf(loop.a), yb = yOf(loop.b);
        g.fillStyle = "rgba(7, 7, 11, 0.65)";
        if (yb > 0) g.fillRect(0, 0, w, Math.min(yb, rollH));
        if (ya < rollH) g.fillRect(0, Math.max(0, ya), w, rollH - Math.max(0, ya));
        g.fillStyle = "rgba(138, 127, 255, 0.8)";
        for (const y of [ya, yb]) if (y >= 0 && y <= rollH) g.fillRect(0, Math.round(y) - 1, w, 2);
      }

      // Notes. They are sorted by start: begin with the first one that can still be visible.
      const notes = song.notes;
      let i = lowerBound(notes, pos - song.maxLength);
      g.textAlign = "center";
      g.font = `600 ${Math.min(12, Math.max(9, this.whiteW * 0.4))}px -apple-system, sans-serif`;
      for (; i < notes.length; i++) {
        const n = notes[i];
        if (n.start > pos + this.window) break;
        if (n.end < pos || !song.parts[n.part].visible) continue;
        const x = this.keyX[n.pitch];
        if (x === undefined) continue;
        const c = partColors(n.part);
        const black = isBlack(n.pitch);
        const playing = n.start <= pos && n.end > pos;
        const top = yOf(n.end), bottom = yOf(n.start);
        const kw = this.keyW[n.pitch];
        const nh = Math.max(4, bottom - top);
        const r = Math.min(5, kw / 3, nh / 2);

        // A gentle gradient, brighter at the leading (bottom) edge; a glow while it's held.
        const grad = g.createLinearGradient(0, top, 0, top + nh);
        if (playing) {
          grad.addColorStop(0, c.base);
          grad.addColorStop(1, c.light);
          g.shadowColor = c.base;
          g.shadowBlur = 20;
        } else {
          grad.addColorStop(0, black ? c.deep : c.dark);
          grad.addColorStop(1, black ? c.dark : c.base);
        }
        g.fillStyle = grad;
        roundRect(g, x + 1.5, top, kw - 3, nh, r);
        g.shadowBlur = 0;
        // Thin highlight along the top edge
        if (nh > 8) {
          g.fillStyle = "rgba(255, 255, 255, 0.22)";
          g.fillRect(x + 1.5 + r, top + 1, kw - 3 - 2 * r, 1);
        }
        if (this.showNames && kw >= 12 && nh >= 16) {
          g.fillStyle = c.text;
          g.fillText(this.noteName(n.pitch), x + kw / 2, Math.min(bottom, rollH) - 6);
        }
        if (playing) active.set(n.pitch, c);
      }
    }

    // "Now" line: a soft light rising from the keyboard.
    const glow = g.createLinearGradient(0, rollH - 36, 0, rollH);
    glow.addColorStop(0, "rgba(138, 127, 255, 0)");
    glow.addColorStop(1, "rgba(138, 127, 255, 0.18)");
    g.fillStyle = glow;
    g.fillRect(0, rollH - 36, w, 36);

    // Each key being played lights up the space just above it.
    g.globalCompositeOperation = "lighter";
    for (const [p, c] of active) {
      const cx = this.keyX[p] + this.keyW[p] / 2, rad = this.whiteW * 1.8;
      const halo = g.createRadialGradient(cx, rollH, 0, cx, rollH, rad);
      halo.addColorStop(0, c.glow);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = halo;
      g.fillRect(cx - rad, rollH - rad, rad * 2, rad);
    }
    g.globalCompositeOperation = "source-over";

    this.drawKeyboard(active);
  }

  drawKeyboard(active) {
    const { g, w, rollH, keyH } = this;
    const felt = 4;                  // a thin strip above the keys, like the felt on a piano
    const top = rollH + felt;
    const kh = keyH - felt;
    const blackH = kh * 0.62;
    if (!this.keyGrad || this.keyGradTop !== top) {
      this.keyGrad = g.createLinearGradient(0, top, 0, top + kh);
      this.keyGrad.addColorStop(0, "#d9d6e4");
      this.keyGrad.addColorStop(0.08, "#f2f0f8");
      this.keyGrad.addColorStop(1, "#dcd9e8");
      this.blackGrad = g.createLinearGradient(0, top, 0, top + blackH);
      this.blackGrad.addColorStop(0, "#1a1824");
      this.blackGrad.addColorStop(0.85, "#2c293b");
      this.blackGrad.addColorStop(1, "#3a3650");
      this.keyGradTop = top;
    }
    const activeGrad = (c, height) => {
      const gr = g.createLinearGradient(0, top, 0, top + height);
      gr.addColorStop(0, c.base);
      gr.addColorStop(1, c.light);
      return gr;
    };

    g.fillStyle = "#07070b";
    g.fillRect(0, rollH, w, keyH);
    g.fillStyle = "#8a7fff";
    g.fillRect(0, rollH, w, 2);
    g.fillStyle = "#2a2640";
    g.fillRect(0, rollH + 2, w, felt - 2);

    g.textAlign = "center";
    g.font = `${Math.min(12, Math.max(8, this.whiteW * 0.4))}px -apple-system, sans-serif`;
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlack(p)) continue;
      const x = this.keyX[p], kw = this.keyW[p];
      const c = active.get(p);
      g.fillStyle = c ? activeGrad(c, kh) : this.keyGrad;
      roundRect(g, x + 0.5, top, kw - 1, kh, [0, 0, 4, 4]);
      // Label every C (with its octave: C4 = middle C), or every key with names on.
      if (p % 12 === 0 || (this.showNames && kw >= 14)) {
        g.fillStyle = c ? c.text : "#8a879c";
        const label = p % 12 === 0 ? `C${Math.floor(p / 12) - 1}` : this.noteName(p);
        g.fillText(label, x + kw / 2, top + kh - 7);
      }
    }
    // Black keys, with a small shadow on the white keys below.
    for (let p = this.lo; p <= this.hi; p++) {
      if (!isBlack(p)) continue;
      const c = active.get(p);
      g.shadowColor = "rgba(0, 0, 0, 0.45)";
      g.shadowBlur = 4;
      g.shadowOffsetY = 2;
      g.fillStyle = c ? activeGrad(c, blackH) : this.blackGrad;
      roundRect(g, this.keyX[p], top, this.keyW[p], blackH, [0, 0, 3, 3]);
      g.shadowColor = "transparent";
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
    }
  }
}

// Colour variants of each part, computed once: base, lighter, darker, glow.
const colorCache = [];
function partColors(i) {
  const k = i % PART_COLORS.length;
  if (!colorCache[k]) {
    const hex = PART_COLORS[k];
    const rgb = [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16));
    const mix = (to, amt) => `rgb(${rgb.map((v) => Math.round(v + (to - v) * amt)).join(",")})`;
    colorCache[k] = {
      base: hex,
      light: mix(255, 0.45),
      dark: mix(0, 0.25),
      deep: mix(0, 0.5),
      glow: `rgba(${rgb.join(",")}, 0.55)`,
      // Note names: dark text on light colours, light text on dark ones.
      text: 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 140 ? "rgba(10, 10, 15, 0.8)" : "rgba(255, 255, 255, 0.9)",
    };
  }
  return colorCache[k];
}

function lowerBound(notes, t) {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  g.fill();
}
