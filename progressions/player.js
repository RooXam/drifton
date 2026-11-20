// Plays a progression in a loop: one chord per bar (or per `beats` beats), with a rhythm.
//
// Same trick as the generator: a JavaScript timer wakes up often and schedules the
// notes of the next fraction of a second at exact audio-clock times. The timer can be
// late; the audio clock never is, so the rhythm stays tight.

const AHEAD = 0.3; // seconds scheduled in advance

// The notes of one chord for a rhythm, in beats from the start of its bar.
// voicing = { bass, notes } (MIDI numbers). Used to play and to export MIDI.
function chordEvents(voicing, rhythm, beats = 4) {
  const ev = [];
  // Guitar voicings are strummed: each string a little after the one below it.
  const strum = voicing.strum && rhythm !== "arp" ? 0.03 : 0;
  const add = (pitch, start, length, velocity, role) => {
    const k = role === "chord" ? voicing.notes.indexOf(pitch) + 1 : 0;
    ev.push({ pitch, start: start + k * strum, length, velocity, role });
  };
  add(voicing.bass, 0, beats * 0.98, 0.75, "bass");
  const notes = voicing.notes;
  if (rhythm === "held") {
    for (const p of notes) add(p, 0, beats * 0.98, 0.6, "chord");
  } else if (rhythm === "pulse") {
    // A hit on every beat, the first one stronger.
    for (let b = 0; b < beats; b++) for (const p of notes) add(p, b, 0.85, b === 0 ? 0.62 : 0.45, "chord");
  } else if (rhythm === "push") {
    // Laid-back, syncopated: on 1, just before 3, and on the "and" of 4 (hip-hop / R&B feel).
    for (const [b, len, vel] of [[0, 1.4, 0.62], [1.5, 1.3, 0.5], [3.5, 0.45, 0.42]]) {
      if (b < beats) for (const p of notes) add(p, b, Math.min(len, beats - b), vel, "chord");
    }
  } else {
    // Arpeggio in eighth notes: up through the chord, then back down.
    const order = notes.concat(notes.slice(1, -1).reverse());
    for (let i = 0; i < beats * 2; i++) add(order[i % order.length], i / 2, 0.9, i % 2 ? 0.42 : 0.55, "chord");
  }
  return ev;
}

class ProgressionPlayer {
  constructor(ctx, sound) {
    this.ctx = ctx;
    this.sound = sound;
    this.bpm = 80;
    this.beats = 4;     // beats per chord
    this.rhythm = "held";
    this.voicings = []; // one { bass, notes } per chord
    this.running = false;
    this.marks = [];    // { t, index }: when each chord starts, to light it up
  }

  get barSeconds() {
    return (this.beats * 60) / this.bpm;
  }

  setVoicings(voicings) {
    this.voicings = voicings;
  }

  // Start playing, from chord number `from` (0 = the first).
  start(from = 0) {
    if (this.running || !this.voicings.length) return;
    this.running = true;
    this.index = from;
    this.next = this.ctx.currentTime + 0.08;
    this.marks = [];
    this.timer = setInterval(() => this.tick(), 50);
    this.tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.sound.stopAll();
    this.marks = [];
  }

  // Schedule every chord that starts before now + AHEAD.
  tick() {
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now + 0.05; // the tab slept: don't play a backlog
    while (this.next < now + AHEAD) {
      const i = this.index % this.voicings.length;
      const beat = 60 / this.bpm;
      for (const e of chordEvents(this.voicings[i], this.rhythm, this.beats)) {
        this.sound.note(e.pitch, e.velocity, this.next + e.start * beat, e.length * beat, e.role);
      }
      this.marks.push({ t: this.next, index: i, voicing: this.voicings[i] });
      this.next += this.barSeconds;
      this.index = i + 1;
    }
    this.marks = this.marks.filter((m, k) => k >= this.marks.length - 3 || m.t > now - 10);
  }

  // The chord heard at audio time `now`.
  current(now) {
    let found = null;
    for (const m of this.marks) if (m.t <= now) found = m;
    return found;
  }
}
