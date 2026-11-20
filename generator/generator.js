// The generator: decides which notes each instrument plays, and when.
//
// Five roles, each with its own rules, all following the same harmony:
// - pad:     holds 4 notes of the current chord, voice-led from one chord to the next
// - bass:    the chord root, low: held, or played in rhythm when there is movement
// - keys:    a soft piano playing little arpeggios on the chord, in time
// - bells:   sparse melodic notes, a random walk on the scale that leans on chord
//            tones, now and then repeating a short motif (a hint of melody, never a tune)
// - texture: one long note, rarely changing
//
// Time runs on a grid of bars (4 beats at `bpm`): chords change at the start of a bar.
// A light "conductor" makes the optional layers (keys, bells, texture) fade in and out
// every few bars, so the music keeps changing slowly without ever drawing attention.
//
// Timing uses a "lookahead scheduler": every 100 ms a JavaScript timer looks at what
// should happen in the next 1.5 s and schedules those notes at exact audio-clock times.
// JS timers are imprecise (they can be late by tens of ms, more in background tabs);
// the audio clock is not. The timer only needs to run often enough to stay ahead.

const LOOKAHEAD = 1.5;
const OPTIONAL = ["keys", "bells", "texture"]; // layers the conductor brings in and out
const FADE = 8;                                // seconds for a layer to fade in or out

// Arpeggio rhythms, as eighth notes of the bar (0–7), from calm to busy.
const KEY_PATTERNS = [
  [[0, 4], [0, 3, 6], [0, 6], [0, 5]],
  [[0, 2, 4, 6], [0, 3, 4, 7], [0, 2, 5, 6], [0, 3, 6]],
  [[0, 1, 2, 3, 4, 5, 6, 7], [0, 2, 3, 4, 6, 7], [0, 1, 3, 4, 5, 7]],
];

class Generator {
  constructor(ctx, synths, harmony, layers) {
    this.ctx = ctx;
    this.synths = synths;   // { pad, bass, keys, bells, texture }: one Synth each
    this.layers = layers;   // { role: GainNode } after each synth: what the conductor fades
    this.harmony = harmony;
    this.on = { pad: true, bass: true, keys: true, bells: true, texture: true };
    this.bpm = 72;
    this.chordSeconds = 20; // average chord length (rounded to 1, 2, 4 or 8 bars)
    this.density = 0.35;    // 0..1: how many bell notes
    this.movement = 0.4;    // 0..1: how much keys and bass play in rhythm
    this.evolve = true;     // the conductor fades optional layers in and out
    this.riff = false;      // keys repeat one short riff instead of free arpeggios
    this.running = false;
    this.notes = [];        // log for the piano roll: { role, note, start, end }
    this.chords = [];       // log of chord changes: { t, name, roman }
    this.fades = {};        // the last fade of each layer: { t0, v0, t1, v1 }
  }

  get beat() { return 60 / this.bpm; }
  get barSeconds() { return 4 * this.beat; }

  start() {
    if (this.running) return;
    const t = this.ctx.currentTime + 0.1;
    this.running = true;
    this.degree = 0;
    this.chordCount = 0;
    this.barCount = 0;
    this.barsLeft = 0;
    this.held = { pad: [], bass: null, texture: null };
    this.nextBar = t;
    this.nextChord = t;
    this.nextBell = t + 3;
    this.bellDeg = 4;
    this.motif = [];
    // Start sparse, like Endel: pad and bass alone for two bars, while the room (the
    // reverb) fills; then one layer fades in. The others come in later.
    this.inLayer = { keys: this.movement > 0.1, bells: this.movement <= 0.1, texture: false };
    this.changedAt = { keys: t, bells: t, texture: t };
    for (const r of OPTIONAL) {
      this.fade(r, false, t, 0.05);
      if (this.inLayer[r]) this.fade(r, true, t + 2 * this.barSeconds, FADE);
    }
    this.timer = setInterval(() => this.tick(), 100);
    this.tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    const now = this.ctx.currentTime;
    for (const s of Object.values(this.synths)) {
      s.allOff();
      // Notes already scheduled for the next instants must not start after Stop.
      for (const v of [...s.voices]) if (v.startTime > now) v.kill(now);
    }
    for (const n of this.notes) if (n.end === Infinity) n.end = Math.max(n.start, now);
  }

  tick() {
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    while (this.nextBar < horizon) {
      this.playBar(this.nextBar);
      this.nextBar += this.barSeconds;
    }
    if (!this.on.bells || !this.inLayer.bells) this.nextBell = Math.max(this.nextBell, horizon);
    while (this.nextBell < horizon) {
      this.bell(this.nextBell);
      this.nextBell += this.bellGap();
    }
    // Forget piano-roll notes that ended long ago.
    this.notes = this.notes.filter((n) => n.end > now - 120);
    this.chords = this.chords.filter((c, i) => i >= this.chords.length - 4 || c.t > now - 120);
  }

  // One bar: maybe a new chord, the conductor, then the rhythmic parts.
  playBar(t) {
    if (this.barsLeft <= 0) {
      this.changeChord(t);
      this.barsLeft = this.chordBars();
      this.nextChord = t + this.barsLeft * this.barSeconds;
    }
    this.barsLeft--;
    this.barCount++;
    if (this.evolve && this.barCount % 8 === 0) this.conduct(t);
    if (this.on.keys && this.inLayer.keys) this.playKeys(t);
    if (this.on.bass && this.movement > 0.35) this.pulseBass(t);
  }

  // How many bars the next chord lasts: around `chordSeconds`, as 1, 2, 4 or 8 bars.
  chordBars() {
    const target = (this.chordSeconds * (0.75 + Math.random() * 0.5)) / this.barSeconds;
    return [1, 2, 4, 8].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  }

  // ---- The conductor: layers fade in and out, one at a time ----

  conduct(t) {
    if (Math.random() > 0.55) return; // often, nothing changes: stability first
    const choices = OPTIONAL.filter((r) => this.on[r] && !(r === "keys" && this.movement <= 0.05));
    if (!choices.length) return;
    // The layer that has stayed as it is the longest is the most likely to change, so each
    // one gets its turn (not minutes of the same layers by chance).
    const r = weightedPick(choices.map((x) => [x, t - this.changedAt[x] + 1]));
    // Only instruments switched on count: a layer muted on the page is not "playing".
    const playing = OPTIONAL.filter((x) => this.inLayer[x] && this.on[x]);
    // Keep at least one optional layer, at most two: never empty, never crowded.
    if (this.inLayer[r] && playing.length <= 1) return;
    if (!this.inLayer[r] && playing.length >= 2) return;
    this.inLayer[r] = !this.inLayer[r];
    this.changedAt[r] = t;
    this.fade(r, this.inLayer[r], t, FADE);
    if (r === "texture" && this.inLayer[r] && this.on.texture) this.playTexture(t, true);
  }

  // Fade a layer to full (inside) or silent, starting at time t (often a little in the
  // future: the next bar). We remember each fade so we know the level at any moment:
  // the new fade continues the current one up to t, then ramps from there. (Freezing
  // the volume at a future time with cancelAndHoldAtTime is not reliable: the level
  // could start moving too early or stop halfway.)
  fade(role, inside, t, seconds) {
    const g = this.layers[role].gain;
    const now = this.ctx.currentTime;
    const old = this.fades[role];
    const level = (x) => (!old ? g.value : x <= old.t0 ? old.v0 : x >= old.t1 ? old.v1
      : old.v0 + ((old.v1 - old.v0) * (x - old.t0)) / (old.t1 - old.t0));
    const from = level(t);
    holdAt(g, now); // drops what was planned after now, so replan the old fade up to t
    if (old && old.t0 > now && old.t0 < t) g.linearRampToValueAtTime(old.v0, old.t0);
    if (old && old.t1 > now && old.t1 < t) g.linearRampToValueAtTime(old.v1, old.t1);
    if (t > now) g.linearRampToValueAtTime(from, t);
    g.linearRampToValueAtTime(inside ? 1 : 0, t + seconds);
    this.fades[role] = { t0: t, v0: from, t1: t + seconds, v1: inside ? 1 : 0 };
  }

  // ---- Settings changed from the page ----

  setDensity(v) {
    this.density = v;
    if (this.running) this.nextBell = Math.min(this.nextBell, this.ctx.currentTime + this.bellGap());
  }

  setEvolve(on) {
    this.evolve = on;
    if (!on && this.running) {
      // Everything in, at once (gently).
      const t = this.ctx.currentTime;
      for (const r of OPTIONAL) { this.inLayer[r] = true; this.fade(r, true, t, 3); }
    }
  }

  setRole(role, on) {
    this.on[role] = on;
    if (!this.running) return;
    const t = this.ctx.currentTime;
    if (role === "pad") on ? this.playPad(t) : this.releaseAll("pad", t);
    if (role === "bass" && this.movement <= 0.35) on ? this.playBass(t, true) : this.releaseAll("bass", t);
    if (role === "texture") on ? this.playTexture(t, true) : this.releaseAll("texture", t);
  }

  // ---- Harmony ----

  changeChord(t) {
    const before = this.chordCount > 0 ? this.degree : null;
    if (this.chordCount > 0) this.degree = this.harmony.nextDegree(this.degree);
    this.chordCount++;
    this.tones = this.harmony.chordTones(this.degree);
    if (this.degree !== before) this.chords.push({ t, ...this.harmony.chordName(this.degree) });
    if (this.on.pad) this.playPad(t);
    if (this.on.bass) {
      if (this.movement <= 0.35) this.playBass(t, false);
      else this.releaseAll("bass", t); // the rhythmic bass takes over
    }
    if (this.on.texture) this.playTexture(t, false);
  }

  // ---- Roles ----

  playPad(t) {
    // A drone holds root, fifth, octave and the fifth above, low: the chord rings as one.
    const r = pitchFrom(this.tones[0], 45);
    const next = this.harmony.style === "drone" ? [r, r + 7, r + 12, r + 19]
      : voiceLead(this.held.pad, this.tones, 50, 74, 4);
    for (const n of this.held.pad) if (!next.includes(n)) this.release("pad", n, t);
    for (const n of next) if (!this.held.pad.includes(n)) this.play("pad", n, 0.55, t);
    this.held.pad = next;
  }

  playBass(t, force) {
    const root = pitchFrom(this.tones[0], 48);
    // One chord in five, the bass rests: the low end breathes.
    const rest = !force && this.chordCount > 1 && Math.random() < 0.2;
    if (this.held.bass !== null && (rest || this.held.bass !== root)) {
      this.release("bass", this.held.bass, t);
      this.held.bass = null;
    }
    if (!rest && this.held.bass === null) {
      this.play("bass", root, 0.7, t);
      this.held.bass = root;
    }
  }

  // With movement: the root on the first beat, sometimes the fifth on the "and" of 3.
  pulseBass(t) {
    const root = pitchFrom(this.tones[0], 48);
    this.play("bass", root, 0.5, t);
    this.release("bass", root, t + this.beat * 2.4);
    if (Math.random() < this.movement * 0.6) {
      const fifth = pitchFrom(this.harmony.pc(this.degree + 4), root);
      const t2 = t + this.beat * 2.5;
      this.play("bass", fifth, 0.36, t2);
      this.release("bass", fifth, t2 + this.beat * 1.2);
    }
  }

  // A little arpeggio on the chord: busier with more movement, some bars left empty.
  playKeys(t) {
    if (this.riff) return this.playRiff(t);
    const m = this.movement;
    if (m <= 0.05 || Math.random() > 0.45 + 0.5 * m) return;
    const level = m < 0.34 ? 0 : m < 0.67 ? 1 : 2;
    const patterns = KEY_PATTERNS[level];
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    // The chord's notes (root, 3rd, 5th, 7th, 9th) in the middle of the keyboard.
    const pool = [];
    for (let n = 62; n <= 84; n++) if (this.tones.includes(n % 12)) pool.push(n);
    const shape = Math.floor(Math.random() * 3);
    const line = shape === 0 ? pool : shape === 1 ? [...pool].reverse() : pool.concat(pool.slice(1, -1).reverse());
    const from = Math.floor(Math.random() * Math.max(1, line.length - pattern.length));
    const eighth = this.beat / 2;
    pattern.forEach((e, k) => {
      const note = line[(from + k) % line.length];
      const swing = e % 2 ? eighth * 0.1 : 0;               // off-beats a hair late: it breathes
      const human = (Math.random() - 0.5) * 0.016;          // nobody plays exactly on the grid
      const tt = Math.max(t, t + e * eighth + swing + human);
      this.play("keys", note, (e === 0 ? 0.5 : 0.32) + Math.random() * 0.12, tt);
      this.release("keys", note, tt + eighth * 1.6);
    });
  }

  // A riff: 5 to 7 notes on a fixed rhythm, played again bar after bar (refitted to each
  // chord: same shape, the chord's own notes). Repetition makes it hypnotic rather than
  // busy; a new riff every 16 bars, and now and then a bar of rest.
  playRiff(t) {
    if (!this.riffShape || this.barCount % 16 === 1) this.newRiff();
    if (Math.random() < 0.15) return;
    const pool = [];
    for (let n = 62; n <= 84; n++) if (this.tones.includes(n % 12)) pool.push(n);
    const eighth = this.beat / 2;
    for (const { slot, step } of this.riffShape) {
      const note = pool[Math.min(pool.length - 1, step)];
      const tt = t + slot * eighth + (slot % 2 ? eighth * 0.12 : 0) + (Math.random() - 0.5) * 0.012;
      this.play("keys", note, (slot === 0 ? 0.46 : 0.3) + Math.random() * 0.08, tt);
      this.release("keys", note, tt + eighth * 1.6);
    }
  }

  newRiff() {
    const length = 5 + Math.floor(Math.random() * 3);
    const slots = [0];
    while (slots.length < length) {
      const s = 1 + Math.floor(Math.random() * 7);
      if (!slots.includes(s)) slots.push(s);
    }
    slots.sort((a, b) => a - b);
    let step = 1 + Math.floor(Math.random() * 3);
    this.riffShape = slots.map((slot) => {
      const here = { slot, step };
      step = reflect(step + [-2, -1, 1, 1, 2][Math.floor(Math.random() * 5)], 0, 6);
      return here;
    });
  }

  playTexture(t, force) {
    // Only moves on about one chord in three; follows the chord's fifth.
    if (this.held.texture !== null && !force && Math.random() > 0.3) return;
    const note = pitchFrom(this.harmony.pc(this.degree + 4), 60); // the chord's fifth
    if (note === this.held.texture) return;
    if (this.held.texture !== null) this.release("texture", this.held.texture, t);
    this.play("texture", note, 0.5, t);
    this.held.texture = note;
  }

  bell(t) {
    // Sometimes, replay the last few notes: a motif the ear can half-recognise.
    if (this.motif.length >= 3 && Math.random() < 0.15) {
      let tt = t;
      for (const d of this.motif) {
        this.strike(d, tt);
        tt += 0.35 + Math.random() * 0.4;
      }
      this.nextBell = tt;
      return;
    }
    // Random walk: small steps on the scale, mostly ±1 or ±2 degrees.
    const steps = [-3, -2, -1, -1, 1, 1, 2, 3];
    let d = this.bellDeg + steps[Math.floor(Math.random() * steps.length)];
    d = reflect(d, 0, 10);
    // Lean on chord tones: a note outside the chord is often nudged onto a neighbour.
    if (!this.tones.includes(this.harmony.pc(d)) && Math.random() < 0.6) {
      d = reflect(d + (Math.random() < 0.5 ? -1 : 1), 0, 10);
    }
    this.bellDeg = d;
    this.motif.push(d);
    if (this.motif.length > 4) this.motif.shift();
    this.strike(d, t);
  }

  strike(d, t) {
    const base = pitchFrom(this.harmony.root, 55);
    const note = base + Math.floor(d / 7) * 12 + this.harmony.scale[mod(d, 7)];
    this.play("bells", note, 0.25 + Math.random() * 0.35, t);
    this.release("bells", note, t + 0.3); // the bell patch keeps ringing after release
  }

  // Random gap between bells (exponential distribution: like raindrops, no pulse).
  bellGap() {
    const rate = 0.03 + this.density * 0.5; // notes per second
    return Math.max(0.25, -Math.log(1 - Math.random()) / rate);
  }

  // ---- Notes (also logged for the piano roll) ----

  play(role, note, velocity, t) {
    this.synths[role].noteOn(note, velocity, t);
    this.notes.push({ role, note, start: t, end: Infinity });
  }

  release(role, note, t) {
    this.synths[role].noteOff(note, t);
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      if (n.role === role && n.note === note && n.end === Infinity) { n.end = t; break; }
    }
  }

  releaseAll(role, t) {
    if (role === "pad") { for (const n of this.held.pad) this.release("pad", n, t); this.held.pad = []; }
    else if (this.held[role] !== null && this.held[role] !== undefined) { this.release(role, this.held[role], t); this.held[role] = null; }
  }

  // The chord sounding at time t (chords are scheduled a bit ahead).
  chordAt(t) {
    let current = null;
    for (const c of this.chords) if (c.t <= t) current = c;
    return current;
  }
}

// Bounce off the edges: 11 → 9 when the range is 0..10.
function reflect(d, lo, hi) {
  if (d < lo) return lo + (lo - d);
  if (d > hi) return hi - (d - hi);
  return d;
}
