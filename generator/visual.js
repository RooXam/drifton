// Visualizer: a slow drift through an abstract sky in space that moves with the music.
//
// A simple 3D: every object has a position (x, y, z), z being its distance ahead. To
// draw it, divide by z (perspective): the farther, the smaller and the closer to the
// centre. The camera drifts slowly forward (and gently sideways), so the shapes scattered
// across the sky come towards us and slide past, at their own depth.
//
// - Far behind everything, a few large soft clouds of colour (nebulae) drift slowly.
// - Stars and dust everywhere.
// - Shapes appear in the distance, anywhere in the sky, and come closer: halos of
//   circles, rings seen at an angle, circles of dots, spirals, small suns, glowing orbs.
//   A chord change brings a new, larger one.
// - Each bell or piano note becomes a glow, placed by its pitch.
// - Feedback: each frame starts from the previous one, barely enlarged and faded, which
//   leaves soft trails, as in old video synthesizers.
// - The colour follows the chord, gliding slowly; the Tape setting adds film grain, a
//   wobble and washed-out colours.
//
// Nothing flashes: every change is smoothed over a second or more. The 16 Hz pulse of the
// sound is deliberately not shown (fast flicker is tiring, even harmful, to watch).

const FAR = 16, NEAR = 0.4; // what we see, in world units ahead of the camera
const SKY_W = 9, SKY_H = 6; // how wide the field of shapes is, around us
const SHAPES = ["halo", "ring", "dots", "spiral", "sun", "orb"];

class Visualizer {
  constructor(canvas, analyser, gen, fx) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.gen = gen;
    this.fx = fx;
    // The scene (with its trails) has its own canvas; the film (grain, scan lines, dark
    // edges) is added on top only on screen, so it never feeds back into the trails.
    this.scene = document.createElement("canvas");
    this.buf = document.createElement("canvas");
    this.bins = new Uint8Array(analyser.frequencyBinCount);
    this.level = { low: 0, mid: 0, high: 0 };
    this.peak = { low: 0.3, mid: 0.3, high: 0.3 };
    this.hue = 265;
    this.cam = { x: 0, y: 0, z: 0 }; // where we are; z = how far we have travelled
    this.speed = 0.15;
    this.stars = Array.from({ length: 160 }, () => this.newStar(NEAR + Math.random() * FAR));
    // A few shapes already there at the start, at all depths.
    this.things = [];
    for (let i = 0; i < 9; i++) this.spawn(false, 2 + Math.random() * (FAR - 2));
    this.nebulae = Array.from({ length: 3 }, (_, i) => ({
      x: (Math.random() - 0.5) * 1.4, y: (Math.random() - 0.5) * 0.9,
      r: 0.35 + Math.random() * 0.3, hueShift: -25 + i * 25, phase: Math.random() * 6,
    }));
    this.seen = new WeakSet();
    this.chordCount = 0;
    this.nextShape = 1;
    this.grain = this.makeGrain();
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.last = performance.now();
    this.t = 0;
  }

  newStar(z) {
    return { x: this.cam.x + (Math.random() - 0.5) * SKY_W * 2, y: this.cam.y + (Math.random() - 0.5) * SKY_H * 2,
      z: this.cam.z + (z ?? FAR), tw: Math.random() * 6 };
  }

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

  // Loudness of three bands, 0..1, each against its own recent peak (so the picture
  // follows the music's ups and downs whatever the volume); quick up, slow down.
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
      const v = Math.pow(now[k] / this.peak[k], 2);
      this.level[k] += (v - this.level[k]) * (v > this.level[k] ? 0.08 : 0.02);
    }
  }

  // The chord's hue: roots a fifth apart get neighbouring colours, violets and roses.
  chordHue(now) {
    const c = this.gen.running && this.gen.chordAt(now);
    if (!c) return 265;
    const root = NOTE_NAMES.findIndex((n) => c.name.startsWith(n) && !(n.length === 1 && c.name[1] === "#"));
    return 258 + 22 * Math.sin((((root * 7) % 12) / 12) * Math.PI * 2);
  }

  // World → screen. Returns null behind the camera or too close.
  project(x, y, z) {
    const d = z - this.cam.z;
    if (d < NEAR) return null;
    const k = this.f / d;
    return { x: this.W / 2 + (x - this.cam.x) * k, y: this.H / 2 + (y - this.cam.y) * k, k, d };
  }

  // Fade in from the distance, fade out just before passing us.
  fog(d) {
    return Math.max(0, Math.min(1, (FAR - d) / (FAR * 0.5)) * Math.min(1, (d - NEAR) / 1.2));
  }

  // A new shape somewhere in the sky, far ahead (or at depth d). Never right in front of
  // us: we drift between the shapes, not into them.
  spawn(big = false, d = FAR) {
    let x, y;
    do {
      x = (Math.random() - 0.5) * SKY_W;
      y = (Math.random() - 0.5) * SKY_H;
    } while (Math.hypot(x, y * 1.4) < 0.8);
    this.things.push({
      kind: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      x: this.cam.x + x, y: this.cam.y + y, z: this.cam.z + d,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.3,
      tilt: 0.25 + Math.random() * 0.6, // rings are seen at an angle: ellipses
      hueShift: (Math.random() - 0.5) * 50, size: (big ? 1.3 : 0.5) + Math.random() * 0.5,
    });
  }

  catchNotes(now) {
    for (const n of this.gen.notes) {
      if (this.seen.has(n) || n.start > now) continue;
      this.seen.add(n);
      if ((n.role !== "bells" && n.role !== "keys") || now - n.start > 0.5) continue;
      const a = ((n.note % 12) / 12) * Math.PI * 2;
      this.things.push({ kind: "note", x: this.cam.x + Math.cos(a) * 1.6, y: this.cam.y + Math.sin(a) * 1.1,
        z: this.cam.z + 6 + Math.random() * 3, size: n.role === "bells" ? 1 : 0.6 });
    }
  }

  draw() {
    this.resize();
    const { canvas: c, scene, buf } = this;
    const W = (this.W = c.width), H = (this.H = c.height);
    this.f = Math.min(W, H) * 0.9;
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.t += dt;
    const t = this.t;
    const now = this.gen.ctx.currentTime;
    const tape = this.fx.tape || 0;
    this.listen();
    const { low, mid, high } = this.level;
    this.hue += (this.chordHue(now) - this.hue) * 0.01;
    const hue = this.hue, sat = 42 - tape * 20;

    // Drifting: slowly forward (a little faster with a faster tempo), and sideways along
    // slow curves, so the sky turns around us.
    const target = this.gen.running ? 0.25 + (this.gen.bpm - 50) * 0.006 + mid * 0.12 : 0.08;
    this.speed += (target * (this.still ? 0.3 : 1) - this.speed) * 0.01;
    const dz = this.speed * dt;
    this.cam.z += dz;
    this.cam.x = Math.sin(this.cam.z * 0.07) * 1.6;
    this.cam.y = Math.cos(this.cam.z * 0.05) * 0.8;

    // New shapes: one every few seconds, a larger one at each chord change.
    if (this.gen.chords.length !== this.chordCount) {
      this.chordCount = this.gen.chords.length;
      if (this.gen.running) this.spawn(true);
    }
    this.nextShape -= dt * (0.5 + this.speed);
    if (this.nextShape <= 0) { this.spawn(); this.nextShape = 2 + Math.random() * 3; }
    this.catchNotes(now);
    this.things = this.things.filter((o) => o.z - this.cam.z > NEAR);

    // 1. Feedback: the last scene, barely enlarged and faded: soft trails.
    let g = scene.getContext("2d");
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
      const z = 1.002 + this.speed * 0.006;
      g.scale(z, z);
      g.globalAlpha = 0.8;
      g.drawImage(buf, -W / 2, -H / 2);
      g.restore();
    }

    g.save();
    g.translate(Math.sin(t * 0.53 * Math.PI * 2) * tape * W * 0.004, 0); // tape wobble
    g.globalCompositeOperation = "lighter";
    const M = Math.min(W, H);

    // 2. Nebulae: big soft clouds far away, moving only a little (they are so far). Very
    // faint: what barely moves piles up in the trails (about five times brighter).
    for (const n of this.nebulae) {
      const x = W / 2 + (n.x - this.cam.x * 0.05) * W + Math.sin(t * 0.03 + n.phase) * W * 0.03;
      const y = H / 2 + (n.y - this.cam.y * 0.05) * H + Math.cos(t * 0.025 + n.phase) * H * 0.03;
      const r = n.r * Math.max(W, H) * (1 + low * 0.05);
      const cloud = g.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, `hsl(${hue + n.hueShift} ${sat}% 45% / ${0.012 + low * 0.008})`);
      cloud.addColorStop(1, `hsl(${hue + n.hueShift} ${sat}% 30% / 0)`);
      g.fillStyle = cloud;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 3. Stars: small points everywhere, twinkling slowly.
    for (const s of this.stars) {
      if (s.z - this.cam.z < NEAR) Object.assign(s, this.newStar());
      const p = this.project(s.x, s.y, s.z);
      if (!p) continue;
      const tw = 0.6 + 0.4 * Math.sin(t * 0.8 + s.tw);
      g.fillStyle = `hsl(${hue + 30} 25% 85% / ${this.fog(p.d) * 0.55 * tw})`;
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, 0.01 * p.k), 0, Math.PI * 2); g.fill();
    }

    // 4. Shapes and note glows, far ones first.
    this.things.sort((a, b2) => b2.z - a.z);
    for (const o of this.things) {
      const s = this.project(o.x, o.y, o.z);
      if (!s) continue;
      const a = this.fog(s.d);
      const h = hue + (o.hueShift || 30);
      const R = (o.size || 1) * s.k; // the shape's size on screen
      o.rot = (o.rot || 0) + (o.spin || 0) * dt;
      const line = Math.max(0.6, 0.012 * s.k);
      if (o.kind === "note") {
        const r = 0.09 * o.size * s.k;
        const dot = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        dot.addColorStop(0, `hsl(${hue + 30} 55% 80% / ${a * 0.5})`);
        dot.addColorStop(1, `hsl(${hue + 30} 55% 60% / 0)`);
        g.fillStyle = dot;
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      } else if (o.kind === "halo") {
        g.lineWidth = line;
        for (let i = 1; i <= 4; i++) {
          g.strokeStyle = `hsl(${h + i * 5} ${sat}% 70% / ${a * (0.3 - i * 0.05) * (0.6 + mid * 0.6)})`;
          g.beginPath(); g.arc(s.x, s.y, R * i * 0.14, 0, Math.PI * 2); g.stroke();
        }
      } else if (o.kind === "ring") {
        // A planet's ring seen at an angle, around a faint core.
        g.lineWidth = line * 1.4;
        g.strokeStyle = `hsl(${h} ${sat}% 70% / ${a * 0.32})`;
        g.beginPath(); g.ellipse(s.x, s.y, R * 0.6, R * 0.6 * o.tilt, o.rot, 0, Math.PI * 2); g.stroke();
        const core = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 0.22);
        core.addColorStop(0, `hsl(${h + 15} ${sat}% 65% / ${a * 0.3})`);
        core.addColorStop(1, `hsl(${h} ${sat}% 50% / 0)`);
        g.fillStyle = core;
        g.beginPath(); g.arc(s.x, s.y, R * 0.22, 0, Math.PI * 2); g.fill();
      } else if (o.kind === "dots") {
        g.fillStyle = `hsl(${h} ${sat + 10}% 75% / ${a * 0.42})`;
        for (let j = 0; j < 24; j++) {
          const ang = o.rot + (j / 24) * Math.PI * 2;
          g.beginPath();
          g.arc(s.x + Math.cos(ang) * R * 0.45, s.y + Math.sin(ang) * R * 0.45, Math.max(0.6, 0.015 * s.k), 0, Math.PI * 2);
          g.fill();
        }
      } else if (o.kind === "spiral") {
        g.fillStyle = `hsl(${h} ${sat + 10}% 75% / ${a * 0.42})`;
        for (let i = 0; i < 28; i++) {
          const ang = o.rot + i * 0.55, rr = R * (0.03 + i * 0.014);
          g.beginPath();
          g.arc(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr, Math.max(0.6, 0.012 * s.k), 0, Math.PI * 2);
          g.fill();
        }
      } else if (o.kind === "sun" || o.kind === "orb") {
        const r = R * (o.kind === "sun" ? 0.4 : 0.15) * (1 + low * 0.1);
        const glow = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        glow.addColorStop(0, `hsl(${h + 20} ${sat}% 72% / ${a * 0.32})`);
        glow.addColorStop(0.35, `hsl(${h + 10} ${sat}% 55% / ${a * 0.14})`);
        glow.addColorStop(1, `hsl(${h} ${sat}% 40% / 0)`);
        g.fillStyle = glow;
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();

    // 5. On screen: the scene, then the film (grain, faint scan lines, darker edges).
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
    const vignette = g.createRadialGradient(W / 2, H / 2, M * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, "rgb(4 2 10 / 0)");
    vignette.addColorStop(1, "rgb(4 2 10 / 0.75)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);
  }
}
