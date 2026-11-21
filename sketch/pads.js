// Playing live: pads, recording and capture.
//
// - Melodic pads: a 5 × 5 grid of the scale's notes only (so nothing sounds wrong), each
//   row a fourth above the one below (3 scale steps; 5 semitones in Chromatic), the key
//   note lit. Hit higher on a pad to play louder.
// - Drum pads: one per drum.
// - Record: while Record is on and the transport runs, what you play goes into the clip
//   playing on this track, at the position heard (quantized to 1/16 if asked).
// - Capture: the last notes played (not recorded) are always kept; Capture turns the last
//   phrase into a clip whose length (1, 2 or 4 bars) fits what was played.

const PAD_COLS = 5, PAD_ROWS = 5;
const PAD_KEYS = "asdfghjkl"; // computer keyboard: one key per note, low to high
const DRUM_PADS = [42, 46, 37, 36, 38, 39]; // top row hats and rim, bottom row kick, snare, clap

class PlayPads {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById("pads");
    this.octave = {};        // per track, octaves above the default
    this.touches = new Map(); // pointer or key → { pitch, track, take }
    this.recorder = new Recorder(app);
    this.el.addEventListener("pointerdown", (e) => this.down(e));
    for (const ev of ["pointerup", "pointercancel"]) this.el.addEventListener(ev, (e) => this.up(e.pointerId));
    document.addEventListener("keydown", (e) => this.key(e, true));
    document.addEventListener("keyup", (e) => this.key(e, false));
  }

  get trackIndex() { return this.app.sel.track; }
  get trackId() { return TRACK_DEFS[this.trackIndex].id; }

  // The pitches of the pads, bottom-left first (row by row, going up).
  pitches() {
    const p = this.app.project, i = this.trackIndex;
    if (TRACK_DEFS[i].drums) return DRUM_PADS;
    const base = this.app.editor.rootBelow(TRACK_DEFS[i].low + 11) + 12 * (this.octave[this.trackId] || 0);
    const out = [];
    if (p.chromatic) {
      for (let r = 0; r < PAD_ROWS; r++) for (let c = 0; c < PAD_COLS; c++) out.push(base + c + 5 * r);
    } else {
      const d0 = Scale.degreeAt(p, base);
      for (let r = 0; r < PAD_ROWS; r++) for (let c = 0; c < PAD_COLS; c++) out.push(Scale.pitch(p, d0 + c + 3 * r));
    }
    return out;
  }

  render() {
    const drums = TRACK_DEFS[this.trackIndex].drums;
    const pitches = this.pitches();
    const p = this.app.project;
    this.el.className = "pads" + (drums ? " drum-pads" : "");
    this.el.style.setProperty("--c", `var(--c-${this.trackId})`);
    const cols = drums ? 3 : PAD_COLS;
    // Display top row first: reverse the rows.
    const rows = [];
    for (let r = 0; r < pitches.length / cols; r++) rows.push(pitches.slice(r * cols, r * cols + cols));
    if (!drums) rows.reverse();
    this.el.innerHTML = rows.flat().map((pitch) => {
      const label = drums ? DRUM_LANES.find((l) => l.p === pitch).name : noteName(pitch);
      const root = !drums && Scale.isRoot(p, pitch);
      const out = !drums && p.chromatic && !Scale.has(p, pitch);
      return `<div class="pad${root ? " root" : ""}${out ? " out" : ""}" data-p="${pitch}"><span>${label}</span></div>`;
    }).join("");
    this.status();
  }

  down(e) {
    const pad = e.target.closest(".pad");
    if (!pad) return;
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    const r = pad.getBoundingClientRect();
    const v = 1 - 0.55 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); // higher = louder
    this.start(e.pointerId, +pad.dataset.p, v, pad);
  }

  up(id) {
    const t = this.touches.get(id);
    if (!t) return;
    this.touches.delete(id);
    this.app.sound.liveOff(t.trackId, t.pitch);
    this.recorder.noteOff(t.take);
    if (t.pad) t.pad.classList.remove("hit");
  }

  start(id, pitch, v, pad) {
    if (this.touches.has(id)) this.up(id);
    this.app.ctx.resume();
    const trackId = this.trackId;
    this.app.sound.liveOn(trackId, pitch, v);
    const take = this.recorder.noteOn(this.trackIndex, pitch, v);
    this.touches.set(id, { pitch, trackId, take, pad });
    if (pad) pad.classList.add("hit");
  }

  // Computer keyboard: A S D F G H J K L, low to high (drums: one key per drum).
  key(e, down) {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = PAD_KEYS.indexOf(e.key.toLowerCase());
    if (k < 0) return;
    const id = "key" + k;
    if (!down) return this.up(id);
    if (e.repeat) return;
    let pitch;
    if (TRACK_DEFS[this.trackIndex].drums) pitch = [36, 38, 39, 42, 46, 37][k];
    else {
      const p = this.app.project;
      const base = this.pitches()[0];
      pitch = p.chromatic ? base + k : Scale.pitch(p, Scale.degreeAt(p, base) + k);
    }
    if (pitch === undefined) return;
    this.start(id, pitch, 0.8, this.el.querySelector(`.pad[data-p="${pitch}"]`));
  }

  shiftOctave(dir) {
    const id = this.trackId;
    this.octave[id] = Math.max(-2, Math.min(2, (this.octave[id] || 0) + dir));
    this.render();
  }

  // The line next to the buttons: what Record would do.
  status() {
    const { app } = this;
    const el = document.getElementById("pad-status");
    const tr = app.transport.tracks[this.trackIndex];
    const clip = tr.playing >= 0 && app.project.tracks[this.trackIndex].clips[tr.playing];
    if (app.recording && app.transport.running && clip) el.textContent = `Recording into ${clip.name || "clip " + (tr.playing + 1)}`;
    else if (app.recording) el.textContent = "Record on: start a clip on this track";
    else el.textContent = "";
    el.classList.toggle("rec", !!(app.recording && clip));
  }
}

class Recorder {
  constructor(app) {
    this.app = app;
    this.recent = []; // notes played lately, for Capture: { track, p, v, t, end }
  }

  // Audio time the player was hearing when they hit the pad (what they played along to).
  heard() { return this.app.ctx.currentTime - (this.app.ctx.outputLatency || 0); }

  noteOn(track, p, v) {
    const { app } = this;
    const take = { track, p, v, t: this.heard(), end: null, note: null };
    const tr = app.transport;
    const pos = app.recording ? tr.clipPos(track, take.t, 0.5) : null;
    if (pos) {
      const clip = app.project.tracks[track].clips[tr.tracks[track].playing];
      let s = pos.pos, loop = pos.loop;
      if (app.project.quantize) {
        s = Math.round(s);
        if (s >= pos.len) { s = 0; loop++; } // hit just before the loop restarts
      }
      take.note = { p, s, l: 1, v: Math.round(v * 100) / 100 };
      clip.notes.push(take.note);
      tr.fresh.set(take.note, loop); // heard live: the scheduler must not replay it this time
      take.clip = clip;
      app.changed({ only: "editor", quiet: true });
    } else {
      this.recent.push(take);
      if (this.recent.length > 256) this.recent.shift();
    }
    return take;
  }

  noteOff(take) {
    if (!take) return;
    take.end = this.heard();
    if (!take.note || TRACK_DEFS[take.track].drums) return;
    const { app } = this;
    const steps = (take.end - take.t) / app.transport.stepDur;
    const len = take.clip.bars * STEPS_PER_BAR;
    take.note.l = Math.min(len - Math.floor(take.note.s), app.project.quantize ? Math.max(1, Math.round(steps)) : Math.max(0.25, steps));
    app.changed({ only: "editor", quiet: true });
  }

  // The last phrase played on a track → a new clip. Returns a message for the user.
  capture(track) {
    const { app } = this;
    const tr = app.transport;
    let takes = this.recent.filter((x) => x.track === track);
    if (!takes.length) return "Play something on the pads first, then Capture.";
    const bar = tr.stepDur * STEPS_PER_BAR;
    // The phrase: walk back from the last note until a silence of more than 2 bars.
    let first = takes.length - 1;
    while (first > 0 && takes[first].t - takes[first - 1].t <= 2 * bar) first--;
    takes = takes.slice(first);

    // Positions in 16ths. Transport running: on its bar grid (a note hit a hair before
    // the bar line still counts as on it). Stopped: from the first note.
    const now = this.heard();
    let pos;
    if (tr.running) {
      const steps = takes.map((x) => tr.stepAt(x.t));
      const origin = Math.floor((Math.min(...steps) + 1) / STEPS_PER_BAR) * STEPS_PER_BAR;
      pos = steps.map((s) => Math.max(0, s - origin));
    } else pos = takes.map((x) => (x.t - takes[0].t) / tr.stepDur);
    const ends = takes.map((x, i) => pos[i] + ((x.end ?? now) - x.t) / tr.stepDur);
    // Keep at most the last 4 bars.
    const lastStart = Math.max(...pos);
    if (lastStart >= 4 * STEPS_PER_BAR) {
      const cut = (Math.ceil((lastStart + 1) / STEPS_PER_BAR) - 4) * STEPS_PER_BAR;
      pos.forEach((s, i) => { pos[i] = s - cut; ends[i] -= cut; });
    }
    const need = (Math.max(...pos) + 1) / STEPS_PER_BAR;
    const bars = need <= 1 ? 1 : need <= 2 ? 2 : 4;
    const len = bars * STEPS_PER_BAR;
    const drums = TRACK_DEFS[track].drums;

    const clip = newClip(bars, "Captured");
    takes.forEach((x, i) => {
      if (pos[i] < 0) return;
      let s = pos[i], l = drums ? 1 : Math.max(0.25, ends[i] - pos[i]);
      if (app.project.quantize) { s = Math.round(s) % len; l = Math.max(1, Math.round(l)); }
      clip.notes.push({ p: x.p, s, l: Math.min(l, len - Math.floor(s)), v: Math.round(x.v * 100) / 100 });
    });
    if (app.project.quantize) ClipOps.quantize(clip);
    ClipOps.sort(clip);

    // Into the selected slot if it is empty and on this track, else the first empty one.
    const clips = app.project.tracks[track].clips;
    let slot = app.sel.track === track && !clips[app.sel.slot] ? app.sel.slot : clips.findIndex((c) => !c);
    if (slot < 0) return "This track has no empty slot left.";
    app.edit(() => (clips[slot] = clip));
    this.recent = this.recent.filter((x) => !takes.includes(x));
    app.select(track, slot);
    if (tr.running) tr.launch(track, slot);
    return `Captured ${bars} bar${bars > 1 ? "s" : ""} into slot ${slot + 1}.`;
  }
}
