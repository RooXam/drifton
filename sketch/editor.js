// The clip editor, for the selected slot: a step grid for drums (one row per drum, 16
// steps per bar) and a piano roll for the other tracks (rows = the notes of the scale,
// or all 12 with "Chromatic"). One bar is shown at a time; the strip above shows the
// whole clip and picks the bar.
//
// Piano roll: tap an empty spot to add a note, tap a note to remove it, drag sideways
// (while adding, or from a note) to set its length. The velocity slider applies to new
// notes and to the last note touched.

const ROLL_ROWS = 15;   // two octaves of a 7-note scale, root to root
const LABEL_W = 40;     // the note names column, CSS pixels

class ClipEditor {
  constructor(app) {
    this.app = app;
    this.page = 0;               // the bar shown
    this.base = {};              // per track: lowest pitch of the piano roll
    this.drawLen = 2;            // length of a new note, in 16ths (follows the last drag)
    this.last = null;            // last note touched (the velocity slider changes it)
    this.drag = null;
    const $ = (id) => document.getElementById(id);
    this.el = { steps: $("steps"), roll: $("roll"), overview: $("overview") };

    this.el.steps.addEventListener("click", (e) => this.stepClick(e));
    const roll = this.el.roll;
    roll.addEventListener("pointerdown", (e) => this.down(e));
    roll.addEventListener("pointermove", (e) => this.move(e));
    roll.addEventListener("pointerup", (e) => this.up(e));
    roll.addEventListener("pointercancel", () => (this.drag = null));
    this.el.overview.addEventListener("click", (e) => {
      const clip = this.clip;
      if (!clip) return;
      const r = this.el.overview.getBoundingClientRect();
      this.page = Math.min(clip.bars - 1, Math.floor(((e.clientX - r.left) / r.width) * clip.bars));
      this.render();
    });
    new ResizeObserver(() => this.draw()).observe(roll);
  }

  get track() { return this.app.project.tracks[this.app.sel.track]; }
  get clip() { return this.track.clips[this.app.sel.slot]; }
  get drums() { return TRACK_DEFS[this.app.sel.track].drums; }

  // A clip was selected: show its first bar, and put its notes in view.
  selected() {
    this.page = 0;
    this.last = null;
    const clip = this.clip;
    if (!clip || this.drums) return;
    if (clip.notes.length) {
      const low = Math.min(...clip.notes.map((n) => n.p));
      const high = Math.max(...clip.notes.map((n) => n.p));
      const mid = Math.round((low + high) / 2);
      this.base[this.track.id] = this.rootBelow(Math.max(low - 2, mid - 12));
    }
  }

  // The key note at or below a pitch.
  rootBelow(pitch) {
    const key = this.app.project.key;
    return pitch - ((pitch - key + 120) % 12);
  }

  baseFor(trackIndex) {
    const id = TRACK_DEFS[trackIndex].id;
    if (this.base[id] === undefined) this.base[id] = this.rootBelow(TRACK_DEFS[trackIndex].low + 11);
    return this.base[id];
  }

  // The pitches of the piano roll rows, low to high.
  rows() {
    const p = this.app.project;
    const base = this.baseFor(this.app.sel.track);
    if (p.chromatic) return Array.from({ length: ROLL_ROWS }, (_, i) => base + i);
    const d0 = Scale.degreeAt(p, base);
    return Array.from({ length: ROLL_ROWS }, (_, i) => Scale.pitch(p, d0 + i));
  }

  shiftOctave(dir) {
    const id = this.track.id;
    this.base[id] = Math.min(96, Math.max(12, this.baseFor(this.app.sel.track) + 12 * dir));
    this.draw();
  }

  render() {
    const clip = this.clip;
    if (clip) this.page = Math.min(this.page, clip.bars - 1);
    this.el.steps.hidden = !clip || !this.drums;
    this.el.roll.hidden = !clip || this.drums;
    if (clip && this.drums) this.renderSteps();
    this.draw();
  }

  // ---- Drums: step grid (DOM buttons) ----

  renderSteps() {
    const clip = this.clip;
    const first = this.page * STEPS_PER_BAR;
    let html = "";
    for (const half of [0, 8]) {
      html += `<div class="step-block">`;
      for (const lane of DRUM_LANES) {
        html += `<span class="lane">${lane.name}</span>`;
        for (let i = half; i < half + 8; i++) {
          const s = first + i;
          const n = clip.notes.find((x) => x.p === lane.p && Math.floor(x.s) === s);
          html += `<button class="step${i % 4 === 0 ? " beat" : ""}${n ? " on" : ""}" data-p="${lane.p}" data-s="${s}"` +
            (n ? ` style="--v:${n.v.toFixed(2)}"` : "") + ` aria-label="${lane.name} step ${i + 1}"></button>`;
        }
      }
      html += `</div>`;
    }
    this.el.steps.innerHTML = html;
    this.stepEls = [...this.el.steps.querySelectorAll(".step")];
  }

  stepClick(e) {
    const b = e.target.closest(".step");
    if (!b) return;
    const p = +b.dataset.p, s = +b.dataset.s;
    this.app.edit(() => {
      const clip = this.clip;
      const i = clip.notes.findIndex((x) => x.p === p && Math.floor(x.s) === s);
      if (i >= 0) { clip.notes.splice(i, 1); this.last = null; }
      else {
        this.last = { p, s, l: 1, v: this.app.velocity };
        clip.notes.push(this.last);
        this.app.sound.liveOn("drums", p, this.app.velocity);
      }
    }, { only: "editor" });
  }

  // ---- Piano roll (canvas) ----

  draw() {
    this.drawOverview();
    const canvas = this.el.roll;
    if (!this.clip || this.drums || canvas.hidden || !canvas.clientWidth) return;
    const rowH = matchMedia("(max-width: 560px)").matches ? 28 : 24;
    canvas.style.height = ROLL_ROWS * rowH + "px";
    const g = prepCanvas(canvas);
    const dpr = devicePixelRatio || 1;
    const W = canvas.width, H = canvas.height;
    const lw = LABEL_W * dpr, rh = H / ROLL_ROWS, cw = (W - lw) / STEPS_PER_BAR;
    const rows = this.rows();
    const p = this.app.project;
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue(`--c-${this.track.id}`).trim();
    this.geom = { lw, rh, cw, dpr, rows };

    // Rows: roots lit, alternate shading; labels on the left.
    g.font = `${11 * dpr}px Figtree, sans-serif`;
    g.textBaseline = "middle";
    rows.forEach((pitch, i) => {
      const y = H - (i + 1) * rh;
      const root = Scale.isRoot(p, pitch);
      g.fillStyle = root ? "#221e38" : i % 2 ? "#15141d" : "#191823";
      if (p.chromatic && !Scale.has(p, pitch)) g.fillStyle = "#101017";
      g.fillRect(0, y, W, rh);
      g.fillStyle = root ? "#c4bdff" : "#8f8aa6";
      g.fillText(noteName(pitch), 6 * dpr, y + rh / 2);
    });
    // Beat lines.
    for (let i = 0; i <= STEPS_PER_BAR; i++) {
      g.fillStyle = i % 4 === 0 ? "#34313f" : "#22202c";
      g.fillRect(lw + i * cw - (i === STEPS_PER_BAR ? dpr : 0), 0, i % 4 === 0 ? dpr : dpr * 0.6, H);
    }

    // Notes of this bar (or reaching into it).
    const first = this.page * STEPS_PER_BAR;
    for (const n of this.clip.notes) {
      const a = n.s - first, b = n.s + n.l - first;
      if (b <= 0 || a >= STEPS_PER_BAR) continue;
      const y = this.yOf(n.p, rows, H, rh);
      if (y === null) continue;
      const x0 = lw + Math.max(0, a) * cw, x1 = lw + Math.min(STEPS_PER_BAR, b) * cw;
      const offScale = !rows.includes(n.p);
      g.globalAlpha = 0.35 + 0.65 * n.v;
      g.fillStyle = offScale ? "#d07fb0" : color;
      const h = offScale ? rh * 0.4 : rh - 3 * dpr;
      roundRect(g, x0 + dpr, y + (rh - h) / 2, Math.max(4 * dpr, x1 - x0 - 2 * dpr), h, 4 * dpr);
      g.fill();
      if (n === this.last) { g.globalAlpha = 1; g.strokeStyle = "#ece9f5"; g.lineWidth = 1.5 * dpr; g.stroke(); }
    }
    g.globalAlpha = 1;

    // Playhead.
    const pos = this.playPos();
    if (pos !== null && pos >= first && pos < first + STEPS_PER_BAR) {
      g.fillStyle = "#ece9f5";
      g.fillRect(lw + (pos - first) * cw, 0, 1.5 * dpr, H);
    }
  }

  // Row position of a pitch; a pitch between two rows (outside the scale) sits between them.
  yOf(pitch, rows, H, rh) {
    const i = rows.indexOf(pitch);
    if (i >= 0) return H - (i + 1) * rh;
    for (let k = 0; k < rows.length - 1; k++) {
      if (rows[k] < pitch && pitch < rows[k + 1]) return H - (k + 1.5) * rh;
    }
    return null; // out of view
  }

  drawOverview() {
    const canvas = this.el.overview, clip = this.clip;
    if (!clip || !canvas.clientWidth) return;
    const g = prepCanvas(canvas);
    const W = canvas.width, H = canvas.height, dpr = devicePixelRatio || 1;
    const len = clip.bars * STEPS_PER_BAR;
    const barW = W / clip.bars;
    g.fillStyle = "#1d1b2a";
    g.fillRect(this.page * barW, 0, barW, H);
    g.fillStyle = "#34313f";
    for (let b = 1; b < clip.bars; b++) g.fillRect(b * barW, 0, dpr, H);
    const pitches = clip.notes.map((n) => n.p);
    const low = Math.min(...pitches) - 1, high = Math.max(...pitches) + 1;
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--c-${this.track.id}`).trim();
    for (const n of clip.notes) {
      const y = H - ((n.p - low) / (high - low || 1)) * H;
      g.globalAlpha = 0.4 + 0.6 * n.v;
      g.fillRect((n.s / len) * W, y - 1.5 * dpr, Math.max(2 * dpr, (n.l / len) * W - dpr), 3 * dpr);
    }
    g.globalAlpha = 1;
    const pos = this.playPos();
    if (pos !== null) { g.fillStyle = "#ece9f5"; g.fillRect((pos / len) * W, 0, dpr, H); }
    g.fillStyle = "#8f8aa6";
    g.font = `${10 * dpr}px Figtree, sans-serif`;
    g.textBaseline = "top";
    for (let b = 0; b < clip.bars; b++) g.fillText(String(b + 1), b * barW + 5 * dpr, 4 * dpr);
  }

  // Where the selected clip is playing (in 16ths), if it is.
  playPos() {
    const { transport: tr, sel, ctx } = this.app;
    if (tr.tracks[sel.track].playing !== sel.slot) return null;
    const pos = tr.clipPos(sel.track, ctx.currentTime - (ctx.outputLatency || 0));
    return pos ? pos.pos : null;
  }

  frame() {
    if (!this.clip) return;
    if (this.drums) {
      // Light the column being played.
      const pos = this.playPos();
      const step = pos === null ? -1 : Math.floor(pos);
      if (step !== this.litStep) {
        this.litStep = step;
        for (const b of this.stepEls || []) b.classList.toggle("now", +b.dataset.s === step);
      }
      if (pos !== null || this.wasPlaying) this.drawOverview();
      this.wasPlaying = pos !== null;
    } else {
      // Redraw only while the playhead moves (and once more to erase it).
      const playing = this.playPos() !== null;
      if (playing || this.wasPlaying) this.draw();
      this.wasPlaying = playing;
    }
  }

  // ---- Piano roll pointer ----

  hit(e) {
    const r = this.el.roll.getBoundingClientRect();
    const { rows } = this.geom;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const col = (x - LABEL_W) / ((r.width - LABEL_W) / STEPS_PER_BAR);
    const row = ROLL_ROWS - 1 - Math.floor((y / r.height) * ROLL_ROWS);
    return { x, col, pitch: rows[Math.max(0, Math.min(ROLL_ROWS - 1, row))], at: this.page * STEPS_PER_BAR + col };
  }

  down(e) {
    if (!this.clip || !this.geom) return;
    e.preventDefault();
    const h = this.hit(e);
    const track = this.track.id;
    if (h.x < LABEL_W) { // the note names: just listen
      this.app.sound.liveOn(track, h.pitch, this.app.velocity);
      setTimeout(() => this.app.sound.liveOff(track, h.pitch), 300);
      return;
    }
    this.el.roll.setPointerCapture(e.pointerId);
    const clip = this.clip, len = clip.bars * STEPS_PER_BAR;
    this.app.snapshot();
    const found = clip.notes.find((n) => n.p === h.pitch && n.s <= h.at && h.at < n.s + n.l);
    if (found) {
      this.drag = { note: found, mode: "tap", x0: h.x };
    } else {
      const s = Math.floor(h.at);
      const note = { p: h.pitch, s, l: Math.min(this.drawLen, len - s), v: this.app.velocity };
      clip.notes.push(note);
      this.drag = { note, mode: "draw", x0: h.x };
      this.app.sound.liveOn(track, h.pitch, note.v);
      setTimeout(() => this.app.sound.liveOff(track, h.pitch), 250);
    }
    this.last = this.drag.note;
    this.draw();
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const h = this.hit(e);
    if (d.mode === "tap" && Math.abs(h.x - d.x0) > 8) d.mode = "resize";
    if (d.mode === "tap") return;
    if (d.mode === "draw" && Math.abs(h.x - d.x0) < 8) return;
    const len = this.clip.bars * STEPS_PER_BAR;
    const end = Math.min(len, Math.max(Math.floor(d.note.s) + 1, Math.ceil(h.at)));
    d.note.l = end - d.note.s;
    this.drawLen = Math.max(1, Math.round(d.note.l));
    this.draw();
  }

  up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.mode === "tap") {
      const notes = this.clip.notes;
      notes.splice(notes.indexOf(d.note), 1);
      this.last = null;
    }
    ClipOps.sort(this.clip);
    this.app.changed({ only: "editor" });
  }

  // The velocity slider moved: also the last note touched.
  setVelocity(v) {
    if (!this.last || !this.clip || !this.clip.notes.includes(this.last)) return;
    this.app.edit(() => (this.last.v = v), { only: "editor", merge: "velocity" });
  }
}

// Canvas sized to its CSS box × the screen's pixel density, cleared.
function prepCanvas(canvas) {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  return g;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  else g.rect(x, y, w, h);
}
