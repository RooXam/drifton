// A plucked string, by the Karplus-Strong algorithm (1983), computed note by note.
//
// The idea: a string struck by a pick starts with a burst of noise. Put that noise in a
// loop exactly one period long (sampleRate / frequency samples): the loop repeats, so
// we hear a pitch. At each pass, average neighbouring samples: the high harmonics fade
// faster than the low ones, like a real string losing its brightness. A little loss per
// pass makes the note die away. That's all, and it sounds surprisingly like a guitar.
//
// Each note is computed once into an AudioBuffer (2.5 s), then replayed from the cache.

class PluckSound {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.out.connect(limiter).connect(ctx.destination);
  }

  setVolume(v) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  buffer(pitch) {
    if (this.cache.has(pitch)) return this.cache.get(pitch);
    const sr = this.ctx.sampleRate;
    const f = 440 * 2 ** ((pitch - 69) / 12);
    const period = sr / f;            // the loop length, in samples (not a whole number)
    const n = Math.floor(period);
    const len = Math.round(sr * 2.5);
    const data = new Float32Array(len);

    // The pick: noise, slightly smoothed so the attack isn't too harsh.
    let prev = 0;
    for (let i = 0; i <= n + 1; i++) {
      prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5;
      data[i] = prev;
    }
    // Losing a little each period: low notes ring ~3 s, high notes ~1.2 s.
    const ring = 1.2 + 1.8 * Math.max(0, Math.min(1, (76 - pitch) / 36));
    const loss = Math.pow(10, -3 / (ring * f)); // −60 dB after `ring` seconds
    // Read the loop at a position that isn't a whole sample: mix the two samples around it.
    const at = (x) => { const k = Math.floor(x), w = x - k; return (1 - w) * data[k] + w * data[k + 1]; };
    const back = period - 0.5; // averaging two neighbours adds half a sample of delay
    for (let i = n + 2; i < len; i++) {
      data[i] = loss * 0.5 * (at(i - back) + at(i - back - 1)); // the softening
    }
    // Same loudness for every note.
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
    for (let i = 0; i < len; i++) data[i] *= 0.6 / (peak || 1);

    const buf = this.ctx.createBuffer(1, len, sr);
    buf.copyToChannel(data, 0);
    this.cache.set(pitch, buf);
    return buf;
  }

  // One string, at audio time t.
  pluck(pitch, t = this.ctx.currentTime, velocity = 0.8) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(pitch);
    const g = this.ctx.createGain();
    g.gain.value = velocity;
    src.connect(g).connect(this.out);
    src.start(t);
    src.onended = () => g.disconnect();
    return src;
  }

  // A string not played (×) touched anyway: a short dead "tick".
  mute(t = this.ctx.currentTime) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.round(sr * 0.03), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * 0.15;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    src.start(t);
  }

  // All the strings one after the other: down = from the low string, up = from the high one.
  strum(pitches, down = true, gap = 0.03) {
    const t = this.ctx.currentTime + 0.02;
    const order = down ? pitches : [...pitches].reverse();
    order.forEach((p, i) => this.pluck(p, t + i * gap, down ? 0.75 : 0.6));
  }
}
