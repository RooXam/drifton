// Visualizer: a slow flight forward through an abstract world that moves with the music.
//
// A simple 3D: every object has a position (x, y, z), z being its distance ahead. To
// draw it, divide by z (perspective): the farther, the smaller and the closer to the
// centre. Each frame the camera moves forward, so everything comes towards us.
//
// - Tunnel rings, along a path that curves gently, come at us and pass around us.
// - A sun far away (where we are heading) breathes with the low end.
// - Luminous dust drifts past.
// - At each chord change, something appears in the distance and approaches: a halo of
//   circles to the side, an arch we fly through, a spiral of dots, a small sun.
// - Each bell or piano note becomes a glow coming towards us, placed by its pitch.
// - Feedback: each frame starts from the previous one, slightly enlarged and faded, which
//   leaves soft trails, as in old video synthesizers.
// - The colour follows the chord, gliding slowly; the Tape setting adds film grain, a
//   wobble and washed-out colours.
//
// Nothing flashes: every change is smoothed over a second or more. The 16 Hz pulse of the
// sound is deliberately not shown (fast flicker is tiring, even harmful, to watch).

const FAR = 14, NEAR = 0.35; // what we see, in world units ahead of the camera
const RING_GAP = 1.1;        // distance between two tunnel rings

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
    this.camZ = 0;        // how far we have travelled
    this.speed = 0.2;
    this.things = [];     // landmarks and note glows: { kind, x, y, z, … }
    this.dust = Array.from({ length: 110 }, () => this.newDust(Math.random() * FAR));
    this.seen = new WeakSet();
    this.chordCount = 0;
    this.nextLandmark = 4;
    this.grain = this.makeGrain();
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.last = performance.now();
    this.t = 0;
  }

  newDust(z) {
    return { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4, z: z ?? FAR };
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

  // The path we follow curves gently: its centre at a distance z ahead.
  path(z) {
    const s = this.camZ + z;
    return { x: Math.sin(s * 0.13) * 0.9 + Math.sin(s * 0.051) * 0.6, y: Math.cos(s * 0.097) * 0.45 };
  }

  // World → screen. Returns null behind the camera or too close.
  project(x, y, z) {
    if (z < NEAR) return null;
    const here = this.path(0); // the path where we are is the screen centre
    const k = this.f / z;
    return { x: this.W / 2 + (x - here.x) * k, y: this.H / 2 + (y - here.y) * k, k };
  }

  // Fade in from the distance, fade out just before passing us.
  fog(z) {
    return Math.min(1, (FAR - z) / (FAR * 0.55)) * Math.min(1, (z - NEAR) / 0.8);
  }

  // Something new in the distance: kinds chosen at random, off the path or around it.
  spawnLandmark() {
    const kinds = ["halo", "arch", "spiral", "sun"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const p = this.path(FAR);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = kind === "arch" ? 0 : side * (1.4 + Math.random() * 1.2);
    this.things.push({
      kind, z: FAR, x: p.x + off, y: p.y + (Math.random() - 0.5) * 1.2,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.4,
      hueShift: (Math.random() - 0.5) * 40, size: 0.6 + Math.random() * 0.5,
    });
  }

  catchNotes(now) {
    for (const n of this.gen.notes) {
      if (this.seen.has(n) || n.start > now) continue;
      this.seen.add(n);
      if ((n.role !== "bells" && n.role !== "keys") || now - n.start > 0.5) continue;
      const a = ((n.note % 12) / 12) * Math.PI * 2 - Math.PI / 2;
      const z = 7 + Math.random() * 2;
      const p = this.path(z);
      this.things.push({ kind: "note", z, x: p.x + Math.cos(a) * 0.9, y: p.y + Math.sin(a) * 0.9,
        size: n.role === "bells" ? 1 : 0.6 });
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

    // Moving forward: faster with a faster tempo, slow drift when stopped.
    const target = this.gen.running ? 0.35 + (this.gen.bpm - 50) * 0.012 + mid * 0.25 : 0.12;
    this.speed += (target * (this.still ? 0.3 : 1) - this.speed) * 0.01;
    const dz = this.speed * dt;
    this.camZ += dz;

    // New things: a landmark at each chord change (and now and then anyway), note glows.
    if (this.gen.chords.length !== this.chordCount) {
      this.chordCount = this.gen.chords.length;
      if (this.gen.running) this.spawnLandmark();
    }
    this.nextLandmark -= dt;
    if (this.nextLandmark <= 0) { this.spawnLandmark(); this.nextLandmark = 10 + Math.random() * 12; }
    this.catchNotes(now);
    for (const o of this.things) o.z -= dz;
    this.things = this.things.filter((o) => o.z > NEAR);

    // 1. Feedback: the last scene, slightly enlarged (as if we moved forward) and faded.
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
      const z = 1 + 0.006 + this.speed * 0.012 + high * 0.006;
      g.scale(z, z);
      g.rotate(0.0006 + mid * 0.0012);
      g.globalAlpha = 0.84;
      g.drawImage(buf, -W / 2, -H / 2);
      g.restore();
    }

    g.save();
    g.translate(Math.sin(t * 0.53 * Math.PI * 2) * tape * W * 0.004, 0); // tape wobble
    g.globalCompositeOperation = "lighter";

    // 2. The sun far ahead, where we are going.
    const far = this.path(FAR);
    const sunP = this.project(far.x, far.y, FAR);
    const sunR = Math.min(W, H) * (0.07 + low * 0.03);
    const sun = g.createRadialGradient(sunP.x, sunP.y, 0, sunP.x, sunP.y, sunR * 4);
    sun.addColorStop(0, `hsl(${hue + 25} ${sat}% 66% / ${0.13 + low * 0.10})`);
    sun.addColorStop(0.25, `hsl(${hue + 15} ${sat}% 50% / ${0.08 + low * 0.08})`);
    sun.addColorStop(1, `hsl(${hue} ${sat}% 30% / 0)`);
    g.fillStyle = sun;
    g.fillRect(sunP.x - sunR * 4, sunP.y - sunR * 4, sunR * 8, sunR * 8);

    // 3. Tunnel rings, from far to near; one in four is made of dots.
    const first = Math.ceil((this.camZ + NEAR) / RING_GAP);
    for (let k = Math.floor((this.camZ + FAR) / RING_GAP); k >= first; k--) {
      const z = k * RING_GAP - this.camZ;
      const p = this.path(z);
      const s = this.project(p.x, p.y, z);
      if (!s) continue;
      const a = this.fog(z) * (0.10 + low * 0.14);
      const r = 1.25 * s.k * (1 + Math.sin(k * 1.7 + t * 0.6) * 0.04);
      g.strokeStyle = g.fillStyle = `hsl(${hue + (k % 5) * 7} ${sat}% 64% / ${a})`;
      if (k % 4 === 0) {
        for (let j = 0; j < 36; j++) {
          const ang = (j / 36) * Math.PI * 2 + k * 0.3;
          g.beginPath();
          g.arc(s.x + Math.cos(ang) * r, s.y + Math.sin(ang) * r, Math.max(0.6, 0.03 * s.k), 0, Math.PI * 2);
          g.fill();
        }
      } else {
        g.lineWidth = Math.max(0.6, 0.012 * s.k);
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.stroke();
      }
    }

    // 4. Dust drifting past.
    for (const d of this.dust) {
      d.z -= dz * 1.4;
      if (d.z < NEAR) Object.assign(d, this.newDust());
      const p = this.path(d.z);
      const s = this.project(p.x + d.x, p.y + d.y, d.z);
      if (!s) continue;
      g.fillStyle = `hsl(${hue + 30} 30% 80% / ${this.fog(d.z) * 0.5})`;
      g.beginPath(); g.arc(s.x, s.y, Math.max(0.5, 0.012 * s.k), 0, Math.PI * 2); g.fill();
    }

    // 5. Landmarks and note glows, far ones first.
    this.things.sort((a, b2) => b2.z - a.z);
    for (const o of this.things) {
      const s = this.project(o.x, o.y, o.z);
      if (!s) continue;
      const a = this.fog(o.z);
      const h = hue + (o.hueShift || 30);
      o.rot = (o.rot || 0) + (o.spin || 0) * dt;
      if (o.kind === "note") {
        const r = 0.09 * o.size * s.k;
        const dot = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        dot.addColorStop(0, `hsl(${hue + 30} 55% 80% / ${a * 0.5})`);
        dot.addColorStop(1, `hsl(${hue + 30} 55% 60% / 0)`);
        g.fillStyle = dot;
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      } else if (o.kind === "halo") {
        g.lineWidth = Math.max(0.6, 0.01 * s.k);
        for (let i = 1; i <= 4; i++) {
          g.strokeStyle = `hsl(${h + i * 5} ${sat}% 70% / ${a * (0.32 - i * 0.05) * (0.6 + mid * 0.6)})`;
          g.beginPath(); g.arc(s.x, s.y, o.size * s.k * i * 0.16, 0, Math.PI * 2); g.stroke();
        }
      } else if (o.kind === "arch") {
        g.lineWidth = Math.max(1, 0.03 * s.k);
        g.strokeStyle = `hsl(${h} ${sat}% 68% / ${a * 0.35})`;
        g.beginPath(); g.arc(s.x, s.y, 1.6 * s.k, o.rot, o.rot + Math.PI * 1.15); g.stroke();
        g.lineWidth = Math.max(0.6, 0.01 * s.k);
        g.beginPath(); g.arc(s.x, s.y, 1.75 * s.k, o.rot + 0.3, o.rot + Math.PI * 1.15 + 0.3); g.stroke();
      } else if (o.kind === "spiral") {
        g.fillStyle = `hsl(${h} ${sat + 10}% 75% / ${a * 0.45})`;
        for (let i = 0; i < 28; i++) {
          const ang = o.rot + i * 0.55, rr = o.size * s.k * (0.05 + i * 0.016);
          g.beginPath();
          g.arc(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr, Math.max(0.6, 0.012 * s.k), 0, Math.PI * 2);
          g.fill();
        }
      } else if (o.kind === "sun") {
        const r = 0.35 * o.size * s.k;
        const glow = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        glow.addColorStop(0, `hsl(${h + 20} ${sat}% 72% / ${a * 0.35})`);
        glow.addColorStop(0.35, `hsl(${h + 10} ${sat}% 55% / ${a * 0.15})`);
        glow.addColorStop(1, `hsl(${h} ${sat}% 40% / 0)`);
        g.fillStyle = glow;
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();

    // 6. On screen: the scene, then the film (grain, faint scan lines, darker edges).
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
