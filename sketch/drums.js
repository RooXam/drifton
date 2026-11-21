// A small drum kit, every sound synthesized on the spot (no samples), soft rather than
// punchy so it sits well under pads and keys:
//
// - kick:   a sine whose pitch falls fast (the "thump"), plus a tiny filtered click
// - snare:  a short tone (the drum's body) and a burst of noise (the wires)
// - clap:   noise through a band-pass, in three quick bursts then a short tail
// - hats:   six square waves at odd, unrelated pitches (a metallic, bell-like cloud, the
//           trick of the old drum machines), high-passed; open = long, closed = short.
//           A closed hat cuts an open one ("choke"), like a real hi-hat.
// - rim:    a click with a hollow tone, very short
//
// Each hit builds a few nodes, plays once at time `t` and is thrown away.

class DrumKit {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(destination);
    // One second of white noise, shared by every hit.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.openHat = null; // the open hat still ringing, to choke it
  }

  // pitch = General MIDI drum note (36 kick, 37 rim, 38 snare, 39 clap, 42 / 46 hats).
  play(pitch, velocity = 0.8, t = this.ctx.currentTime) {
    const v = 0.25 + 0.75 * velocity; // soft hits stay audible
    if (pitch === 36) this.kick(t, v);
    else if (pitch === 38) this.snare(t, v);
    else if (pitch === 39) this.clap(t, v);
    else if (pitch === 42) this.hat(t, v, false);
    else if (pitch === 46) this.hat(t, v, true);
    else if (pitch === 37) this.rim(t, v);
  }

  // A gain that jumps to `peak` at t and dies away exponentially over `decay` seconds.
  env(t, peak, decay, attack = 0.002) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 4);
    g.connect(this.out);
    return g;
  }

  noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  kick(t, v) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    osc.connect(this.env(t, 1.0 * v, 0.5, 0.003));
    osc.start(t);
    osc.stop(t + 0.7);
    // The click: 5 ms of low-passed noise, so the kick speaks on small speakers.
    const click = this.noiseSource(t, 0.01);
    click.connect(this.filter("lowpass", 2500)).connect(this.env(t, 0.25 * v, 0.008, 0.0005));
  }

  snare(t, v) {
    const body = this.ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    body.connect(this.env(t, 0.45 * v, 0.12));
    body.start(t);
    body.stop(t + 0.3);
    const wires = this.noiseSource(t, 0.35);
    wires.connect(this.filter("bandpass", 3200, 0.6)).connect(this.filter("lowpass", 7000))
      .connect(this.env(t, 0.42 * v, 0.2));
  }

  clap(t, v) {
    const src = this.noiseSource(t, 0.4);
    const g = this.ctx.createGain();
    // Three bursts 10 ms apart (hands not quite together), then the room.
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.011;
      g.gain.setValueAtTime(0.9 * v, s);
      g.gain.setTargetAtTime(0.1 * v, s + 0.001, 0.003);
    }
    g.gain.setValueAtTime(0.6 * v, t + 0.034);
    g.gain.setTargetAtTime(0, t + 0.034, 0.05);
    src.connect(this.filter("bandpass", 1300, 1.2)).connect(this.filter("highpass", 600)).connect(g).connect(this.out);
  }

  hat(t, v, open) {
    if (this.openHat) { // choke the open hat still ringing
      this.openHat.gain.cancelScheduledValues(t);
      this.openHat.gain.setTargetAtTime(0, t, 0.01);
      this.openHat = null;
    }
    const decay = open ? 0.45 : 0.06;
    const g = this.env(t, (open ? 0.16 : 0.2) * v, decay, 0.001);
    const hp = this.filter("highpass", 7000);
    const bp = this.filter("bandpass", 10000, 0.8);
    hp.connect(bp).connect(g);
    // Six squares at the ratios of the classic metallic cloud.
    for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 40 * ratio * 4.1;
      o.connect(hp);
      o.start(t);
      o.stop(t + decay * 1.6 + 0.05);
    }
    // A touch of noise softens the metal.
    this.noiseSource(t, decay * 1.6).connect(this.filter("highpass", 8000)).connect(this.env(t, 0.08 * v, decay));
    if (open) this.openHat = g;
  }

  rim(t, v) {
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 820;
    o.connect(this.filter("bandpass", 1700, 2)).connect(this.env(t, 0.55 * v, 0.045, 0.0005));
    o.start(t);
    o.stop(t + 0.12);
    this.noiseSource(t, 0.02).connect(this.filter("highpass", 3000)).connect(this.env(t, 0.15 * v, 0.01, 0.0005));
  }
}
