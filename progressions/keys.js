// A small keyboard that lights up the notes being played: the bass in one colour,
// the chord in the other. Drawn on a canvas, redrawn only when the notes change.

const KEYS_LOW = 36, KEYS_HIGH = 84; // C2..C6
const BLACK = [1, 3, 6, 8, 10];

class Keys {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.state = "";
    this.bass = null;
    this.notes = [];
    new ResizeObserver(() => this.draw(true)).observe(canvas);
  }

  show(bass, notes) {
    this.bass = bass;
    this.notes = notes || [];
    this.draw();
  }

  draw(force = false) {
    const key = `${this.bass}|${this.notes.join(",")}|${this.canvas.clientWidth}`;
    if (!force && key === this.state) return;
    this.state = key;

    const { canvas, g } = this;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const chordColor = css.getPropertyValue("--accent").trim();
    const bassColor = css.getPropertyValue("--c-bass").trim();
    const colorOf = (p) => (p === this.bass ? bassColor : this.notes.includes(p) ? chordColor : null);

    // White keys first, then the black ones on top.
    const whites = [];
    for (let p = KEYS_LOW; p <= KEYS_HIGH; p++) if (!BLACK.includes(p % 12)) whites.push(p);
    const ww = W / whites.length;
    const x = new Map();
    whites.forEach((p, i) => x.set(p, i * ww));

    whites.forEach((p) => {
      g.fillStyle = colorOf(p) || "#e8e6f0";
      g.fillRect(x.get(p) + dpr * 0.5, 0, ww - dpr, H);
      if (p % 12 === 0 && !colorOf(p)) {
        g.fillStyle = "#6b6880";
        g.font = `${Math.min(11, ww / dpr * 0.6) * dpr}px sans-serif`;
        g.textAlign = "center";
        g.fillText("C" + (p / 12 - 1), x.get(p) + ww / 2, H - 6 * dpr);
      }
    });
    for (let p = KEYS_LOW; p <= KEYS_HIGH; p++) {
      if (!BLACK.includes(p % 12)) continue;
      const left = x.get(p - 1) + ww * 0.68;
      g.fillStyle = colorOf(p) || "#1b1a26";
      g.fillRect(left, 0, ww * 0.64, H * 0.6);
    }
  }
}
