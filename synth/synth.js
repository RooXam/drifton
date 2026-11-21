// A Synth is one instrument: its own patch, voices (polyphony), LFOs and volume.
// Several Synths can run at the same time (pad, bass, bells…), each with its own sound,
// all feeding the same MasterBus:
//
//   Synth "pad"   ─┐
//   Synth "bass"  ─┼──> MasterBus (limiter → analyser) ──> speakers
//   Synth "bells" ─┘
//
// Notes can be played now (keyboard) or scheduled at a precise future time `t`
// (in AudioContext seconds): that is what the generator will do.

class Synth {
  constructor(ctx, params, destination) {
    this.ctx = ctx;
    this.params = params;
    this.maxVoices = 8;
    this.voices = new Set(); // every voice still making sound, oldest first
    this.held = new Map();   // note number → voice whose key is still down

    // Several notes × several unison copies add up fast: keep some headroom.
    this.input = ctx.createGain();
    this.input.gain.value = 0.25;
    this.volume = ctx.createGain();
    this.volume.gain.value = params.volume;
    this.input.connect(this.volume);
    this.volume.connect(destination);
    // The instrument's own effect (a chorus, see effects.js) goes between `input` and
    // `volume`, only while it is turned up. Its reverb and echo sends ("fx.reverb",
    // "fx.delay") are wired by the page, which owns the shared effects (FxBus).
    this.chorus = null;
    this.applyChorus();

    this.noiseBuffers = makeNoiseBuffers(ctx);
    // LFOs belong to the instrument, not to a note: all voices move together.
    this.lfos = [new LFO(ctx), new LFO(ctx)];
    this.applyLfos();
  }

  noteOn(note, velocity = 0.8, t = this.ctx.currentTime) {
    this.noteOff(note, t);
    if (this.voices.size >= this.maxVoices) this.steal(t);
    const voice = new Voice(this, note, velocity, t);
    this.voices.add(voice);
    this.held.set(note, voice);
  }

  noteOff(note, t = this.ctx.currentTime) {
    const voice = this.held.get(note);
    if (!voice) return;
    this.held.delete(note);
    voice.release(t);
  }

  allOff() {
    for (const note of [...this.held.keys()]) this.noteOff(note);
  }

  // Out of voices: sacrifice the oldest one already fading out, else the oldest held.
  steal(t) {
    let victim = null;
    for (const v of this.voices) {
      if (v.released) { victim = v; break; }
    }
    if (!victim) victim = this.voices.values().next().value;
    victim.kill(t);
    this.voices.delete(victim);
    if (this.held.get(victim.note) === victim) this.held.delete(victim.note);
  }

  // A slider moved: apply it to the voices that are sounding right now.
  set(key, value) {
    this.params[key] = value;
    // Changing a slot's source or destination means re-plugging the cables.
    if (/^mod\d+\.(src|dst)$/.test(key)) for (const v of this.voices) v.connectMods();
    this.applyAll();
  }

  // Replace the whole patch at once.
  loadPatch(patch) {
    Object.assign(this.params, patch);
    for (const v of this.voices) v.connectMods();
    this.applyAll();
  }

  applyAll() {
    setParam(this.ctx, this.volume.gain, this.params.volume, true);
    this.applyChorus();
    this.applyLfos();
    for (const v of this.voices) v.update(this.params, true);
  }

  // Build the chorus the first time it is turned up; take it out again at zero, so an
  // instrument without chorus costs nothing. Its dry path has no delay, so plugging it
  // in or out does not click. (Pages that don't load effects.js simply have no chorus.)
  applyChorus() {
    const amount = this.params["fx.chorus"] || 0;
    if (amount > 0 && !this.chorus && typeof Chorus !== "undefined") {
      this.chorus = new Chorus(this.ctx);
      this.input.disconnect(this.volume);
      this.input.connect(this.chorus.input);
      this.chorus.output.connect(this.volume);
    } else if (amount <= 0 && this.chorus) {
      this.input.disconnect(this.chorus.input);
      this.input.connect(this.volume);
      this.chorus.dispose();
      this.chorus = null;
    }
    if (this.chorus) this.chorus.set(amount);
  }

  applyLfos() {
    this.lfos.forEach((lfo, i) => lfo.set(this.params[`lfo${i + 1}.shape`], this.params[`lfo${i + 1}.rate`]));
  }
}

// Shared end of the chain for all instruments.
class MasterBus {
  constructor(ctx) {
    this.input = ctx.createGain();

    // A compressor set very hard acts as a safety limiter: it only kicks in on peaks.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    // The analyser does not change the sound: it lets the page draw it.
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.8;

    this.input.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }
}

// Four seconds of white, pink and brown noise, computed once.
// - white: pure random samples, equal energy at every frequency (bright, hissy)
// - pink: white noise filtered to lose 3 dB per octave (balanced, like rain)
// - brown: white noise integrated, i.e. each sample = previous + a small random step
//   (deep rumble). We loop these buffers, so the end is crossfaded into the start to
//   avoid a click at the loop point.
function makeNoiseBuffers(ctx) {
  const sr = ctx.sampleRate;
  const len = sr * 4;
  const fade = 4096;
  const buffers = {};
  for (const color of ["white", "pink", "brown"]) {
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "white") {
        raw[i] = w;
      } else if (color === "pink") {
        // Paul Kellet's pink filter: a sum of first-order filters at different speeds.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02; // the /1.02 slowly pulls it back to 0
        raw[i] = last;
      }
    }
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    // Seamless loop: the first samples blend from the "continuation" of the end.
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = raw[i] * k + raw[len + i] * (1 - k);
    }
    // Same loudness (RMS) for the three colors.
    let sum = 0;
    for (let i = 0; i < len; i++) sum += d[i] * d[i];
    const gain = 0.25 / Math.sqrt(sum / len);
    for (let i = 0; i < len; i++) d[i] *= gain;
    buffers[color] = buf;
  }
  return buffers;
}
