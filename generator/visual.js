// Visualizer: a slow drift through an abstract sky, half outer space, half Kandinsky
// painting, that moves with the music.
//
// A simple 3D: every object has a position (x, y, z), z being its distance ahead. To
// draw it, divide by z (perspective): the farther, the smaller and the closer to the
// centre. The camera drifts slowly forward (and gently sideways), so the shapes scattered
// across the sky come towards us and slide past, at their own depth.
//
// - Far behind everything, a few large soft clouds of colour (nebulae) drift slowly.
// - Stars everywhere.
// - Each instrument makes its own shapes when it plays (see catchNotes): the pad circles
//   within circles and planets, the bass bundles of lines, the texture wireframe boxes and
//   pyramids turning in 3D, the bells and piano glows; crescents, triangles and small
//   planets come on their own. Corners and lines tremble and stretch with the sound.
// - Feedback: each frame starts from the previous one, slightly enlarged, turned and
//   faded: everything leaves trails that stream out from the centre and shimmer.
// - The colour follows the chord, gliding slowly; the Tape setting adds film grain, a
//   wobble and washed-out colours.
//
// Nothing flashes: every change is smoothed over a second or more, and the trembling is
// slow (about once a second). The 16 Hz pulse of the sound is deliberately not shown
// (fast flicker is tiring, even harmful, to watch).

const FAR = 16, NEAR = 0.4; // what we see, in world units ahead of the camera
const SKY_W = 9, SKY_H = 6; // how wide the field of shapes is, around us
// Each instrument has its shapes (see catchNotes); these appear on their own, now and then.
const AMBIENT = ["crescent", "triangle", "planet"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// Colours besides the chord's violets: an ochre and a blue-green, as in Kandinsky, kept soft.
const PAINT = [null, null, null, 38, 188];

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
    this.t = 0; // seconds since the page opened (drives the slow animations)
    this.stars = Array.from({ length: 160 }, () => this.newStar(NEAR + Math.random() * FAR));
    this.things = [];
    // A few shapes already there at the start, at all depths.
    for (const kind of [...AMBIENT, ...AMBIENT, "circles", "planet", "lines", "box"]) {
      this.spawn({ kind, d: 2 + Math.random() * (FAR - 2), low: kind === "lines" });
    }
    for (const o of this.things) o.born = -99; // there from the start: no fade-in
    this.nebulae = Array.from({ length: 3 }, (_, i) => ({
      x: (Math.random() - 0.5) * 1.4, y: (Math.random() - 0.5) * 0.9,
      r: 0.35 + Math.random() * 0.3, hueShift: -25 + i * 25, phase: Math.random() * 6,
    }));
    this.seen = new WeakSet();
    this.lastSpawn = {}; // when each instrument last made a shape (audio time)
    this.nextShape = 3;
    this.grain = this.makeGrain();
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.last = performance.now();
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

  // A shape's colour: the chord's hue shifted, or one of the painter's colours.
  colour(o, light, alpha) {
    const h = o.paint ?? this.hue + o.hueShift;
    return `hsl(${h} ${o.sat - (this.fx.tape || 0) * 20}% ${light}% / ${alpha})`;
  }

  // A new shape somewhere in the sky, at depth d. Never right in front of us (we drift
  // between the shapes, not into them); low = in the lower part of the sky.
  spawn({ kind, big = false, d = FAR, low = false }) {
    let x, y;
    do {
      x = (Math.random() - 0.5) * SKY_W;
      y = low ? 0.7 + Math.random() * SKY_H * 0.35 : (Math.random() - 0.5) * SKY_H;
    } while (Math.hypot(x, y * 1.4) < 0.9);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const o = {
      kind, x: this.cam.x + x, y: this.cam.y + y, z: this.cam.z + d, born: this.t,
      size: (big ? 1.3 : 0.6) * rnd(0.8, 1.3), seed: Math.random() * 100,
      rot: rnd(0, 6.28), spin: rnd(-0.25, 0.25),
      rx: rnd(0, 6.28), ry: rnd(0, 6.28), drx: rnd(-0.3, 0.3), dry: rnd(-0.4, 0.4),
      hueShift: rnd(-45, 45), paint: PAINT[Math.floor(Math.random() * PAINT.length)], sat: rnd(35, 55),
      tilt: rnd(0.2, 0.5), ringed: Math.random() < 0.5,
    };
    // Wireframes: corners and the edges joining them.
    if (kind === "box") {
      const [a, b, c] = [rnd(0.25, 0.6), rnd(0.25, 0.6), rnd(0.25, 0.6)];
      o.verts = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) o.verts.push([sx * a, sy * b, sz * c]);
      o.edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    } else if (kind === "pyramid") {
      const a = rnd(0.3, 0.55), h = rnd(0.45, 0.8);
      o.verts = [[-a, h / 2, -a], [a, h / 2, -a], [a, h / 2, a], [-a, h / 2, a], [0, -h / 2, 0]];
      o.edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]];
    } else if (kind === "lines") {
      o.lines = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => ({
        angle: rnd(0, Math.PI), len: rnd(0.5, 1.4), width: rnd(0.004, 0.03), off: rnd(-0.25, 0.25),
      }));
    }
    this.things.push(o);
  }

  // Each instrument has its own shapes, born when it plays (not too close in time):
  // - pad: circles within circles or a planet, large, at each new chord;
  // - bass: a bundle of lines, low in the sky;
  // - texture: a wireframe box or pyramid;
  // - bells and piano: glows around the centre at the angle of the note's name (C at the
  //   top), whatever the octave.
  // A muted instrument, or one faded out by the conductor, makes nothing.
  catchNotes(now) {
    const gap = { pad: 1.5, bass: 0.4, texture: 2 };
    for (const n of this.gen.notes) {
      if (this.seen.has(n) || n.start > now) continue;
      this.seen.add(n);
      const r = n.role;
      if (now - n.start > 0.5 || this.gen.inLayer?.[r] === false) continue;
      if (r === "bells" || r === "keys") {
        const ang = ((n.note % 12) / 12) * Math.PI * 2 - Math.PI / 2;
        this.things.push({ kind: "note", x: this.cam.x + Math.cos(ang) * 1.6, y: this.cam.y + Math.sin(ang) * 1.1,
          z: this.cam.z + 7, size: r === "bells" ? 1 : 0.7, born: this.t });
        continue;
      }
      if (n.start - (this.lastSpawn[r] ?? -99) < gap[r]) continue;
      this.lastSpawn[r] = n.start;
      const d = 7 + Math.random() * 4; // close enough to be seen soon after the sound
      if (r === "pad") this.spawn({ kind: pick(["circles", "circles", "planet"]), big: true, d });
      if (r === "bass") this.spawn({ kind: "lines", low: true, d });
      if (r === "texture") this.spawn({ kind: pick(["box", "pyramid"]), d });
    }
  }

  // Corners of a wireframe after turning it in 3D and letting it tremble with the sound.
  corners(o, t, shake) {
    const [cx, sx] = [Math.cos(o.rx), Math.sin(o.rx)], [cy, sy] = [Math.cos(o.ry), Math.sin(o.ry)];
    const stretch = 1 + Math.sin(t * 1.3 + o.seed) * this.level.low * 0.18;
    return o.verts.map(([x, y, z], i) => {
      x *= stretch;
      x += Math.sin(t * 6 + i * 1.7 + o.seed) * shake;
      y += Math.cos(t * 5 + i * 2.3 + o.seed) * shake;
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx; // turn around x
      const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy; // then around y
      return this.project(o.x + x2 * o.size, o.y + y1 * o.size, o.z + z2 * o.size);
    });
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
    const shake = (mid * 0.6 + high * 0.4) * 0.05; // how much corners and lines tremble

    // Drifting: forward (faster with a faster tempo), and sideways along slow curves.
    const target = this.gen.running ? 0.3 + (this.gen.bpm - 50) * 0.009 + mid * 0.15 : 0.08;
    this.speed += (target * (this.still ? 0.3 : 1) - this.speed) * 0.01;
    const dz = this.speed * dt;
    this.cam.z += dz;
    this.cam.x = Math.sin(this.cam.z * 0.07) * 1.6;
    this.cam.y = Math.cos(this.cam.z * 0.05) * 0.8;

    // Shapes from the instruments, and now and then one on its own, far away.
    this.nextShape -= dt;
    if (this.nextShape <= 0) { this.spawn({ kind: pick(AMBIENT) }); this.nextShape = 4 + Math.random() * 4; }
    this.catchNotes(now);
    this.things = this.things.filter((o) => o.z - this.cam.z > NEAR);

    // 1. Feedback: the last scene, enlarged, turned and faded: trails streaming out.
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
      const z = 1.005 + this.speed * 0.012 + high * 0.006;
      g.scale(z, z);
      g.rotate(0.0005 + mid * 0.0012);
      g.globalAlpha = 0.86;
      g.drawImage(buf, -W / 2, -H / 2);
      g.restore();
    }

    g.save();
    g.translate(Math.sin(t * 0.53 * Math.PI * 2) * tape * W * 0.004, 0); // tape wobble
    g.globalCompositeOperation = "lighter";

    // 2. Nebulae: big soft clouds far away. Very faint: what barely moves piles up in the
    // trails (about seven times brighter).
    for (const n of this.nebulae) {
      const x = W / 2 + (n.x - this.cam.x * 0.05) * W + Math.sin(t * 0.03 + n.phase) * W * 0.03;
      const y = H / 2 + (n.y - this.cam.y * 0.05) * H + Math.cos(t * 0.025 + n.phase) * H * 0.03;
      const r = n.r * Math.max(W, H) * (1 + low * 0.05);
      const cloud = g.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, `hsl(${hue + n.hueShift} ${sat}% 45% / ${0.009 + low * 0.006})`);
      cloud.addColorStop(1, `hsl(${hue + n.hueShift} ${sat}% 30% / 0)`);
      g.fillStyle = cloud;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 3. Stars, twinkling slowly.
    for (const s of this.stars) {
      if (s.z - this.cam.z < NEAR) Object.assign(s, this.newStar());
      const p = this.project(s.x, s.y, s.z);
      if (!p) continue;
      const tw = 0.6 + 0.4 * Math.sin(t * 0.8 + s.tw);
      g.fillStyle = `hsl(${hue + 30} 25% 85% / ${this.fog(p.d) * 0.5 * tw})`;
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, 0.01 * p.k), 0, Math.PI * 2); g.fill();
    }

    // 4. Shapes and notes, far ones first.
    this.things.sort((a, b2) => b2.z - a.z);
    for (const o of this.things) {
      const s = this.project(o.x, o.y, o.z);
      if (!s) continue;
      // Faded in: from the distance, and over its first moments (a shape born close by
      // must not pop up).
      const a = this.fog(s.d) * Math.min(1, (t - o.born) / (o.kind === "note" ? 0.4 : 1.5));
      const R = o.size * s.k; // the shape's size on screen
      const line = Math.max(0.7, 0.012 * s.k);
      o.rot += (o.spin || 0) * dt;
      o.rx += (o.drx || 0) * dt;
      o.ry += (o.dry || 0) * dt;

      if (o.kind === "note") {
        const r = 0.09 * o.size * s.k;
        const dot = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        dot.addColorStop(0, `hsl(${hue + 30} 55% 82% / ${a * 0.55})`);
        dot.addColorStop(1, `hsl(${hue + 30} 55% 60% / 0)`);
        g.fillStyle = dot;
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      } else if (o.kind === "box" || o.kind === "pyramid") {
        const pts = this.corners(o, t, shake);
        if (pts.some((p) => !p)) continue;
        g.strokeStyle = this.colour(o, 70, a * 0.45);
        g.lineWidth = line;
        g.beginPath();
        for (const [i, j] of o.edges) { g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); }
        g.stroke();
        g.fillStyle = this.colour(o, 80, a * 0.6);
        for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, line * 1.6, 0, Math.PI * 2); g.fill(); }
      } else if (o.kind === "lines") {
        for (const [i, l] of o.lines.entries()) {
          const ang = l.angle + o.rot + Math.sin(t * 1.1 + i + o.seed) * shake * 2;
          const nx = Math.cos(ang), ny = Math.sin(ang);
          const ox = -ny * l.off * R, oy = nx * l.off * R;
          const half = (l.len * R) / 2 * (1 + Math.sin(t * 0.9 + i * 2 + o.seed) * mid * 0.15);
          g.strokeStyle = this.colour({ ...o, hueShift: o.hueShift + i * 12 }, 70, a * 0.5);
          g.lineWidth = Math.max(0.7, l.width * s.k);
          g.beginPath();
          g.moveTo(s.x + ox - nx * half, s.y + oy - ny * half);
          g.lineTo(s.x + ox + nx * half, s.y + oy + ny * half);
          g.stroke();
        }
      } else if (o.kind === "circles") {
        // Circles within circles, flat and translucent.
        const breathe = 1 + low * 0.08;
        [[0.5, 0], [0.33, 35], [0.17, -40]].forEach(([k, shift], i) => {
          g.fillStyle = this.colour({ ...o, paint: i === 1 && o.paint ? o.paint : null, hueShift: o.hueShift + shift }, 55 + i * 8, a * 0.07);
          g.beginPath(); g.arc(s.x + i * R * 0.04, s.y - i * R * 0.03, R * k * breathe, 0, Math.PI * 2); g.fill();
        });
      } else if (o.kind === "triangle") {
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          const ang = o.rot + (i / 3) * Math.PI * 2;
          const rr = R * 0.5 * (1 + Math.sin(t * 5 + i * 2 + o.seed) * shake * 3);
          g[i ? "lineTo" : "moveTo"](s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr);
        }
        g.closePath();
        g.fillStyle = this.colour(o, 55, a * 0.12);
        g.fill();
        g.strokeStyle = this.colour(o, 72, a * 0.45);
        g.lineWidth = line;
        g.stroke();
      } else if (o.kind === "planet") {
        const r = R * 0.32;
        const shade = g.createRadialGradient(s.x - r * 0.35, s.y - r * 0.35, r * 0.1, s.x, s.y, r);
        shade.addColorStop(0, this.colour(o, 70, a * 0.22));
        shade.addColorStop(1, this.colour(o, 35, a * 0.05));
        g.fillStyle = shade;
        g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
        if (o.ringed) {
          g.strokeStyle = this.colour(o, 72, a * 0.35);
          g.lineWidth = line;
          g.beginPath(); g.ellipse(s.x, s.y, r * 1.8, r * 1.8 * o.tilt, o.rot * 0.3, 0, Math.PI * 2); g.stroke();
        }
      } else if (o.kind === "crescent") {
        const r = R * 0.3;
        g.beginPath();
        g.arc(s.x, s.y, r, 0, Math.PI * 2);
        g.arc(s.x + r * 0.38 * Math.cos(o.rot), s.y + r * 0.38 * Math.sin(o.rot), r * 0.88, 0, Math.PI * 2, true);
        g.fillStyle = this.colour(o, 75, a * 0.4);
        g.fill("evenodd");
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
    const vignette = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, "rgb(4 2 10 / 0)");
    vignette.addColorStop(1, "rgb(4 2 10 / 0.75)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);
  }
}
