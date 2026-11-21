// Every synth parameter in one place: its range, default value, how the slider maps
// to it and how it is displayed. The UI is generated from this list.
// A "patch" (a sound) is simply an object { key: value } for all these keys.

const WAVES = [
  { value: "sine", label: "Sine" },
  { value: "triangle", label: "Tri" },
  { value: "sawtooth", label: "Saw" },
  { value: "square", label: "Square" },
];

const FILTER_TYPES = [
  { value: "lowpass", label: "LP" },
  { value: "highpass", label: "HP" },
  { value: "bandpass", label: "BP" },
  { value: "notch", label: "Notch" },
];

const NOISE_COLORS = [
  { value: "white", label: "White" },
  { value: "pink", label: "Pink" },
  { value: "brown", label: "Brown" },
];

const LFO_SHAPES = [
  { value: "sine", label: "Sine" },
  { value: "triangle", label: "Tri" },
  { value: "sawtooth", label: "Saw" },
  { value: "square", label: "Sq" },
  { value: "drift", label: "Drift" },
  { value: "sh", label: "S&H" },
];

const MOD_SOURCES = [
  { value: "off", label: "Off" },
  { value: "lfo1", label: "LFO 1" },
  { value: "lfo2", label: "LFO 2" },
];

// What a modulation slot can move. The scale of each one is in voice.js (modTargets).
const MOD_DESTS = [
  { value: "cutoff", label: "Filter cutoff" },
  { value: "pitch", label: "Pitch" },
  { value: "detune", label: "Unison detune" },
  { value: "amp", label: "Volume" },
  { value: "pan", label: "Pan" },
];

const MOD_SLOTS = 4;

// One oscillator's controls; `p` is the key prefix ("a" or "b").
function oscParams(p, d) {
  return [
    { key: `${p}.wave`, label: "Wave", type: "choice", options: WAVES, value: d.wave },
    { key: `${p}.octave`, label: "Octave", min: -3, max: 3, step: 1, value: d.octave, unit: "signed" },
    { key: `${p}.semi`, label: "Semitones", min: -12, max: 12, step: 1, value: 0, unit: "signed" },
    { key: `${p}.fine`, label: "Fine", min: -100, max: 100, step: 1, value: 0, unit: "ct" },
    { key: `${p}.unison`, label: "Unison", min: 1, max: 7, step: 1, value: d.unison },
    { key: `${p}.spread`, label: "Detune", min: 0, max: 60, step: 0.5, value: d.spread, unit: "ct" },
    { key: `${p}.width`, label: "Width", min: 0, max: 1, step: 0.01, value: d.width, unit: "%" },
    { key: `${p}.level`, label: "Level", min: 0, max: 1, step: 0.01, value: d.level, unit: "%" },
  ];
}

// ADSR controls; times use a logarithmic slider so short values stay precise.
function envParams(p, d) {
  return [
    { key: `${p}.attack`, label: "Attack", min: 0.002, max: 12, curve: "log", value: d.a, unit: "s" },
    { key: `${p}.decay`, label: "Decay", min: 0.01, max: 12, curve: "log", value: d.d, unit: "s" },
    { key: `${p}.sustain`, label: "Sustain", min: 0, max: 1, step: 0.01, value: d.s, unit: "%" },
    { key: `${p}.release`, label: "Release", min: 0.01, max: 15, curve: "log", value: d.r, unit: "s" },
  ];
}

function lfoParams(p, d) {
  return [
    { key: `${p}.shape`, label: "Shape", type: "choice", options: LFO_SHAPES, value: d.shape },
    { key: `${p}.rate`, label: "Rate", min: 0.01, max: 20, curve: "log", value: d.rate, unit: "Hz" },
  ];
}

// Each modulation slot: source → destination, with an amount (negative = inverted).
function modParams(defaults) {
  return defaults.flatMap((d, i) => [
    { key: `mod${i + 1}.src`, label: "Source", type: "select", options: MOD_SOURCES, value: d[0] },
    { key: `mod${i + 1}.dst`, label: "Destination", type: "select", options: MOD_DESTS, value: d[1] },
    { key: `mod${i + 1}.amount`, label: "Amount", min: -1, max: 1, step: 0.01, value: d[2], unit: "spct" },
  ]);
}

const PARAM_GROUPS = [
  {
    title: "Oscillator A",
    help: "Unison stacks several copies of the oscillator, slightly detuned and spread in stereo. Unison count applies to new notes.",
    params: oscParams("a", { wave: "sawtooth", octave: 0, unison: 5, spread: 14, width: 0.7, level: 0.7 }),
  },
  {
    title: "Oscillator B",
    help: "A second oscillator, often an octave below to add weight.",
    params: oscParams("b", { wave: "triangle", octave: -1, unison: 1, spread: 0, width: 0, level: 0.4 }),
  },
  {
    title: "Noise",
    help: "Breath and air under the tone. White is harsh, pink is balanced, brown is deep (like a distant waterfall). Color applies to new notes.",
    params: [
      { key: "noise.color", label: "Color", type: "choice", options: NOISE_COLORS, value: "pink" },
      { key: "noise.level", label: "Level", min: 0, max: 1, step: 0.01, value: 0.06, unit: "%" },
    ],
  },
  {
    title: "Filter",
    help: "Removes part of the spectrum. Env amount: how many octaves the filter envelope opens the cutoff.",
    params: [
      { key: "filter.type", label: "Type", type: "choice", options: FILTER_TYPES, value: "lowpass" },
      { key: "filter.cutoff", label: "Cutoff", min: 30, max: 18000, curve: "log", value: 900, unit: "Hz" },
      { key: "filter.res", label: "Resonance", min: 0, max: 1, step: 0.01, value: 0.2, unit: "%" },
      { key: "filter.env", label: "Env amount", min: -4, max: 6, step: 0.1, value: 2.5, unit: "oct" },
    ],
  },
  {
    title: "Filter envelope",
    env: "fenv",
    params: envParams("fenv", { a: 1.5, d: 3, s: 0.3, r: 3 }),
  },
  {
    title: "Amp envelope",
    env: "amp",
    params: envParams("amp", { a: 0.8, d: 1.5, s: 0.85, r: 3 }),
  },
  {
    title: "LFO 1",
    lfo: 0,
    help: "Drift: glides to a new random value at each period, never repeats. 0.1 Hz = one change every 10 s.",
    params: lfoParams("lfo1", { shape: "drift", rate: 0.15 }),
  },
  {
    title: "LFO 2",
    lfo: 1,
    help: "Slow sine: 0.05 Hz = one full cycle every 20 s. Above ~5 Hz it becomes vibrato / tremolo.",
    params: lfoParams("lfo2", { shape: "sine", rate: 0.06 }),
  },
  {
    title: "Modulation",
    matrix: true,
    help: "Plug an LFO into a parameter. Several slots can share a source or a destination; they add up.",
    params: modParams([
      ["lfo1", "cutoff", 0.25],
      ["lfo2", "pan", 0.3],
      ["lfo1", "detune", 0.4],
      ["off", "pitch", 0],
    ]),
  },
  {
    title: "Effects",
    help: "This instrument's own effects, used wherever it plays (Focus music too). Chorus: copies of the sound, slightly out of tune, on both sides: wider and shimmering. Reverb and Echo: how much of it goes to the shared room and echo.",
    params: [
      { key: "fx.chorus", label: "Chorus", min: 0, max: 1, step: 0.01, value: 0, unit: "%" },
      { key: "fx.reverb", label: "Reverb", min: 0, max: 1, step: 0.01, value: 0.4, unit: "%" },
      { key: "fx.delay", label: "Echo", min: 0, max: 1, step: 0.01, value: 0.15, unit: "%" },
    ],
  },
  {
    title: "Output",
    params: [
      { key: "volume", label: "Volume", min: 0, max: 1, step: 0.01, value: 0.7, unit: "%" },
    ],
  },
];

function allParamDefs() {
  return PARAM_GROUPS.flatMap((g) => g.params);
}

function defaultParams() {
  const p = {};
  for (const def of allParamDefs()) p[def.key] = def.value;
  return p;
}

// Read the four ADSR values of an envelope out of a patch.
function envFrom(p, prefix) {
  return {
    attack: p[`${prefix}.attack`],
    decay: p[`${prefix}.decay`],
    sustain: p[`${prefix}.sustain`],
    release: p[`${prefix}.release`],
  };
}

function formatValue(def, v) {
  switch (def.unit) {
    case "%": return Math.round(v * 100) + "%";
    case "spct": return (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
    case "Hz":
      if (v < 1) return v.toFixed(2) + " Hz";
      if (v < 10) return v.toFixed(1) + " Hz";
      return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " kHz" : Math.round(v) + " Hz";
    case "s": return v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(v < 10 ? 2 : 1) + " s";
    case "ct": return Math.round(v) + " ct";
    case "oct": return (v > 0 ? "+" : "") + v.toFixed(1) + " oct";
    case "signed": return (v > 0 ? "+" : "") + v;
    default: return String(v);
  }
}
