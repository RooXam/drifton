// Moods: ready-made settings for the whole page, in one tap. Each can be fine-tuned after.
//
// pulse = depth of the amplitude modulation, pulseRate in Hz: Brain.fm uses about 16 Hz
// (the "beta" range of brain waves) for focus; slower rates feel calmer. Kept subtle.
// Auto picks a mood from the time of day, the way Endel follows the day's rhythm.
// tape = worn-cassette wobble and hiss; chords = "sevenths" (lush), "sus" (open, hazy)
// or "drone" (one held open chord);
// riff = the keys repeat one short riff instead of free arpeggios.

const MOODS = {
  focus: {
    label: "Deep focus", help: "Steady and warm, a soft arpeggio, a 16 Hz shimmer for concentration.",
    mode: "dorian", bpm: 72, chordSeconds: 20, density: 0.2, movement: 0.45,
    reverb: 0.35, delay: 0.22, warmth: 0.55, pulse: 0.18, pulseRate: 16, tape: 0.1, chords: "sevenths", riff: false,
  },
  flow: {
    label: "Flow", help: "More movement and light, for getting things done.",
    mode: "mixolydian", bpm: 86, chordSeconds: 12, density: 0.3, movement: 0.72,
    reverb: 0.3, delay: 0.3, warmth: 0.45, pulse: 0.2, pulseRate: 16, tape: 0.05, chords: "sevenths", riff: false,
  },
  calm: {
    label: "Calm", help: "Floating chords, a big room, very little rhythm.",
    mode: "ionian", bpm: 62, chordSeconds: 28, density: 0.35, movement: 0.2,
    reverb: 0.55, delay: 0.35, warmth: 0.6, pulse: 0.1, pulseRate: 8, tape: 0.15, chords: "sevenths", riff: false,
  },
  night: {
    label: "Night", help: "Dark and slow, almost still, to wind down.",
    mode: "aeolian", bpm: 56, chordSeconds: 32, density: 0.15, movement: 0.08,
    reverb: 0.6, delay: 0.25, warmth: 0.78, pulse: 0.06, pulseRate: 4, tape: 0.25, chords: "sevenths", riff: false,
  },
  hazy: {
    label: "Hazy", help: "Worn tape, open sus chords, a riff that keeps coming back. Music has the right to drift.",
    mode: "mixolydian", bpm: 84, chordSeconds: 12, density: 0.12, movement: 0.5,
    reverb: 0.12, delay: 0.38, warmth: 0.7, pulse: 0, pulseRate: 8, tape: 0.75, chords: "sus", riff: true,
  },
  drone: {
    label: "Drone", help: "One open chord held for minutes, no rhythm, a slow filter breathing and a rare bell.",
    mode: "dorian", bpm: 50, chordSeconds: 60, density: 0.06, movement: 0,
    reverb: 0.7, delay: 0.15, warmth: 0.7, pulse: 0, pulseRate: 4, tape: 0.1, chords: "drone", riff: false,
  },
};

// The mood that suits the time of day: morning → flow, afternoon → focus, evening →
// calm, night → night.
function moodForNow(date = new Date()) {
  const h = date.getHours();
  if (h >= 6 && h < 12) return "flow";
  if (h >= 12 && h < 18) return "focus";
  if (h >= 18 && h < 22) return "calm";
  return "night";
}
