// Playing a song like a guitarist: each chord lasts its real number of beats, and with an
// arrangement it is strummed following my pattern.
//
// - GuitarSound: the plucked string of the Chords game (../chords/pluck.js), as a sound
//   for the songbook, with notes that stop when the next stroke comes.
// - SongSound: piano, synth pad or guitar, behind one `note()`.
// - SheetPlayer: the progression player (../progressions/player.js) with chords of
//   different lengths (`voicing.beats`) and strummed patterns (`voicing.pattern`).

class GuitarSound {
  constructor(ctx) {
    this.ctx = ctx;
    this.pluck = new PluckSound(ctx);
    this.live = new Set(); // sources playing or scheduled, to stop them all at once
  }

  setVolume(v) { this.pluck.setVolume(v); }

  // One string at audio time t, damped after `length` seconds (the hand mutes it, or the
  // next stroke takes over).
  note(pitch, velocity, t, length) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.pluck.buffer(pitch);
    const g = ctx.createGain();
    g.gain.setValueAtTime(velocity, t);
    g.gain.setTargetAtTime(0, t + length, 0.04);
    src.connect(g).connect(this.pluck.out);
    src.start(t);
    src.stop(t + length + 0.3);
    this.live.add(src);
    src.onended = () => { this.live.delete(src); g.disconnect(); };
  }

  mute(t) { this.pluck.mute(t); }

  stopAll() {
    for (const src of this.live) { try { src.stop(); } catch {} }
    this.live.clear();
  }
}

class SongSound {
  constructor(ctx) {
    this.chords = new ChordSound(ctx); // piano and synth pad
    this.guitar = new GuitarSound(ctx);
    this.kind = "piano";
  }
  setKind(kind) {
    this.stopAll();
    this.kind = kind;
    if (kind !== "guitar") this.chords.setKind(kind);
  }
  setVolume(v) { this.chords.setVolume(v); this.guitar.setVolume(v); }
  note(pitch, velocity, t, length, role) {
    if (this.kind === "guitar") this.guitar.note(pitch, velocity, t, length);
    else this.chords.note(pitch, velocity, t, length, role);
  }
  // A muted stroke ("x"): a dead click on the guitar, nothing on the others.
  mute(t) { if (this.kind === "guitar") this.guitar.mute(t); }
  stopAll() { this.chords.stopAll(); this.guitar.stopAll(); }
}

// The strokes of a strum pattern that fall inside one chord, in beats from its start.
// pattern: slots over a bar of `barBeats` beats; at: the beat of the bar the chord starts
// on; beats: its length. Returns [{ start, slot, stroke }].
function strokesIn(pattern, barBeats, at, beats) {
  const step = barBeats / pattern.length;
  const out = [];
  for (let k = Math.ceil(at / step - 1e-6); k * step < at + beats - 1e-6; k++) {
    const stroke = pattern[k % pattern.length];
    if (stroke) out.push({ start: k * step - at, slot: k % pattern.length, stroke });
  }
  return out;
}

// The notes of a strummed chord. voicing: { bass, notes } low to high (one per string).
// Down = low string first, up = high string first, `gap` beats between two strings.
// Up strokes and strokes off the beat are lighter; an up stroke catches the high strings.
function strumEvents(voicing, pattern, barBeats, at, beats, gap) {
  const strings = [voicing.bass, ...voicing.notes];
  const strokes = strokesIn(pattern, barBeats, at, beats);
  const ev = [];
  strokes.forEach((s, i) => {
    const end = i + 1 < strokes.length ? strokes[i + 1].start : beats;
    const length = Math.max(0.2, end - s.start) * 0.98;
    if (s.stroke === "x") { ev.push({ mute: true, start: s.start }); return; }
    const up = /u/i.test(s.stroke);
    const soft = s.stroke === "d" || s.stroke === "u";
    const onBeat = Math.abs((at + s.start) % 1) < 1e-6;
    let vel = (up ? 0.42 : 0.6) * (onBeat ? 1 : 0.85) * (soft ? 0.7 : 1);
    if (Math.abs((at + s.start) % barBeats) < 1e-6) vel *= 1.12; // the first beat of the bar
    const order = up ? strings.slice(-4).reverse() : strings;
    order.forEach((pitch, k) => ev.push({
      pitch, start: s.start + k * gap, length: length - k * gap, velocity: vel * (k === 0 || up ? 1 : 0.92),
      role: pitch === voicing.bass ? "bass" : "chord",
    }));
  });
  return ev;
}

class SheetPlayer extends ProgressionPlayer {
  // Same loop as ProgressionPlayer.tick, but each chord has its own length, and a chord
  // with a strum pattern is strummed. A voicing may also be a silence (`rest`).
  tick() {
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now + 0.05; // the tab slept: don't play a backlog
    while (this.next < now + AHEAD) {
      const i = this.index % this.voicings.length;
      const v = this.voicings[i];
      const beat = 60 / this.bpm;
      const beats = v.beats || this.beats;
      if (!v.rest) {
        const events = v.pattern && this.rhythm === "strum"
          ? strumEvents(v, v.pattern, v.barBeats || 4, v.at || 0, beats, 0.014 / beat)
          : chordEvents(v, this.rhythm === "strum" ? "pulse" : this.rhythm, beats);
        for (const e of events) {
          if (e.mute) this.sound.mute(this.next + e.start * beat);
          else this.sound.note(e.pitch, e.velocity, this.next + e.start * beat, e.length * beat, e.role);
        }
      }
      this.marks.push({ t: this.next, index: i, voicing: v });
      this.next += beats * beat;
      this.index = i + 1;
    }
    this.marks = this.marks.filter((m, k) => k >= this.marks.length - 3 || m.t > now - 10);
  }
}
