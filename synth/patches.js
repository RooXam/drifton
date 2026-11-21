// Starter sounds, one per instrument. Each patch only lists what differs from the
// defaults in params.js; makePatch fills in the rest.
// "fx.reverb" / "fx.delay": how much each one sends to the room and the echo (the mix
// Focus music always used). A sound saved before these existed gets them from here,
// so it keeps sounding the same.

const STARTER_PATCHES = {
  // Warm and soft: detuned triangles (much gentler than saws) through a low filter that
  // barely opens (a filter sweeping wide on every chord sounds harsh), a quiet sine an
  // octave below for body, slow attack and release, and a slow drift on the cutoff so it
  // breathes. Not too dark or too much sub: phone speakers play almost nothing below
  // 300 Hz, and a pad living down there disappears on them.
  Pad: {
    "fx.reverb": 0.45, "fx.delay": 0.08,
    "a.wave": "triangle", "a.unison": 5, "a.spread": 12, "a.level": 0.6,
    "b.wave": "sine", "b.octave": -1, "b.level": 0.3,
    "noise.level": 0.025,
    "filter.cutoff": 1000, "filter.res": 0.08, "filter.env": 0.6,
    "fenv.attack": 3, "fenv.decay": 4, "fenv.sustain": 0.5, "fenv.release": 4,
    "amp.attack": 2.5, "amp.decay": 2, "amp.sustain": 0.9, "amp.release": 5,
    "lfo1.rate": 0.08,
    "mod1.amount": 0.18,
  },

  // Round and soft: a triangle an octave down and a sine two octaves down, a low filter
  // that barely opens, and an attack of a few tens of milliseconds so the note swells in
  // instead of clicking (on small speakers you hear the attack, not the low end).
  Bass: {
    "fx.reverb": 0.12, "fx.delay": 0,
    "a.wave": "triangle", "a.octave": -1, "a.unison": 1, "a.spread": 0, "a.width": 0, "a.level": 0.55,
    "b.wave": "sine", "b.octave": -2, "b.level": 0.75,
    "noise.level": 0,
    "filter.cutoff": 300, "filter.res": 0.1, "filter.env": 0.7,
    "fenv.attack": 0.06, "fenv.decay": 0.9, "fenv.sustain": 0.35, "fenv.release": 0.6,
    "amp.attack": 0.07, "amp.decay": 0.6, "amp.sustain": 0.85, "amp.release": 0.6,
    "lfo1.rate": 0.1,
    "mod1.amount": 0.1, "mod2.src": "off", "mod3.src": "off",
  },

  // Bell-like: pure sines, instant attack, sustain at 0 so the note dies away on its own.
  // Osc B is a quiet sine a fifth above.
  Bells: {
    "fx.reverb": 0.6, "fx.delay": 0.45,
    "a.wave": "sine", "a.octave": 1, "a.unison": 1, "a.spread": 0, "a.width": 0, "a.level": 0.7,
    "b.wave": "sine", "b.octave": 0, "b.semi": 7, "b.level": 0.15,
    "noise.level": 0,
    "filter.cutoff": 6000, "filter.res": 0, "filter.env": 0,
    "amp.attack": 0.003, "amp.decay": 2.5, "amp.sustain": 0, "amp.release": 2.5,
    "lfo2.rate": 5,
    "mod1.src": "off",
    "mod2.dst": "pitch", "mod2.amount": 0.04,
    "mod3.dst": "pan", "mod3.amount": 0.5,
    volume: 0.6,
  },

  // A soft "felt piano": a sine with a quiet triangle an octave up, struck (instant
  // attack, no sustain: the note dies away on its own), the filter closing as it fades.
  Keys: {
    "fx.reverb": 0.45, "fx.delay": 0.32,
    "a.wave": "sine", "a.octave": 0, "a.unison": 1, "a.spread": 0, "a.width": 0, "a.level": 0.75,
    "b.wave": "triangle", "b.octave": 1, "b.unison": 1, "b.level": 0.16,
    "noise.level": 0,
    "filter.cutoff": 1500, "filter.res": 0.05, "filter.env": 1.6,
    "fenv.attack": 0.002, "fenv.decay": 0.7, "fenv.sustain": 0, "fenv.release": 0.8,
    "amp.attack": 0.004, "amp.decay": 2.4, "amp.sustain": 0, "amp.release": 1.4,
    "mod1.src": "off", "mod3.src": "off",
    "mod2.dst": "pan", "mod2.amount": 0.25,
    volume: 0.6,
  },

  // Mostly noise through a narrow band-pass filter that drifts around: wind, air.
  Texture: {
    "fx.reverb": 0.5, "fx.delay": 0.1,
    "a.unison": 7, "a.spread": 40, "a.width": 1, "a.level": 0.15,
    "b.level": 0,
    "noise.color": "pink", "noise.level": 0.8,
    "filter.type": "bandpass", "filter.cutoff": 1200, "filter.res": 0.6, "filter.env": 0,
    "amp.attack": 3, "amp.decay": 2, "amp.sustain": 1, "amp.release": 6,
    "lfo1.rate": 0.3, "lfo2.rate": 0.05,
    "mod1.amount": 0.5,
    "mod2.amount": 0.6,
    "mod3.dst": "amp", "mod3.amount": 0.4,
    volume: 0.6,
  },
};

function makePatch(name) {
  return { ...defaultParams(), ...STARTER_PATCHES[name] };
}
