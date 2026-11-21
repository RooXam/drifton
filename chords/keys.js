// A small piano keyboard: shows the notes of a chord (coloured by their role once the
// answer is known), and plays a key when touched. Drawn on a canvas.

const BLACK_KEYS = [1, 3, 6, 8, 10];

class Keyboard {
  constructor(canvas, onKey) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.onKey = onKey; // (pitch) → play it
    this.pitches = [];
    // dots: show the keys pressed; names: their note names; root: pitch class in blue;
    // roles: { pitch class: "R" | "b3"… } once the answer is shown
    this.show = { dots: true, names: false, root: null, roles: null, spell: null };
    this.glow = new Map(); // pitch → when it was touched (ms)
    canvas.addEventListener("pointerdown", (e) => {
      const p = this.hit(e);
      if (p === null) return;
      this.glow.set(p, performance.now());
      this.onKey(p);
      this.animate();
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set(pitches, show) {
    this.pitches = pitches;
    this.show = { ...this.show, ...show };
    // Two octaves (three if needed) from the C under the lowest note: stable while guessing.
    const lo = pitches.length ? Math.min(...pitches) : 48;
    const hi = pitches.length ? Math.max(...pitches) : 71;
    this.low = Math.floor(lo / 12) * 12;
    this.high = Math.max(this.low + 23, Math.floor(hi / 12) * 12 + 11);
    this.draw();
  }

  // The white keys and where each key is drawn: { p, x, w, h, black }.
  keys() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const whites = [];
    for (let p = this.low; p <= this.high; p++) if (!BLACK_KEYS.includes(p % 12)) whites.push(p);
    const ww = W / whites.length;
    const out = [];
    whites.forEach((p, i) => out.push({ p, x: i * ww, w: ww, h: H, black: false }));
    for (let p = this.low; p <= this.high; p++) {
      if (!BLACK_KEYS.includes(p % 12)) continue;
      const left = whites.indexOf(p - 1) * ww + ww * 0.66;
      out.push({ p, x: left, w: ww * 0.68, h: H * 0.6, black: true });
    }
    return out;
  }

  // The key under the finger: black keys first, they sit on top.
  hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const ks = this.keys();
    const k = ks.find((k) => k.black && x >= k.x && x <= k.x + k.w && y <= k.h) || ks.find((k) => !k.black && x >= k.x && x < k.x + k.w);
    return k ? k.p : null;
  }

  animate() {
    if (this.raf) return;
    const loop = () => {
      this.draw();
      const busy = [...this.glow.values()].some((t) => performance.now() - t < 400);
      this.raf = busy ? requestAnimationFrame(loop) : null;
    };
    this.raf = requestAnimationFrame(loop);
  }

  draw() {
    const { canvas, g } = this;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || this.low === undefined) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim();
    const rootColor = css.getPropertyValue("--c-bass").trim();
    const now = performance.now();
    const pressed = new Set(this.show.dots ? this.pitches : []);
    const colorOf = (p) => {
      if (!pressed.has(p)) return null;
      if (this.show.roles) return roleColor(this.show.roles[p % 12]);
      return this.show.root !== null && p % 12 === this.show.root ? rootColor : accent;
    };

    for (const k of this.keys()) {
      const c = colorOf(k.p);
      const lit = now - (this.glow.get(k.p) || -1e9) < 400;
      g.fillStyle = c || (lit ? "#b9b2ff" : k.black ? "#1b1a26" : "#e8e6f0");
      if (k.black) g.fillRect(k.x, 0, k.w, k.h);
      else g.fillRect(k.x + 0.5, 0, k.w - 1, k.h);
      if (!k.black && k.p % 12 === 0 && !c) {
        g.fillStyle = "#6b6880";
        g.font = `${Math.min(11, k.w * 0.55)}px sans-serif`;
        g.textAlign = "center";
        g.fillText("C" + (k.p / 12 - 1), k.x + k.w / 2, h - 6);
      }
    }
    // Names (and roles) on the keys pressed, at the bottom of the key.
    if (this.show.names || this.show.roles) {
      g.textAlign = "center";
      for (const k of this.keys()) {
        if (!pressed.has(k.p)) continue;
        const cx = k.x + k.w / 2;
        const size = Math.max(9, Math.min(13, k.w * 0.55));
        g.fillStyle = "#0a0a0f";
        g.font = `600 ${size}px sans-serif`;
        g.fillText((this.show.spell || PC_NAMES)[k.p % 12], cx, k.h - (this.show.roles ? 20 : 8));
        if (this.show.roles) {
          g.font = `600 ${size - 1}px sans-serif`;
          g.fillText(this.show.roles[k.p % 12] || "", cx, k.h - 7);
        }
      }
    }
  }
}
