// A voice = everything needed to play ONE note:
//
//   OscLayer A ─┐
//   OscLayer B ─┼──> filter ──> amp ──> trem ──> pan ──> synth input
//   Noise ──────┘      ^          ^       ^       ^
//                      |          |       |       |
//            filter envelope  amp env    LFOs (modulation matrix)
//            + LFOs
//
// A new Voice is built on every note-on and thrown away once its release has finished.
// Web Audio nodes are cheap to create, and an oscillator can only be started once anyway.

class Voice {
  constructor(synth, note, velocity, t) {
    const ctx = synth.ctx;
    const p = synth.params;
    this.ctx = ctx;
    this.synth = synth;
    this.note = note;
    this.startTime = t; // may be in the future: notes are scheduled ahead
    this.released = false;

    this.filter = ctx.createBiquadFilter();
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.trem = ctx.createGain(); // extra gain stage the "Volume" modulation can move
    this.pan = ctx.createStereoPanner();
    this.filter.connect(this.amp);
    this.amp.connect(this.trem);
    this.trem.connect(this.pan);
    this.pan.connect(synth.input);

    const freq = midiToFreq(note);
    this.layers = [
      new OscLayer(ctx, p, "a", freq, t, this.filter),
      new OscLayer(ctx, p, "b", freq, t, this.filter),
    ];

    // Noise: a few seconds of pre-computed noise, looped, starting at a random spot.
    this.noiseGain = ctx.createGain();
    this.noise = ctx.createBufferSource();
    this.noise.buffer = synth.noiseBuffers[p["noise.color"]];
    this.noise.loop = true;
    this.noise.connect(this.noiseGain);
    this.noiseGain.connect(this.filter);
    this.noise.start(t, Math.random() * this.noise.buffer.duration);

    this.mods = [];
    this.update(p, false);
    this.connectMods();

    // Amp envelope: volume from 0 to `velocity`.
    Envelope.start(this.amp.gain, t, envFrom(p, "amp"), velocity);
    // Filter envelope: it moves the filter's `detune` (in cents) rather than its
    // frequency. The cutoff slider sets the frequency, the envelope adds on top of it,
    // so both can change at the same time without fighting. 1 octave = 1200 cents.
    Envelope.start(this.filter.detune, t, envFrom(p, "fenv"), p["filter.env"] * 1200);

    this.layers[0].oscs[0].onended = () => this.dispose();
  }

  update(p, smooth) {
    const f = this.filter;
    if (f.type !== p["filter.type"]) f.type = p["filter.type"];
    setParam(this.ctx, f.frequency, p["filter.cutoff"], smooth);
    setParam(this.ctx, f.Q, resonanceToQ(p["filter.res"], f.type), smooth);
    for (const layer of this.layers) layer.update(p, smooth);
    setParam(this.ctx, this.noiseGain.gain, p["noise.level"], smooth);

    // Volume modulation swings around a lowered base so the sound never gets louder
    // than without modulation: with depth 1, the gain moves between 0 and 1.
    let depth = 0;
    for (let i = 1; i <= MOD_SLOTS; i++) {
      if (p[`mod${i}.src`] !== "off" && p[`mod${i}.dst`] === "amp") depth += Math.abs(p[`mod${i}.amount`]);
    }
    setParam(this.ctx, this.trem.gain, Math.max(0, 1 - depth * 0.5), smooth);

    for (const m of this.mods) setParam(this.ctx, m.gain.gain, p[`mod${m.slot}.amount`] * m.scale, smooth);
  }

  // ---- Modulation ----

  // Which AudioParams a destination moves, and how much at amount = 100%.
  modTargets(dst) {
    const oscs = this.layers.flatMap((l) => l.oscs.map((osc, i) => ({ osc, pos: l.position(i) })));
    switch (dst) {
      case "cutoff": return [{ param: this.filter.detune, scale: 4800 }];       // ±4 octaves
      case "pitch": return oscs.map((o) => ({ param: o.osc.detune, scale: 100 })); // ±1 semitone
      case "detune": return oscs.map((o) => ({ param: o.osc.detune, scale: 30 * o.pos })); // spread ±30 ct
      case "amp": return [{ param: this.trem.gain, scale: 0.5 }];
      case "pan": return [{ param: this.pan.pan, scale: 1 }];
      default: return [];
    }
  }

  // (Re)build the connections LFO → amount gain → param, one per slot and target.
  connectMods() {
    this.disconnectMods();
    const p = this.synth.params;
    for (let slot = 1; slot <= MOD_SLOTS; slot++) {
      const src = p[`mod${slot}.src`];
      if (src === "off") continue;
      const lfo = this.synth.lfos[src === "lfo1" ? 0 : 1];
      for (const { param, scale } of this.modTargets(p[`mod${slot}.dst`])) {
        if (scale === 0) continue;
        const gain = this.ctx.createGain();
        gain.gain.value = p[`mod${slot}.amount`] * scale;
        lfo.out.connect(gain);
        gain.connect(param); // an AudioParam adds every signal connected to it to its own value
        this.mods.push({ slot, lfo, gain, scale });
      }
    }
  }

  disconnectMods() {
    for (const m of this.mods) {
      m.lfo.out.disconnect(m.gain);
      m.gain.disconnect();
    }
    this.mods = [];
  }

  // ---- End of the note ----

  // Key released: start the release phase of both envelopes, then stop the sources.
  release(t) {
    if (this.released) return;
    this.released = true;
    const p = this.synth.params;
    const end = Envelope.release(this.amp.gain, t, envFrom(p, "amp"));
    Envelope.release(this.filter.detune, t, envFrom(p, "fenv"));
    this.stopSources(end);
  }

  // Cut the voice quickly (30 ms fade) when we need room for a new note.
  kill(t) {
    this.released = true;
    holdAt(this.amp.gain, t);
    this.amp.gain.linearRampToValueAtTime(0, t + 0.03);
    this.stopSources(t + 0.04);
  }

  stopSources(t) {
    for (const layer of this.layers) layer.stop(t);
    this.noise.stop(t);
  }

  dispose() {
    this.disconnectMods();
    this.pan.disconnect();
    this.synth.voices.delete(this);
  }
}

// Web Audio quirk: for lowpass/highpass, the filter's Q is the height of the resonant
// peak in dB (-3 dB = no peak); for bandpass/notch it is the classic Q, i.e. how narrow
// the band is. We expose a single 0..1 "Resonance" knob and translate it.
function resonanceToQ(r, type) {
  if (type === "lowpass" || type === "highpass") return -3 + r * 27;
  return 0.5 * Math.pow(2, r * 5);
}
