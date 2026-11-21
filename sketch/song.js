// The data of a sketch: a project holds four tracks, each with 8 clip slots, and 8 scenes
// (a scene = one row of slots, launched together). Everything is plain JSON, so it can be
// saved in localStorage and exported as a file as is.
//
//   project = { id, name, bpm, swing, key, scale, chromatic, metronome, quantize,
//               scenes: ["Intro", "", …],                 8 names (may be empty)
//               tracks: [{ id, name, sound, volume, clips: [clip | null × 8] }] }
//   clip    = { name, bars: 1 | 2 | 4, notes: [{ p, s, l, v }] }
//
// A note: p = MIDI pitch (for drums, the General MIDI drum note: 36 kick, 38 snare…),
// s = start and l = length in 16th notes from the start of the clip, v = velocity 0..1.
// Starts are whole numbers when quantized, fractions when recorded loose.

const STEPS_PER_BAR = 16;
const SLOTS = 8;

// The tracks, always these four. `sound` is a patch name of ../synth/patches.js.
const TRACK_DEFS = [
  { id: "drums", name: "Drums", drums: true },
  { id: "bass", name: "Bass", sound: "Bass", low: 31 },
  { id: "keys", name: "Keys", sound: "Keys", low: 53 },
  { id: "pad", name: "Pad", sound: "Pad", low: 48 },
];

// Drum lanes, top to bottom, with their General MIDI notes (what Ableton's Drum Racks expect).
const DRUM_LANES = [
  { p: 46, name: "Open hat" },
  { p: 42, name: "Hat" },
  { p: 37, name: "Rim" },
  { p: 39, name: "Clap" },
  { p: 38, name: "Snare" },
  { p: 36, name: "Kick" },
];

// Scales as semitones above the key note.
const SKETCH_SCALES = {
  major: { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { name: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
  lydian: { name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11] },
  phrygian: { name: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  harmonic: { name: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  pentaMajor: { name: "Major pentatonic", steps: [0, 2, 4, 7, 9] },
  pentaMinor: { name: "Minor pentatonic", steps: [0, 3, 5, 7, 10] },
};

const Scale = {
  steps(project) { return (SKETCH_SCALES[project.scale] || SKETCH_SCALES.minor).steps; },
  has(project, pitch) { return this.steps(project).includes((pitch - project.key + 120) % 12); },
  isRoot(project, pitch) { return (pitch - project.key + 120) % 12 === 0; },
  // Scale degree (0 = the key note in octave −1, can be any integer) → MIDI pitch.
  pitch(project, degree) {
    const st = this.steps(project), n = st.length;
    const oct = Math.floor(degree / n);
    return project.key + 12 * oct + st[((degree % n) + n) % n];
  },
  // The degree of the first scale note at or above `pitch`.
  degreeAt(project, pitch) {
    let d = Math.floor(((pitch - project.key) / 12) * this.steps(project).length) - 2;
    while (this.pitch(project, d) < pitch) d++;
    return d;
  },
};

function newClip(bars = 2, name = "") { return { name, bars, notes: [] }; }

function newProject(name = "Untitled") {
  return {
    id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    bpm: 96, swing: 0, key: 9, scale: "minor", chromatic: false, metronome: false, quantize: true,
    scenes: Array(SLOTS).fill(""),
    tracks: TRACK_DEFS.map((d) => ({
      id: d.id, name: d.name, sound: d.sound || "", volume: 0.8, clips: Array(SLOTS).fill(null),
    })),
  };
}

// A project read from storage or from an imported file: fill gaps, drop nonsense.
function cleanProject(raw) {
  const p = newProject();
  if (!raw || typeof raw !== "object") return p;
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  p.id = typeof raw.id === "string" ? raw.id : p.id;
  p.name = String(raw.name || "Untitled").slice(0, 60);
  p.bpm = num(raw.bpm, 60, 160, 96);
  p.swing = num(raw.swing, 0, 1, 0);
  p.key = Math.round(num(raw.key, 0, 11, 9));
  p.scale = SKETCH_SCALES[raw.scale] ? raw.scale : "minor";
  p.chromatic = !!raw.chromatic;
  p.metronome = !!raw.metronome;
  p.quantize = raw.quantize !== false;
  if (Array.isArray(raw.scenes)) p.scenes = p.scenes.map((s, i) => String(raw.scenes[i] || "").slice(0, 24));
  p.tracks.forEach((t, i) => {
    const r = raw.tracks && raw.tracks[i];
    if (!r) return;
    if (typeof r.sound === "string" && (TRACK_DEFS[i].drums || STARTER_PATCHES[r.sound])) t.sound = TRACK_DEFS[i].drums ? "" : r.sound;
    t.volume = num(r.volume, 0, 1, 0.8);
    t.clips = t.clips.map((_, j) => cleanClip(r.clips && r.clips[j]));
  });
  return p;
}

function cleanClip(c) {
  if (!c || typeof c !== "object") return null;
  const bars = [1, 2, 4].includes(+c.bars) ? +c.bars : 2;
  const len = bars * STEPS_PER_BAR;
  const notes = (Array.isArray(c.notes) ? c.notes : [])
    .map((n) => ({ p: Math.round(+n.p), s: +n.s, l: +n.l, v: +n.v }))
    .filter((n) => n.p >= 0 && n.p <= 127 && n.s >= 0 && n.s < len && n.l > 0 && n.v > 0)
    .map((n) => ({ ...n, l: Math.min(n.l, len), v: Math.min(1, n.v) }));
  return { name: String(c.name || "").slice(0, 24), bars, notes };
}

// ---- Clip edits (they change the clip in place) ----

const ClipOps = {
  copy(clip) { return JSON.parse(JSON.stringify(clip)); },
  length(clip) { return clip.bars * STEPS_PER_BAR; },

  // Twice as long, the notes played again in the second half (max 4 bars).
  double(clip) {
    if (clip.bars >= 4) return false;
    const len = this.length(clip);
    clip.notes = clip.notes.concat(clip.notes.map((n) => ({ ...n, s: n.s + len })));
    clip.bars *= 2;
    return true;
  },

  // Change the length: notes past the new end are dropped, longer clips start empty.
  setBars(clip, bars) {
    clip.bars = bars;
    const len = this.length(clip);
    clip.notes = clip.notes.filter((n) => n.s < len);
    for (const n of clip.notes) n.l = Math.min(n.l, len - n.s);
  },

  transpose(clip, semis) {
    for (const n of clip.notes) n.p = Math.min(127, Math.max(0, n.p + semis));
  },

  // Starts on the 16th grid, lengths a whole number of 16ths (at least one).
  quantize(clip) {
    const len = this.length(clip);
    for (const n of clip.notes) {
      n.s = Math.round(n.s) % len;
      n.l = Math.max(1, Math.round(n.l));
    }
    // Two notes of the same pitch on the same step: keep the louder.
    const seen = new Map();
    for (const n of clip.notes) {
      const k = n.p * 1000 + n.s;
      if (!seen.has(k) || seen.get(k).v < n.v) seen.set(k, n);
    }
    clip.notes = [...seen.values()];
  },

  sort(clip) { clip.notes.sort((a, b) => a.s - b.s || a.p - b.p); },
};

// ---- Storage: every project in one localStorage entry, autosaved ----

const SKETCH_KEY = "drifton.sketch.v1";

const ProjectStore = {
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SKETCH_KEY));
      if (raw && Array.isArray(raw.projects) && raw.projects.length) {
        const projects = raw.projects.map(cleanProject);
        const current = projects.find((p) => p.id === raw.current) || projects[0];
        return { current: current.id, projects };
      }
    } catch {}
    return null; // nothing saved yet (or storage blocked): the page makes the demo
  },
  save(state) {
    try { localStorage.setItem(SKETCH_KEY, JSON.stringify(state)); return true; } catch { return false; }
  },
};
