// Plays a song: keeps the position, schedules the notes a moment ahead on the audio clock
// (same idea as the generator), handles the speed and the loop between two points.
//
// The position is where we are in the song, in seconds at the original tempo. At 50%
// speed it moves half as fast as the audio clock.

const LOOKAHEAD = 0.25; // seconds of audio scheduled in advance
const LEAD_IN = 2;      // start a little before the first note, so it has time to fall

class Player {
  constructor(ctx, sound) {
    this.ctx = ctx;
    this.sound = sound;
    this.song = null;
    this.speed = 1;
    this.playing = false;
    this.pos = -LEAD_IN;                     // position while paused
    this.loop = { on: false, a: 0, b: 0 };   // loop from a to b (seconds)
    this.anchors = [];  // { time, pos }: "at audio time `time`, the position was `pos`"
    this.cursor = null; // how far the notes are scheduled: { time, pos, index }
    this.timer = null;
    this.onEnd = null;
    this.click = null;      // a Click (metronome.js), set by the page
    this.metronome = false; // click on every beat while playing
    this.countIn = 0;       // bars of clicks before playing starts (0, 1, 2)
    this.countSpan = null;  // { start, end, beat } audio times of the count-in under way
  }

  load(song) {
    this.pause();
    this.song = song;
    this.pos = -LEAD_IN;
    this.loop = { on: false, a: 0, b: song.duration };
    // Bar starts, to accent the first beat of each bar.
    this.barSet = new Set(song.bars.map((t) => t.toFixed(3)));
  }

  // Current position in the song.
  position(now = this.ctx.currentTime) {
    if (!this.playing) return this.pos;
    // When the loop jumps back, a new anchor is added; use the latest one already reached.
    while (this.anchors.length > 1 && this.anchors[1].time <= now) this.anchors.shift();
    const a = this.anchors[0];
    return a.pos + (now - a.time) * this.speed;
  }

  play() {
    if (!this.song || this.playing) return;
    const { a, b, on } = this.loop;
    let p = this.pos;
    if (on && (p < a - LEAD_IN || p >= b)) p = a - 1; // 1 second before the loop
    if (!on && p >= this.song.duration) p = -LEAD_IN;
    if (this.countIn && this.click) this.startWithCountIn(p);
    else this.startAt(p);
  }

  // Count-in: start on a beat (the one just before p, or the first), and before it play
  // `countIn` bars of clicks. The notes keep falling meanwhile: the position runs from
  // before that beat, so the music starts right after the last click.
  startWithCountIn(p) {
    const beats = this.song.beats;
    let i = Math.max(0, this.beatAt(p + 0.05) - 1);
    if (!beats.length || beats[i] > p + 0.05) i = 0;
    const from = beats.length ? beats[i] : Math.max(0, p);
    const beat = beats.length > i + 1 ? beats[i + 1] - beats[i] : 60 / this.song.bpm;
    const perBar = Number(this.song.meter.split("/")[0]) || 4;
    const count = this.countIn * perBar;
    const step = beat / this.speed; // seconds of audio per beat
    const t0 = this.ctx.currentTime + 0.08;
    for (let k = 0; k < count; k++) this.click.play(t0 + k * step, k % perBar === 0);
    this.countSpan = { start: t0, end: t0 + count * step, beat: step };
    this.startAt(from, count * step + 0.08 - 0.05);
  }

  // Silence now: the notes and the clicks scheduled ahead.
  silence() {
    this.sound.stopAll();
    if (this.click) this.click.stopAll();
    this.countSpan = null;
  }

  pause() {
    if (!this.playing) return;
    this.pos = this.position();
    this.playing = false;
    clearInterval(this.timer);
    this.silence();
  }

  seek(p) {
    if (!this.song) return;
    p = Math.max(-LEAD_IN, Math.min(this.song.duration, p));
    if (this.playing) {
      this.silence();
      this.startAt(p);
    } else {
      this.pos = p;
    }
  }

  setSpeed(speed) {
    if (this.playing) {
      const p = this.position(); // measured at the old speed
      this.speed = speed;
      this.silence();
      this.startAt(p);
    } else {
      this.speed = speed;
    }
  }

  setLoop(a, b) {
    a = Math.max(0, a);
    b = Math.min(this.song.duration, Math.max(b, a + 0.5));
    this.loop = { on: true, a, b };
  }

  // Play from position p, `delay` seconds from now (a count-in).
  startAt(p, delay = 0) {
    const t = this.ctx.currentTime + 0.05 + delay;
    this.playing = true;
    this.anchors = [{ time: t, pos: p }];
    this.cursor = { time: t, pos: p, index: this.indexAt(p), beat: this.beatAt(p) };
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 50);
    this.tick();
  }

  // Index of the first beat at or after p.
  beatAt(p) {
    return lowerIndex(this.song.beats, (t) => t < p - 1e-6);
  }

  // Index of the first note starting at or after p (binary search: notes are sorted).
  indexAt(p) {
    return lowerIndex(this.song.notes, (n) => n.start < p);
  }

  // Every 50 ms: schedule the notes (and metronome clicks) of the next LOOKAHEAD seconds.
  tick() {
    const song = this.song, now = this.ctx.currentTime, c = this.cursor;
    if (!this.loop.on && this.position(now) >= song.duration + 0.5) {
      this.pause();
      this.pos = song.duration;
      if (this.onEnd) this.onEnd();
      return;
    }
    const horizon = now + LOOKAHEAD;
    while (c.time < horizon) {
      const loopEnd = this.loop.on ? this.loop.b : Infinity;
      let to = c.pos + (horizon - c.time) * this.speed; // song position reached at the horizon
      const wrap = to >= loopEnd;
      if (wrap) to = Math.max(c.pos, loopEnd);

      const notes = song.notes;
      while (c.index < notes.length && notes[c.index].start < to) {
        const n = notes[c.index++];
        if (n.start < c.pos || !song.parts[n.part].audible) continue;
        const t = c.time + (n.start - c.pos) / this.speed;
        const length = (Math.min(n.soundEnd, loopEnd) - n.start) / this.speed;
        this.sound.play(n.pitch, n.velocity, t, length);
      }

      // Metronome: a click on each beat in this stretch, accented on bar lines.
      const beats = song.beats;
      while (c.beat < beats.length && beats[c.beat] < to) {
        const b = beats[c.beat++];
        if (!this.metronome || !this.click || b < c.pos - 1e-6) continue;
        this.click.play(c.time + (b - c.pos) / this.speed, this.barSet.has(b.toFixed(3)));
      }

      const t = c.time + (to - c.pos) / this.speed;
      if (wrap) {
        // End of the loop: carry on from its start, at the exact audio time.
        c.time = t;
        c.pos = this.loop.a;
        c.index = this.indexAt(this.loop.a);
        c.beat = this.beatAt(this.loop.a);
        this.anchors.push({ time: t, pos: this.loop.a });
      } else {
        c.time = horizon;
        c.pos = to;
      }
    }
  }
}

// Binary search in a sorted list: index of the first item for which `before` is false.
function lowerIndex(list, before) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (before(list[mid])) lo = mid + 1; else hi = mid;
  }
  return lo;
}
