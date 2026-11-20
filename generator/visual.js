// Visualizer: an abstract, slowly hypnotic picture that moves with the music.
//
// - A "sun" of concentric rings breathes with the low end (pad and bass).
// - Two hexagons turn slowly in opposite directions; they swell with the mids.
// - Each bell or piano note leaves a small glow, placed around the sun by its pitch.
// - Feedback: every frame starts from the previous one, drawn slightly larger, turned
//   and faded. Whatever is drawn drifts outwards and leaves soft trails: the tunnel
//   effect of old video synthesizers.
// - The colour follows the chord (each root has its hue, in the violets and roses),
//   gliding slowly when the chord changes.
// - The Tape setting adds film grain, a slow wobble and a washed-out look.
//
// Nothing flashes: every change is smoothed over a second or more. The 16 Hz pulse of
// the sound is deliberately not shown (fast flicker is tiring, even harmful, to watch).

class Visualizer {
  constructor(canvas, analyser, gen, fx) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.gen = gen;
    this.fx = fx;
    // The scene (shapes and their trails) is drawn on its own canvas; the film (grain,
    // scan lines, dark edges) is added on top only on screen, so it never feeds back.
    this.scene = document.createElement("canvas");
    this.buf = document.createElement("canvas"); // copy of the last scene, for the feedback
    this.bins = new Uint8Array(analyser.frequencyBinCount);
    this.level = { low: 0, mid: 0, high: 0 };
    this.peak = { low: 0.3, mid: 0.3, high: 0.3 }; // recent loudest value of each band
    this.hue = 265;
    this.particles = [];
    this.seen = new WeakSet(); // notes already turned into a glow
    this.grain = this.makeGrain();
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.t0 = performance.now();
  }

  // A small tile of random grey dots, repeated over the picture as film grain.
  makeGrain() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Sizes the canvas to its box. Capped resolution: cheaper on phones, and a slightly
  // soft picture suits the look.
  resize() {
    const c = this.canvas;
    const scale = Math.min(devicePixelRatio, 1.5);
    let w = Math.round(c.clientWidth * scale), h = Math.round(c.clientHeight * scale);
    const cap = 1100 / Math.max(w, h);
    if (cap < 1) { w = Math.round(w * cap); h = Math.round(h * cap); }
    if (c.width !== w || c.height !== h) {
      c.width = this.scene.width = this.buf.width = w;
      c.height = this.scene.height = this.buf.height = h;
    }
  }

  // Loudness of three frequency bands, 0..1, smoothed: quick to rise, slow to fall.
  // Each band is measured against its own recent peak, so the picture follows the music's
  // ups and downs whatever the volume, instead of sitting at the top.
  listen() {
    const a = this.analyser;
    a.getByteFrequencyData(this.bins);
    const hz = a.context.sampleRate / a.fftSize;
    const band = (lo, hi) => {
      let s = 0, n = 0;
      for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz); i++) { s += this.bins[i]; n++; }
      return s / n / 255;
    };
    const now = { low: band(40, 250), mid: band(250, 2000), high: band(2000, 8000) };
    for (const k in now) {
      this.peak[k] = Math.max(now[k], this.peak[k] * 0.9995, 0.05);
      const v = Math.pow(now[k] / this.peak[k], 2); // squared: quiet parts stay calm
      this.level[k] += (v - this.level[k]) * (v > this.level[k] ? 0.08 : 0.02);
    }
  }

  // New bell and piano notes become glows around the sun, at an angle set by the pitch.
  catchNotes(R, now) {
    for (const n of this.gen.notes) {
      if (this.seen.has(n) || n.start > now) continue;
      this.seen.add(n);
      if (n.role !== "bells" && n.role !== "keys" || now - n.start > 0.5) continue;
      const angle = ((n.note % 12) / 12) * Math.PI * 2 - Math.PI / 2;
      this.particles.push({ angle, r: R * 1.05, life: 1, size: n.role === "bells" ? 1 : 0.6 });
    }
  }

  // The chord's hue: roots a fifth apart get neighbouring colours, in violet and rose.
  chordHue(now) {
    const c = this.gen.running && this.gen.chordAt(now);
    if (!c) return 265;
    const root = NOTE_NAMES.findIndex((n, i) => c.name.startsWith(n) && !(n.length === 1 && c.name[1] === "#"));
    const fifths = (root * 7) % 12; // position on the circle of fifths
    return 258 + 22 * Math.sin((fifths / 12) * Math.PI * 2);
  }

  draw() {
    this.resize();
    const { canvas: c, scene, buf } = this;
    const W = c.width, H = c.height;
    let g = scene.getContext("2d");
    const t = (performance.now() - this.t0) / 1000;
    const now = this.gen.ctx.currentTime;
    const R = Math.min(W, H) * 0.3;
    const tape = this.fx.tape || 0;
    const speed = this.still ? 0.25 : 1;
    this.listen();
    const { low, mid, high } = this.level;
    this.hue += (this.chordHue(now) - this.hue) * 0.01;
    const hue = this.hue;

    // 1. Feedback: the last scene, a little larger and turned, fading.
    const b = buf.getContext("2d");
    b.clearRect(0, 0, W, H);
    b.drawImage(scene, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = `hsl(${hue + 10} 45% 4%)`;
    g.fillRect(0, 0, W, H);
    if (!this.still) {
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate((0.0012 + mid * 0.003) * speed);
      const z = 1.006 + high * 0.012;
      g.scale(z, z);
      g.globalAlpha = 0.86;
      g.drawImage(buf, -W / 2, -H / 2);
      g.restore();
    }

    // 2. The new shapes, added as light.
    const wobble = Math.sin(t * 0.53 * Math.PI * 2) * tape * W * 0.004;
    g.save();
    g.translate(W / 2 + wobble, H / 2);
    g.globalCompositeOperation = "lighter";
    const sat = 42 - tape * 20; // worn tape: washed-out colours

    // Soft glow at the heart of the sun.
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.3);
    glow.addColorStop(0, `hsl(${hue + 15} ${sat}% 55% / ${0.04 + low * 0.08})`);
    glow.addColorStop(1, `hsl(${hue} ${sat}% 30% / 0)`);
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, 0, R * 1.3, 0, Math.PI * 2); g.fill();

    // Concentric rings, breathing out of step with each other.
    const unit = Math.min(W, H) / 400;
    for (let i = 0; i < 7; i++) {
      const breathe = Math.sin(t * 0.35 * speed + i * 0.8) * 0.02;
      const r = R * (0.22 + i * 0.12) * (1 + low * 0.12 + breathe);
      g.strokeStyle = `hsl(${hue + i * 6} ${sat}% ${62 - i * 3}% / ${0.05 + low * 0.09 - i * 0.004})`;
      g.lineWidth = unit * (1.2 + (6 - i) * 0.25);
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    }

    // Two hexagons turning against each other.
    for (const [k, dir] of [[1, 1], [0.78, -1]]) {
      g.save();
      g.rotate(dir * t * 0.05 * speed);
      g.strokeStyle = `hsl(${hue - 15} ${sat}% 68% / ${0.04 + mid * 0.10})`;
      g.lineWidth = unit * 1.1;
      g.beginPath();
      const hr = R * 1.15 * k * (1 + mid * 0.15);
      for (let j = 0; j <= 6; j++) {
        const a = (j / 6) * Math.PI * 2;
        g[j ? "lineTo" : "moveTo"](Math.cos(a) * hr, Math.sin(a) * hr);
      }
      g.stroke();
      g.restore();
    }

    // Glows from the notes, drifting out and fading.
    this.catchNotes(R, now);
    for (const p of this.particles) {
      p.r += R * 0.004 * speed;
      p.life -= 0.006;
      const x = Math.cos(p.angle + t * 0.05) * p.r, y = Math.sin(p.angle + t * 0.05) * p.r;
      const s = unit * 9 * p.size;
      const dot = g.createRadialGradient(x, y, 0, x, y, s);
      dot.addColorStop(0, `hsl(${hue + 30} 55% 78% / ${p.life * 0.35})`);
      dot.addColorStop(1, `hsl(${hue + 30} 55% 60% / 0)`);
      g.fillStyle = dot;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    g.restore();

    // 3. On screen: the scene, then the film (grain, faint scan lines, darker edges).
    g = c.getContext("2d");
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.drawImage(scene, 0, 0);
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = 0.06 + tape * 0.12;
    g.fillStyle = g.createPattern(this.grain, "repeat");
    g.save();
    g.translate(Math.random() * 128, Math.random() * 128);
    g.fillRect(-128, -128, W + 128, H + 128);
    g.restore();
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 0.05;
    g.fillStyle = "#000";
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    g.globalAlpha = 1;
    const vignette = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, "rgb(4 2 10 / 0)");
    vignette.addColorStop(1, "rgb(4 2 10 / 0.75)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);
  }
}
