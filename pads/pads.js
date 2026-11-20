"use strict";

/* ==================================================================
 *  DRIFTON LAB — prototype of the "hybrid" engine.
 *
 *  Idea: sound design happens in a DAW (Ableton + Serum...), the browser
 *  only arranges and processes it live.
 *
 *    3 LoopPlayers (pad dark/mid/bright) ─┐
 *    Granular (grains from one state) ────┴─→ bus ─→ filter ─┬─→ AM ─→ comp ─→ master ─→ out
 *                                              └─→ reverb send ─→ reverb ─┘
 *
 *  A conductor computes an "intensity" 0..1 (manual or session curve)
 *  and maps it onto: crossfade between states, filter cutoff, reverb,
 *  grain density.
 * ================================================================== */

const STATES = ["Dark", "Mid", "Bright"];
const PLACEHOLDER_LEN = [19, 23, 29];  // seconds, deliberately coprime
const LOOP_XFADE = 4;                  // crossfade between loop repetitions (s)
const LOOKAHEAD = 2;                   // how far ahead we schedule audio (s)
const TICK_MS = 100;

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)

// ---------- Equal-power fade curves ----------
const CURVE_N = 128;
const FADE_IN = new Float32Array(CURVE_N);
const FADE_OUT = new Float32Array(CURVE_N);
const HANN = new Float32Array(CURVE_N);
for (let i = 0; i < CURVE_N; i++) {
  const x = i / (CURVE_N - 1);
  FADE_IN[i] = Math.sin(x * Math.PI / 2);
  FADE_OUT[i] = Math.cos(x * Math.PI / 2);
  HANN[i] = Math.sin(x * Math.PI) ** 2;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- Master graph (built once, lives forever) ----------
const master = ctx.createGain();
master.gain.value = 0;
const comp = ctx.createDynamicsCompressor();
comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 3;
comp.attack.value = 0.03; comp.release.value = 0.4;

// Amplitude modulation: gain = (1 - depth/2) + (depth/2) * sin(2π·rate·t)
const amGain = ctx.createGain();
const amLfo = ctx.createOscillator();
const amDepth = ctx.createGain();
amLfo.frequency.value = 16;
amDepth.gain.value = 0;
amLfo.connect(amDepth).connect(amGain.gain);
amLfo.start();

const filter = ctx.createBiquadFilter();
filter.type = "lowpass";
filter.frequency.value = 1200;
filter.Q.value = 0.5;

const reverb = ctx.createConvolver();
reverb.buffer = makeReverbIR(6, 2.8);
const reverbSend = ctx.createGain();
reverbSend.gain.value = 0.45;

const bus = ctx.createGain();
bus.connect(filter);
bus.connect(reverbSend);
reverbSend.connect(reverb);
filter.connect(amGain);
reverb.connect(amGain);
amGain.connect(comp).connect(master).connect(ctx.destination);

function makeReverbIR(duration, decay) {
  const len = Math.floor(ctx.sampleRate * duration);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return ir;
}

// ---------- Placeholder pads (stand-ins for Ableton exports) ----------
// Same Dm9 chord, rendered offline at three "macro" positions. Each one
// has its own baked-in filter movement, like an automation in the DAW.
async function renderPlaceholder(brightness, seconds) {
  const sr = 44100;
  const oac = new OfflineAudioContext(2, sr * seconds, sr);
  const out = oac.createGain();
  out.connect(oac.destination);

  const filt = oac.createBiquadFilter();
  filt.type = "lowpass";
  const base = 260 + brightness * 2400;
  filt.frequency.value = base;
  filt.Q.value = 0.7 + brightness * 2.5;
  filt.connect(out);

  // "Automation": the cutoff makes two slow sweeps over the file
  const sweep = oac.createOscillator();
  const sweepAmt = oac.createGain();
  sweep.frequency.value = 2 / seconds;
  sweepAmt.gain.value = base * 0.55;
  sweep.connect(sweepAmt).connect(filt.frequency);
  sweep.start();

  const chord = [38, 45, 53, 60, 64]; // D2 A2 F3 C4 E4
  chord.forEach((m, idx) => {
    for (const side of [-1, 1]) {
      const osc = oac.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = mtof(m);
      osc.detune.value = side * (5 + idx * 1.5);
      const pan = oac.createStereoPanner();
      pan.pan.value = side * 0.45;
      const g = oac.createGain();
      g.gain.value = 0.06;
      osc.connect(g).connect(pan).connect(filt);
      osc.start();
    }
  });

  // Bright states get a shimmering top layer
  if (brightness > 0.3) {
    [74, 81, 86].forEach((m, idx) => {
      const osc = oac.createOscillator();
      osc.frequency.value = mtof(m);
      const g = oac.createGain();
      g.gain.value = 0.025 * brightness;
      const trem = oac.createOscillator();
      const tremAmt = oac.createGain();
      trem.frequency.value = (3 + idx) / seconds;
      tremAmt.gain.value = 0.02 * brightness;
      trem.connect(tremAmt).connect(g.gain);
      osc.connect(g).connect(out);
      osc.start(); trem.start();
    });
  }

  const buf = await oac.startRendering();
  normalize(buf, 0.5);
  return buf;
}

function normalize(buf, target) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak === 0) return;
  const k = target / peak;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

// ---------- LoopPlayer: endless playback of a file, crossfading each
// repetition into the next, so any export loops without clicks ----------
class LoopPlayer {
  constructor(dest) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
    this.buffer = null;
    this.nextStart = Infinity;
    this.active = []; // { src, r, start }
  }

  start(t) { this.nextStart = t; }

  schedule(now) {
    const buf = this.buffer;
    if (!buf) return;
    while (this.nextStart < now + LOOKAHEAD) {
      const xf = Math.min(LOOP_XFADE, buf.duration / 3);
      const t = this.nextStart;
      const end = t + buf.duration;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueCurveAtTime(FADE_IN, t, xf);
      g.gain.setValueCurveAtTime(FADE_OUT, end - xf, xf);
      // r = separate release gain, so a fade-out never collides with the curves on g
      const r = ctx.createGain();
      src.connect(g).connect(r).connect(this.gain);
      src.start(t);
      src.stop(end);
      const rec = { src, r, start: t };
      src.onended = () => {
        r.disconnect();
        this.active = this.active.filter((r) => r !== rec);
      };
      this.active.push(rec);
      this.nextStart = end - xf;
    }
  }

  // Fade out everything currently scheduled
  release(fade) {
    const now = ctx.currentTime;
    this.active.forEach(({ src, r, start }) => {
      if (start > now) { src.stop(); return; }
      r.gain.setValueAtTime(1, now);
      r.gain.linearRampToValueAtTime(0, now + fade);
      src.stop(now + fade + 0.05);
    });
    this.active = [];
  }

  stop(fade = 1.5) {
    this.release(fade);
    this.nextStart = Infinity;
  }

  // Swap the file live: old one fades out while the new one fades in
  replace(buf, playing) {
    this.buffer = buf;
    if (!playing) return;
    this.release(LOOP_XFADE);
    this.nextStart = ctx.currentTime + 0.05;
  }
}

// ---------- Granular: short windowed fragments read from a buffer ----------
class Granular {
  constructor(dest) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.buffer = null;
    this.running = false;
    this.pos = Math.random();     // read head, 0..1 of the file
    this.nextGrain = 0;
    this.size = 0.22;             // s
    this.density = 10;            // grains / s
    this.spread = 0.04;           // random offset around the head, fraction of the file
    this.speed = 0.08;            // head speed, seconds of file per real second
    this.octaves = true;
  }

  start(t) { this.running = true; this.nextGrain = t; }
  stop() { this.running = false; }

  schedule(now, dt) {
    const buf = this.buffer;
    if (!buf || !this.running) return;
    this.pos = (this.pos + (this.speed * dt) / buf.duration) % 1;
    if (this.nextGrain < now) this.nextGrain = now + 0.01;

    // overlap-aware level so density changes don't change loudness much
    const amp = 0.55 / Math.sqrt(Math.max(1, this.density * this.size));
    while (this.nextGrain < now + LOOKAHEAD) {
      const t = this.nextGrain;
      const size = this.size * (0.8 + Math.random() * 0.4);
      let semi = 0;
      if (this.octaves) {
        const r = Math.random();
        semi = r < 0.15 ? 12 : r < 0.25 ? -12 : r < 0.32 ? 7 : 0;
      }
      const rate = Math.pow(2, semi / 12);
      const span = size * rate;
      const off = clamp((this.pos + (Math.random() * 2 - 1) * this.spread) * buf.duration, 0, buf.duration - span);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = 0;
      const env = HANN.map((v) => v * amp);
      g.gain.setValueCurveAtTime(env, t, size);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.7;
      src.connect(g).connect(pan).connect(this.out);
      src.start(t, off);
      src.stop(t + size + 0.01);
      src.onended = () => pan.disconnect();

      this.nextGrain += (1 / this.density) * (0.6 + Math.random() * 0.8);
    }
  }
}

// ---------- Layers ----------
const pads = STATES.map(() => new LoopPlayer(bus));
const grains = new Granular(bus);
const slotInfo = STATES.map(() => ({ name: null, user: false }));

// ---------- Conductor ----------
const conductor = {
  mode: "manual",
  manual: 0.3,
  sessionMinutes: 3,
  sessionStart: 0,     // ctx time
  drift: 0,
  driftTarget: 0,
  intensity: 0.3,
  history: [],         // last ~2 min of intensity
  lastSample: 0,
};

const smooth = (x) => x * x * (3 - 2 * x);

// Session shape: ramp up 1/7, plateau 5/7, ramp down 1/7 (= 5/25/5 for 35 min)
function sessionEnvelope(f) {
  const lo = 0.1, hi = 0.82;
  const a = 1 / 7, b = 6 / 7;
  if (f < a) return lo + (hi - lo) * smooth(f / a);
  if (f < b) return hi;
  if (f < 1) return hi - (hi - lo) * smooth((f - b) / (1 - b));
  return lo;
}

function sessionFraction(now) {
  return (now - conductor.sessionStart) / (conductor.sessionMinutes * 60);
}

function updateIntensity(now, dt) {
  if (conductor.mode === "manual") {
    conductor.intensity = conductor.manual;
    return;
  }
  // slow random wander so even the plateau keeps moving a little
  if (Math.random() < dt / 10) conductor.driftTarget = (Math.random() * 2 - 1) * 0.12;
  conductor.drift += (conductor.driftTarget - conductor.drift) * Math.min(1, dt / 5);
  const env = sessionEnvelope(sessionFraction(now));
  conductor.intensity = clamp(env + conductor.drift, 0, 1);
}

// 3-way equal-power crossfade: intensity 0 = dark, 0.5 = mid, 1 = bright
function stateWeights(i) {
  const p = i * 2;
  return [0, 1, 2].map((k) => {
    const d = Math.abs(p - k);
    return d < 1 ? Math.cos(d * Math.PI / 2) : 0;
  });
}

// Everything the conductor drives, from one number
function applyIntensity(i, now) {
  const tc = 0.8; // smoothing time constant (s)
  const w = stateWeights(i);
  pads.forEach((p, k) => p.gain.gain.setTargetAtTime(w[k], now, tc));
  const cutoff = 380 * Math.pow(2, i * 4.2);           // ~380 Hz → ~7 kHz
  filter.frequency.setTargetAtTime(cutoff, now, tc);
  reverbSend.gain.setTargetAtTime(0.6 - 0.3 * i, now, tc); // calmer = more space
  grains.density = 4 + i * 14;
  return { w, cutoff };
}

// ---------- Transport ----------
let playing = false;
let tickTimer = null;
let lastTick = 0;
let volume = 0.7;

async function play() {
  if (playing) return;
  playing = true;
  reflectPlay();
  await ctx.resume();
  if (!playing) return;
  const t = ctx.currentTime + 0.1;
  pads.forEach((p) => p.start(t));
  grains.start(t);
  if (conductor.mode === "session") conductor.sessionStart = t;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(volume, t, 0.8);
  lastTick = ctx.currentTime;
  tick();
  tickTimer = setInterval(tick, TICK_MS);
}

function pause() {
  if (!playing) return;
  playing = false;
  reflectPlay();
  clearInterval(tickTimer);
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(0, now, 0.4);
  pads.forEach((p) => p.stop(2));
  grains.stop();
}

function tick() {
  const now = ctx.currentTime;
  const dt = Math.max(0, now - lastTick);
  lastTick = now;
  updateIntensity(now, dt);
  const info = applyIntensity(conductor.intensity, now);
  pads.forEach((p) => p.schedule(now));
  grains.schedule(now, dt);
  if (now - conductor.lastSample > 0.5) {
    conductor.history.push(conductor.intensity);
    if (conductor.history.length > 240) conductor.history.shift();
    conductor.lastSample = now;
  }
  renderReadout(info, now);
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const playBtn = $("play");
const statusEl = $("status");
const PLAY_PATH = "M8 5v14l11-7z";
const PAUSE_PATH = "M6 5h4v14H6zm8 0h4v14h-4z";

function reflectPlay() {
  playBtn.classList.toggle("playing", playing);
  $("play-icon").firstElementChild.setAttribute("d", playing ? PAUSE_PATH : PLAY_PATH);
}

playBtn.addEventListener("click", () => (playing ? pause() : play()));
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName)) {
    e.preventDefault();
    playBtn.click();
  }
});

$("volume").addEventListener("input", (e) => {
  volume = e.target.value / 100;
  if (playing) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
});

// --- Slots ---
const slotsEl = $("slots");
const slotEls = STATES.map((label, idx) => {
  const el = document.createElement("div");
  el.className = "slot";
  el.innerHTML = `
    <div class="slot-label">${label}</div>
    <div class="slot-file">…</div>
    <div class="meter"><div class="meter-fill"></div></div>
    <div class="slot-actions">
      <button class="pick">Load file…</button>
      <button class="reset" hidden>Reset</button>
    </div>
    <input type="file" accept="audio/*" multiple hidden>`;
  const input = el.querySelector("input");
  el.querySelector(".pick").addEventListener("click", () => input.click());
  el.querySelector(".reset").addEventListener("click", () => resetSlot(idx));
  input.addEventListener("change", () => { loadFiles([...input.files], idx); input.value = ""; });
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag"); });
  el.addEventListener("dragleave", () => el.classList.remove("drag"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drag");
    loadFiles([...e.dataTransfer.files], idx);
  });
  slotsEl.appendChild(el);
  return el;
});

// Dropping several files on a slot fills it and the following ones
async function loadFiles(files, startIdx) {
  const audio = files.filter((f) => f.type.startsWith("audio/") || /\.(wav|aiff?|mp3|m4a|ogg|flac)$/i.test(f.name));
  for (let n = 0; n < audio.length && startIdx + n < STATES.length; n++) {
    const idx = startIdx + n;
    const file = audio[n];
    setSlotLabel(idx, `Decoding ${file.name}…`, false);
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      setBuffer(idx, buf, file.name, true);
    } catch (err) {
      setSlotLabel(idx, `Could not decode ${file.name}`, false);
      console.error(err);
    }
  }
}

const placeholders = [];
function resetSlot(idx) {
  if (placeholders[idx]) setBuffer(idx, placeholders[idx], null, false);
}

function setBuffer(idx, buf, name, user) {
  pads[idx].replace(buf, playing);
  if (Number($("g-source").value) === idx) grains.buffer = buf;
  slotInfo[idx] = { name, user };
  const label = user ? `${name} · ${buf.duration.toFixed(1)} s` : `placeholder · ${buf.duration.toFixed(0)} s`;
  setSlotLabel(idx, label, user);
  slotEls[idx].querySelector(".reset").hidden = !user;
}

function setSlotLabel(idx, text, user) {
  const f = slotEls[idx].querySelector(".slot-file");
  f.textContent = text;
  f.title = text;
  f.classList.toggle("user", user);
}

// --- Conductor controls ---
document.querySelectorAll("#mode button").forEach((b) => {
  b.addEventListener("click", () => {
    conductor.mode = b.dataset.mode;
    document.querySelectorAll("#mode button").forEach((x) => x.classList.toggle("active", x === b));
    $("manual-row").classList.toggle("hidden", conductor.mode !== "manual");
    $("session-row").classList.toggle("hidden", conductor.mode !== "session");
    if (conductor.mode === "session") conductor.sessionStart = ctx.currentTime;
  });
});
$("intensity").addEventListener("input", (e) => { conductor.manual = e.target.value / 100; });
$("session-len").addEventListener("change", (e) => {
  conductor.sessionMinutes = Number(e.target.value);
  conductor.sessionStart = ctx.currentTime;
});

// --- Granular controls ---
$("g-source").addEventListener("change", (e) => { grains.buffer = pads[Number(e.target.value)].buffer; });
const gMix = (v) => grains.out.gain.setTargetAtTime(v * 0.9, ctx.currentTime, 0.3);
$("g-mix").addEventListener("input", (e) => gMix(e.target.value / 100));
$("g-size").addEventListener("input", (e) => { grains.size = e.target.value / 1000; });
$("g-spread").addEventListener("input", (e) => { grains.spread = e.target.value / 100; });
$("g-speed").addEventListener("input", (e) => { grains.speed = e.target.value / 100; });
$("g-oct").addEventListener("change", (e) => { grains.octaves = e.target.checked; });

// --- AM controls ---
function applyAM() {
  const on = $("am-on").checked;
  const rate = Number($("am-rate").value);
  const depth = on ? $("am-depth").value / 100 : 0;
  const now = ctx.currentTime;
  amLfo.frequency.setTargetAtTime(rate, now, 0.1);
  amDepth.gain.setTargetAtTime(depth / 2, now, 0.2);
  amGain.gain.setTargetAtTime(1 - depth / 2, now, 0.2);
  $("am-rate-out").textContent = `${rate} Hz`;
  $("am-depth-out").textContent = `${$("am-depth").value} %`;
}
["am-on", "am-rate", "am-depth"].forEach((id) => $(id).addEventListener("input", applyAM));

// --- Readout + curve ---
const canvas = $("curve");
const cctx = canvas.getContext("2d");
const css = getComputedStyle(document.documentElement);
const ACCENT = css.getPropertyValue("--accent").trim();
const MUTED = css.getPropertyValue("--muted").trim();

function renderReadout(info, now) {
  slotEls.forEach((el, k) => {
    el.querySelector(".meter-fill").style.width = `${Math.round(info.w[k] * 100)}%`;
  });
  let session = "";
  if (conductor.mode === "session") {
    const f = clamp(sessionFraction(now), 0, 1);
    const total = conductor.sessionMinutes * 60;
    const el = Math.min(total, now - conductor.sessionStart);
    const phase = f < 1 / 7 ? "ramp up" : f < 6 / 7 ? "plateau" : f < 1 ? "ramp down" : "done";
    session = `<div>Session <b>${fmt(el)} / ${fmt(total)}</b> · ${phase}</div>`;
  }
  $("readout").innerHTML = `
    <div>Intensity <b>${conductor.intensity.toFixed(2)}</b></div>
    <div>Mix <b>${info.w.map((v) => Math.round(v * 100)).join(" / ")}</b></div>
    <div>Filter <b>${Math.round(info.cutoff)} Hz</b></div>
    <div>Grains <b>${grains.density.toFixed(0)}/s</b></div>
    ${session}`;
  drawCurve();
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function drawCurve() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);

  // state zones
  cctx.strokeStyle = MUTED;
  cctx.globalAlpha = 0.35;
  cctx.setLineDash([3, 4]);
  cctx.font = "10px -apple-system, sans-serif";
  cctx.fillStyle = MUTED;
  [[0, "dark"], [0.5, "mid"], [1, "bright"]].forEach(([v, name]) => {
    const y = 8 + (1 - v) * (h - 16);
    cctx.beginPath(); cctx.moveTo(0, y); cctx.lineTo(w, y); cctx.stroke();
    cctx.fillText(name, 6, y - 3 < 10 ? y + 11 : y - 3);
  });
  cctx.setLineDash([]);
  cctx.globalAlpha = 1;

  // intensity history (last 2 min, newest on the right)
  const hist = conductor.history;
  if (hist.length < 2) return;
  cctx.strokeStyle = ACCENT;
  cctx.lineWidth = 2;
  cctx.beginPath();
  hist.forEach((v, n) => {
    const x = w - (hist.length - 1 - n) * (w / 239);
    const y = 8 + (1 - v) * (h - 16);
    n ? cctx.lineTo(x, y) : cctx.moveTo(x, y);
  });
  cctx.stroke();
}

// ---------- Init ----------
(async function init() {
  applyAM();
  gMix($("g-mix").value / 100);
  conductor.manual = $("intensity").value / 100;
  renderReadout(applyIntensity(conductor.manual, ctx.currentTime), ctx.currentTime);
  const bufs = await Promise.all([0, 0.5, 1].map((b, k) => renderPlaceholder(b, PLACEHOLDER_LEN[k])));
  bufs.forEach((buf, k) => {
    placeholders[k] = buf;
    if (!slotInfo[k].user) setBuffer(k, buf, null, false);
  });
  playBtn.disabled = false;
  statusEl.textContent = "Ready. Drop your own files on the slots any time, even while playing.";
})();
