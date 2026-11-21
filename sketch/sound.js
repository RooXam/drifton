// The instruments of the page: the drum kit and three synths (../synth/), through the
// shared effects (reverb, echo, warmth) and the master bus:
//
//   DrumKit ─┐
//   Bass    ─┼─> track volume ─┬─> FxBus (+ reverb / echo sends) ─> MasterBus ─> speakers
//   Keys    ─┤                 │
//   Pad     ─┘   metronome ────┴──────────────────────────────────> MasterBus
//
// Notes from clips are scheduled ahead (at an exact audio time) with their length;
// notes from the pads start now and end when the finger lifts.

// The sketch's own touch on the starter sounds: a sketch moves faster than ambient music,
// so the pad swells in quicker and the keys ring a little shorter.
const SKETCH_TWEAKS = {
  Pad: { "amp.attack": 0.35, "amp.release": 2.2, "fenv.attack": 0.8, "fenv.release": 2, "filter.cutoff": 1300 },
  Keys: { "amp.decay": 1.8, "amp.release": 0.9 },
  // Notes are written at their real pitch (A1–A3, what Live expects of a bass), so the
  // starter bass, made to play an octave or two below its notes, is moved back up.
  Bass: {
    "a.octave": 0, "b.octave": -1, "b.level": 0.6, "filter.cutoff": 520,
    "amp.attack": 0.012, "fenv.attack": 0.02, "amp.release": 0.25,
  },
};

// Per track: reverb and echo sends, and how loud the synth plays at volume 100 %.
const TRACK_MIX = {
  drums: { reverb: 0.12, delay: 0, gain: 1 },
  bass: { reverb: 0.05, delay: 0, gain: 0.9 },
  keys: { reverb: 0.4, delay: 0.25, gain: 0.75 },
  pad: { reverb: 0.5, delay: 0.08, gain: 0.7 },
};

class SketchSound {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = new MasterBus(ctx);
    this.master.input.gain.value = 0.8;
    this.fx = new FxBus(ctx, this.master.input);
    this.fx.setReverb(0.3);
    this.fx.setDelay(0.25);
    this.fx.setWarmth(0.35);
    this.gains = {};
    this.synths = {};
    for (const d of TRACK_DEFS) {
      const g = ctx.createGain();
      g.connect(this.fx.input);
      this.fx.connect(g, TRACK_MIX[d.id].reverb, TRACK_MIX[d.id].delay);
      this.gains[d.id] = g;
      if (d.drums) this.drums = new DrumKit(ctx, g);
      else {
        this.synths[d.id] = new Synth(ctx, this.patch(d.sound), g);
        this.synths[d.id].maxVoices = 12;
      }
    }
    this.click = ctx.createGain();
    this.click.gain.value = 0.35;
    this.click.connect(this.master.input);
  }

  patch(name) {
    return { ...makePatch(name), ...(SKETCH_TWEAKS[name] || {}), volume: 1 };
  }

  setSound(trackId, name) { this.synths[trackId].loadPatch(this.patch(name)); }
  setVolume(trackId, v) { setParam(this.ctx, this.gains[trackId].gain, v * TRACK_MIX[trackId].gain, true); }
  setTempo(bpm) { this.fx.setDelayTime((60 / bpm) * 0.75); } // dotted-eighth echo

  // A note from a clip, at time t, lasting `dur` seconds.
  play(trackId, pitch, velocity, t, dur) {
    if (trackId === "drums") return this.drums.play(pitch, velocity, t);
    const s = this.synths[trackId];
    s.noteOn(pitch, velocity, t);
    const voice = s.held.get(pitch);
    s.held.delete(pitch); // not "held": the pads may play the same pitch meanwhile
    voice.end = t + dur;
    voice.release(t + dur);
  }

  // A clip stops (or another starts) at time t: notes still sounding then fade out.
  cut(trackId, t) {
    const s = this.synths[trackId];
    if (!s) return;
    for (const v of s.voices) {
      if (v.end === undefined || v.end <= t) continue;
      if (v.startTime >= t) { v.kill(t); continue; }
      const rel = Math.min(s.params["amp.release"], 1.5);
      holdAt(v.amp.gain, t);
      v.amp.gain.setTargetAtTime(0, t, rel / 4);
      v.stopSources(t + rel * 1.25);
      v.end = t;
    }
  }

  cutAll(t = this.ctx.currentTime) {
    for (const id in this.synths) this.cut(id, t);
  }

  // Pads: the note starts now and lasts until noteOff.
  liveOn(trackId, pitch, velocity) {
    if (trackId === "drums") return this.drums.play(pitch, velocity);
    this.synths[trackId].noteOn(pitch, velocity);
  }
  liveOff(trackId, pitch) {
    if (trackId !== "drums") this.synths[trackId].noteOff(pitch);
  }

  // Metronome: a short blip, higher on the first beat of the bar.
  tick(t, accent) {
    const o = this.ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1320;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(this.click);
    o.start(t);
    o.stop(t + 0.06);
  }
}
