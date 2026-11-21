// A big chord chart you can play: touch a string to pluck it, slide across the strings to
// strum. Strings are vertical (low E on the left), frets go down, like a chord chart.
// What is shown depends on the hints: the dots, the open string names, the note names,
// the root. In "place" mode (onPlace set) touching puts a finger on a fret instead, and
// the check shows ✓ / ✗ under each string and the right shape in rings (ghost).

const STRING_NAMES = ["E", "A", "D", "G", "B", "E"];
const OPEN_PITCHES = [40, 45, 50, 55, 59, 64];
const PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

class Neck {
  constructor(canvas, onString) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.onString = onString; // (string index) → play it
    this.frets = [0, 0, 0, 0, 0, 0];
    // root: pitch class; roles: { pitch class: "R" | "b3" | "5"… } once the answer is shown
    this.show = { dots: true, strings: false, notes: false, root: null, roles: null };
    this.glow = new Array(6).fill(-1e9); // when each string was last plucked (ms)
    this.lastString = -1;
    this.rows = 5;          // frets shown
    this.firstFret = null;  // fixed first fret (placing fingers), or null = follow the shape
    this.onPlace = null;    // set: touching places a finger instead of plucking (s, fret | "nut")

    canvas.addEventListener("pointerdown", (e) => {
      if (this.onPlace) return this.place(e);
      canvas.setPointerCapture(e.pointerId);
      this.lastString = -1;
      this.touch(e);
    });
    canvas.addEventListener("pointermove", (e) => { if (!this.onPlace && (e.buttons || e.pointerType === "touch")) this.touch(e); });
    canvas.addEventListener("pointerup", () => (this.lastString = -1));
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set(frets, show) {
    this.frets = frets;
    this.show = { ...this.show, ...show };
    this.draw();
  }

  // Which string is under the finger? Crossing into a new one plucks it: that's a strum.
  touch(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const { left, gap } = this.layout(r.width);
    const s = Math.round((x - left) / gap);
    if (s < 0 || s > 5 || Math.abs(x - (left + s * gap)) > gap * 0.45) return;
    if (s === this.lastString) return;
    // Moving fast can skip a string: play the ones in between too.
    if (this.lastString >= 0) {
      const step = s > this.lastString ? 1 : -1;
      for (let k = this.lastString + step; k !== s; k += step) this.pluck(k);
    }
    this.pluck(s);
    this.lastString = s;
  }

  // Placing fingers: which string, which fret (or above the nut: open / not played)?
  place(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const { left, gap } = this.layout(r.width);
    const s = Math.round((x - left) / gap);
    if (s < 0 || s > 5 || Math.abs(x - (left + s * gap)) > gap * 0.5) return;
    const { top, fretH, first } = this.grid;
    if (y < top) return this.onPlace(s, "nut");
    const f = first + Math.floor((y - top) / fretH);
    if (f >= first && f < first + this.rows) this.onPlace(s, f);
  }

  pluck(s) {
    this.glow[s] = performance.now();
    this.onString(s);
    this.animate();
  }

  animate() {
    if (this.raf) return;
    const loop = () => {
      this.draw();
      const busy = this.glow.some((t) => performance.now() - t < 600);
      this.raf = busy ? requestAnimationFrame(loop) : null;
    };
    this.raf = requestAnimationFrame(loop);
  }

  layout(w) {
    const left = Math.max(40, w * 0.16), right = w - left;
    return { left, gap: (right - left) / 5 };
  }

  pitch(s) {
    return this.frets[s] < 0 ? null : OPEN_PITCHES[s] + this.frets[s];
  }

  draw() {
    const { canvas, g } = this;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // hidden (another tab): drawn when it shows again
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim();
    const rootColor = css.getPropertyValue("--c-bass").trim();
    const fg = css.getPropertyValue("--fg").trim();
    const muted = css.getPropertyValue("--muted").trim();

    const { left, gap } = this.layout(w);
    const top = 46, bottom = h - (this.show.roles ? 58 : this.show.strings || this.show.marks ? 40 : 18);
    const rows = this.rows;
    const fretH = (bottom - top) / rows;
    const fretted = this.frets.filter((f) => f > 0);
    const first = this.firstFret || (fretted.length && Math.max(...fretted) > rows ? Math.min(...fretted) : 1);
    this.grid = { top, fretH, first };
    const sx = (s) => left + s * gap;
    const fy = (f) => top + (f - first + 0.5) * fretH; // middle of fret f

    // Frets (horizontal) and the nut, or the number of the first fret shown.
    g.strokeStyle = "#4a4760";
    g.lineWidth = 1.5;
    for (let k = 0; k <= rows; k++) {
      g.beginPath(); g.moveTo(sx(0), top + k * fretH); g.lineTo(sx(5), top + k * fretH); g.stroke();
    }
    if (first === 1) {
      g.fillStyle = "#c9c6d6";
      g.fillRect(sx(0) - 2, top - 5, sx(5) - sx(0) + 4, 6);
    } else {
      g.fillStyle = muted;
      g.font = "13px sans-serif";
      g.textAlign = "right";
      g.fillText(`${first}fr`, sx(0) - 12, top + fretH * 0.5 + 4);
    }

    // Strings: thicker for the low ones; a plucked string glows and shakes a little.
    const now = performance.now();
    for (let s = 0; s < 6; s++) {
      const age = (now - this.glow[s]) / 600;
      const live = age < 1 ? 1 - age : 0;
      g.strokeStyle = live ? accent : "#8a879c";
      g.globalAlpha = 0.55 + 0.45 * live;
      g.lineWidth = 2.6 - s * 0.3 + live * 1.5;
      const wobble = live ? Math.sin(now / 18 + s) * 2.5 * live : 0;
      g.beginPath(); g.moveTo(sx(s), top - 4); g.quadraticCurveTo(sx(s) + wobble, (top + bottom) / 2, sx(s), bottom); g.stroke();
    }
    g.globalAlpha = 1;

    // Above each string: open (○) or not played (×) — only when the shape is visible.
    g.textAlign = "center";
    if (this.show.dots) {
      this.frets.forEach((f, s) => {
        if (f === 0) { g.strokeStyle = fg; g.lineWidth = 1.8; g.beginPath(); g.arc(sx(s), top - 20, 6, 0, Math.PI * 2); g.stroke(); }
        if (f < 0) { g.fillStyle = muted; g.font = "18px sans-serif"; g.fillText("×", sx(s), top - 14); }
      });
    }

    // The dots (fingers), with the note names and the root if the hints say so.
    if (this.show.dots) {
      const r = Math.min(gap * 0.36, fretH * 0.36);
      // Barre: the first finger lies across several strings on the lowest fret.
      if (fretted.length) {
        const min = Math.min(...fretted);
        const on = this.frets.map((f, s) => (f === min ? s : -1)).filter((s) => s >= 0);
        const from = on[0], to = on[on.length - 1];
        const covered = this.frets.slice(from, to + 1).every((f) => f >= min);
        if (on.length >= 2 && covered && to - from >= 2) {
          g.fillStyle = accent;
          g.globalAlpha = 0.85;
          g.beginPath();
          const y = fy(min) - r * 0.75;
          if (g.roundRect) g.roundRect(sx(from) - r, y, sx(to) - sx(from) + 2 * r, r * 1.5, r * 0.75);
          else g.rect(sx(from) - r, y, sx(to) - sx(from) + 2 * r, r * 1.5);
          g.fill();
          g.globalAlpha = 1;
        }
      }
      this.frets.forEach((f, s) => {
        if (f <= 0) return;
        const p = this.pitch(s);
        const isRoot = this.show.root !== null && p % 12 === this.show.root;
        g.fillStyle = this.show.roles ? roleColor(this.show.roles[p % 12]) : isRoot ? rootColor : accent;
        g.beginPath(); g.arc(sx(s), fy(f), r, 0, Math.PI * 2); g.fill();
        if (this.show.notes) {
          g.fillStyle = "#0a0a0f";
          g.font = `600 ${Math.round(r * 0.9)}px sans-serif`;
          g.fillText((this.show.spell || PC_NAMES)[p % 12], sx(s), fy(f) + r * 0.32);
        }
      });
      // Open strings: their note name and root ring too, when asked.
      this.frets.forEach((f, s) => {
        if (f !== 0) return;
        const p = this.pitch(s);
        const ring = this.show.roles ? roleColor(this.show.roles[p % 12])
          : this.show.root !== null && p % 12 === this.show.root ? rootColor : null;
        if (ring) { g.strokeStyle = ring; g.lineWidth = 3; g.beginPath(); g.arc(sx(s), top - 20, 6, 0, Math.PI * 2); g.stroke(); }
        // Note name above (the answer writes it under the string instead).
        if (this.show.notes && !this.show.roles) { g.fillStyle = fg; g.font = "600 11px sans-serif"; g.fillText((this.show.spell || PC_NAMES)[p % 12], sx(s), top - 34); }
      });
    }

    // Placing fingers: the fret numbers on the side.
    if (this.onPlace) {
      g.fillStyle = muted;
      g.font = "12px sans-serif";
      g.textAlign = "right";
      for (let k = 0; k < rows; k++) g.fillText(String(first + k), sx(0) - 14, top + (k + 0.5) * fretH + 4);
      g.textAlign = "center";
    }

    // The right shape over the player's one (rings), once asked for: open (○) and not
    // played (×) one row higher, so both stay readable.
    const good = css.getPropertyValue("--good").trim() || "#7fdcc8";
    if (this.show.ghost) {
      const r = Math.min(gap * 0.36, fretH * 0.36) + 3;
      this.show.ghost.forEach((f, s) => {
        g.strokeStyle = good; g.fillStyle = good; g.lineWidth = 2.5;
        if (f > 0) { g.beginPath(); g.arc(sx(s), fy(f), r, 0, Math.PI * 2); g.stroke(); }
        else if (f === 0) { g.lineWidth = 1.8; g.beginPath(); g.arc(sx(s), top - 36, 5, 0, Math.PI * 2); g.stroke(); }
        else { g.font = "15px sans-serif"; g.fillText("×", sx(s), top - 31); }
      });
    }

    // Placing fingers, checked: under each string, right (✓) or not (✗).
    if (this.show.marks) {
      const bad = css.getPropertyValue("--bad").trim() || "#ff9688";
      g.font = "600 18px sans-serif";
      this.show.marks.forEach((ok, s) => {
        if (ok === null) return;
        g.fillStyle = ok ? good : bad;
        g.fillText(ok ? "✓" : "✗", sx(s), h - 12);
      });
      return;
    }

    // The answer: under each string, its note and its role in the chord.
    if (this.show.roles) {
      this.frets.forEach((f, s) => {
        const p = this.pitch(s);
        if (p === null) { g.fillStyle = muted; g.font = "14px sans-serif"; g.fillText("×", sx(s), h - 34); return; }
        const role = this.show.roles[p % 12];
        g.fillStyle = fg;
        g.font = "600 14px sans-serif";
        g.fillText((this.show.spell || PC_NAMES)[p % 12], sx(s), h - 34);
        g.fillStyle = roleColor(role);
        g.font = "600 12px sans-serif";
        g.fillText(role, sx(s), h - 14);
      });
      return;
    }

    // Under the strings: their names when the string is played open.
    if (this.show.strings) {
      g.fillStyle = muted;
      g.font = "600 14px sans-serif";
      STRING_NAMES.forEach((n, s) => g.fillText(n, sx(s), h - 14));
    }
  }
}

// A colour per role, the same on the dots and under the strings.
function roleColor(role) {
  if (role === "R") return getComputedStyle(document.documentElement).getPropertyValue("--c-bass").trim();
  if (/^b?3$/.test(role)) return "#8a7fff";   // third: major or minor, the colour of the chord
  if (/^[b#]?5$/.test(role)) return "#c9c6d6"; // fifth
  if (/7$/.test(role)) return "#f2b56d";       // seventh
  return "#7fdcc8";                            // 2, 4, 6, 9: added colours
}
