// The transport: a clock counting 16th notes, and which clip each track plays.
//
// Timing uses a "lookahead scheduler": every 25 ms a JavaScript timer looks at the 16ths
// that start in the next 150 ms and schedules their notes at exact audio-clock times.
// JS timers are late by a few ms (more when busy); the audio clock never is. The window
// is short so a launch, a tempo change or an edit is heard almost at once.
//
// Launching is quantized: a clip asked for waits for the next bar line, then starts from
// its beginning. One clip per track; asking for another replaces it at the next bar.

const LOOKAHEAD_S = 0.15;

class Transport {
  constructor(ctx, sound, getProject) {
    this.ctx = ctx;
    this.sound = sound;
    this.project = getProject; // a function: the project can be swapped
    this.running = false;
    this.step = 0;        // next 16th to schedule, counted from Play
    this.t0 = 0;          // audio time of 16th number 0
    // Per track: the slot playing (−1 none), the 16th it started on, the slot waiting
    // for the next bar (null nothing, −1 = stop).
    this.tracks = TRACK_DEFS.map(() => ({ playing: -1, start: 0, queued: null }));
    this.fresh = new WeakMap(); // notes just recorded → loop number in which not to replay them
    this.onBar = null;          // called when queued launches happen (to redraw)
  }

  get stepDur() { return 60 / this.project().bpm / 4; }

  // Audio time of a 16th (with swing: every second 16th comes a little late; 100 % swing
  // = a triplet feel, the off-beat at 2/3 of the eighth note).
  timeOf(step) {
    const swing = step % 2 === 1 ? (this.project().swing * this.stepDur) / 3 : 0;
    return this.t0 + step * this.stepDur + swing;
  }

  // Where the transport is at audio time t, in 16ths (a fraction), ignoring swing.
  stepAt(t) { return (t - this.t0) / this.stepDur; }

  start() {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.t0 = this.ctx.currentTime + 0.06;
    // Clips that were playing at Stop, or waiting, start on the first bar.
    for (const tr of this.tracks) {
      if (tr.queued === null && tr.playing >= 0) tr.queued = tr.playing;
      tr.playing = -1;
    }
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.sound.cutAll();
    // Remember what played, so Play starts it again; drop what was only waiting.
    for (const tr of this.tracks) tr.queued = null;
  }

  // The tempo changes while playing: keep the current position, re-time what follows.
  retime(oldStepDur) {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    const pos = (now - this.t0) / oldStepDur;
    this.t0 = now - pos * this.stepDur;
  }

  // ---- Launching ----

  // Stopped: launching a clip starts the transport with that clip alone.
  launch(track, slot) {
    if (!this.running) for (const tr of this.tracks) tr.playing = -1;
    this.tracks[track].queued = slot;
    if (!this.running) this.start();
  }
  stopTrack(track) {
    const tr = this.tracks[track];
    if (!this.running) { tr.playing = -1; tr.queued = null; return; }
    tr.queued = tr.playing >= 0 || tr.queued !== null ? -1 : null;
  }
  launchScene(row) {
    const p = this.project();
    p.tracks.forEach((t, i) => (this.tracks[i].queued = t.clips[row] ? row : -1));
    if (!this.running) this.start();
  }
  stopAll() { this.tracks.forEach((_, i) => this.stopTrack(i)); }

  // ---- Scheduling ----

  tick() {
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    while (this.timeOf(this.step) < horizon) {
      this.schedule(this.step);
      this.step++;
    }
  }

  schedule(step) {
    const p = this.project();
    const t = this.timeOf(step);
    if (step % STEPS_PER_BAR === 0) this.barLine(step, t);
    if (p.metronome && step % 4 === 0) this.sound.tick(t, step % STEPS_PER_BAR === 0);

    this.tracks.forEach((tr, i) => {
      if (tr.playing < 0) return;
      const track = p.tracks[i];
      const clip = track.clips[tr.playing];
      if (!clip) { tr.playing = -1; return; } // deleted while playing
      const len = clip.bars * STEPS_PER_BAR;
      const pos = (step - tr.start) % len;
      const loop = Math.floor((step - tr.start) / len);
      for (const n of clip.notes) {
        if (n.s < pos || n.s >= pos + 1) continue;
        if (this.fresh.get(n) === loop) continue; // just recorded: already heard live
        const at = t + (n.s - pos) * this.stepDur;
        this.sound.play(track.id, n.p, n.v, at, n.l * this.stepDur);
      }
    });
  }

  // At each bar line, clips waiting start (or stop).
  barLine(step, t) {
    let changed = false;
    this.tracks.forEach((tr, i) => {
      if (tr.queued === null) return;
      if (tr.playing >= 0) this.sound.cut(TRACK_DEFS[i].id, t);
      tr.playing = tr.queued;
      tr.start = step;
      tr.queued = null;
      changed = true;
    });
    if (changed && this.onBar) setTimeout(this.onBar, Math.max(0, (t - this.ctx.currentTime) * 1000));
  }

  // ---- For the display and the recorder ----

  // The playing position inside a track's clip, in 16ths, at audio time t (default: what
  // is heard now). Null if the track plays nothing.
  // `early`: how many 16ths before the clip's start still count as its start (a note
  // played a hair before the first beat).
  clipPos(track, t = this.ctx.currentTime, early = 0) {
    const tr = this.tracks[track];
    const clip = tr.playing >= 0 && this.project().tracks[track].clips[tr.playing];
    if (!this.running || !clip) return null;
    let s = this.stepAt(t) - tr.start;
    if (s < 0 && s >= -early) s = 0;
    if (s < 0) return null;
    const len = clip.bars * STEPS_PER_BAR;
    return { pos: s % len, loop: Math.floor(s / len), len };
  }
}
