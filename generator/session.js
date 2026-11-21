// What keeps Focus music alive over minutes and hours, below the level of attention:
//
// - SessionArc: the shape of a listening session. It starts gently (fewer layers, a
//   darker sound), settles, and, when the session has a length, winds down and fades
//   out at the end. Its output is one number, the "energy" (0.45 … 1), that main.js
//   uses to scale density, movement, brightness and the number of layers.
// - Drift: a few settings wander very slowly around the values you chose, so an hour
//   of music never sits completely still. Never far, never fast.
// - BreathFilter: a soft low-pass filter on the pad and the texture that opens and
//   closes over tens of seconds, like slow breathing.

// ---- The arc of a session ----

const ARC_FLOOR = 0.45; // the energy at the very start and the very end

// minutes: 0 = endless. shape: "rise" (gentle start, plateau, descent) or "down"
// (Sleep: winds down from the first minute to the last). fade: seconds of fade out.
class SessionArc {
  constructor(minutes, { shape = "rise", fade = 75, skipRise = false } = {}) {
    this.total = minutes * 60;
    this.shape = shape;
    this.fade = Math.min(fade, this.total / 3 || fade);
    // Rise: 12 % of the session, between 2 and 5 minutes (also in endless mode).
    this.rise = skipRise ? 0 : Math.min(300, Math.max(120, this.total * 0.12 || 180));
    // Descent: the last 15 %, between 3 and 8 minutes, before the fade out.
    this.descent = Math.min(480, Math.max(180, this.total * 0.15));
  }

  get endless() { return this.total === 0; }

  // Energy at `t` seconds into the session.
  energy(t) {
    const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const span = 1 - ARC_FLOOR;
    if (!this.endless && this.shape === "down") {
      return 1 - span * smooth(t / (this.total - this.fade));
    }
    let e = this.rise ? ARC_FLOOR + span * smooth(t / this.rise) : 1;
    if (!this.endless) {
      const fall = this.total - this.fade - this.descent; // when the descent starts
      e = Math.min(e, 1 - span * smooth((t - fall) / this.descent));
    }
    return e;
  }

  // When the fade out starts (Infinity when endless), and when the music stops.
  get fadeAt() { return this.endless ? Infinity : this.total - this.fade; }
  get endAt() { return this.endless ? Infinity : this.total; }
}

// ---- Slow drift ----

// Each setting follows a "mean-reverting random walk" (an Ornstein–Uhlenbeck process,
// a classic of statistics): at each step it takes a small random step, plus a pull back
// towards 0 that grows the further it has wandered. So it wanders, but always comes
// home. `tau` (seconds) is how slowly: the pull takes minutes to bring it back.
// `size` is its typical distance from 0 (the standard deviation, once it has settled).
class Drift {
  constructor(sizes, tau = 240) {
    this.sizes = sizes;  // { name: typical offset }
    this.tau = tau;
    this.x = Object.fromEntries(Object.keys(sizes).map((k) => [k, 0]));
  }

  // Move every setting forward by `dt` seconds.
  // x ← x − x·dt/τ + size·√(2·dt/τ)·N(0, 1). The √(2/τ) makes `size` the standard
  // deviation of the walk; we cap it at 2.5 sizes so a rare streak never goes far.
  step(dt) {
    const k = dt / this.tau;
    for (const [name, size] of Object.entries(this.sizes)) {
      const x = this.x[name] * (1 - k) + size * Math.sqrt(2 * k) * gauss();
      this.x[name] = Math.max(-2.5 * size, Math.min(2.5 * size, x));
    }
  }
}

// A random number from the bell curve (mean 0, standard deviation 1), by the
// Box–Muller method: two uniform random numbers turned into one normal one.
function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

// ---- Breathing filter ----

// A gentle low-pass (no resonance) whose cutoff two very slow sines move up and down,
// by up to about ¾ of an octave. Their periods (48 s and 29 s) don't divide each other,
// so the breathing never settles into an exact loop. setBase moves the centre, slowly:
// the session arc makes it darker at the start and the end.
class BreathFilter {
  constructor(ctx, base) {
    this.ctx = ctx;
    this.base = base;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = -3; // for a low-pass, Q is the peak in dB: −3 = no peak
    this.filter.frequency.value = base;
    for (const [rate, cents] of [[1 / 48, 500], [1 / 29, 300]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = cents;
      lfo.connect(depth).connect(this.filter.detune); // detune is in cents: 1200 = an octave
      lfo.start();
    }
    this.input = this.output = this.filter;
  }

  // shift: in octaves from the base (−1 = an octave darker), reached over ~10 s.
  setBase(shift) {
    const f = this.base * Math.pow(2, shift);
    if (this.ctx.state === "running") this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 4);
    else this.filter.frequency.value = f;
  }
}
