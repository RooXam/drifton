// Generator page ("Focus music"): creates the instruments, the effects, the harmony and
// the generator, wires the controls (remembered in the browser) and draws the piano roll.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const master = new MasterBus(ctx);
master.input.gain.value = 0.8;
const fx = new FxBus(ctx, master.input); // ../synth/effects.js: reverb, echo, warmth, pulse

// reverb / delay: how much of each instrument goes to the room and to the echo.
const ROLES = [
  { id: "pad", name: "Pad", patch: "Pad", volume: 1, reverb: 0.45, delay: 0.08 },
  { id: "bass", name: "Bass", patch: "Bass", volume: 0.6, reverb: 0.12, delay: 0 },
  { id: "keys", name: "Keys", patch: "Keys", volume: 0.55, reverb: 0.45, delay: 0.32 },
  { id: "bells", name: "Bells", patch: "Bells", volume: 0.75, reverb: 0.6, delay: 0.45 },
  { id: "texture", name: "Texture", patch: "Texture", volume: 0.35, reverb: 0.5, delay: 0.1 },
];

// Each instrument uses the sound saved on the synth page (or its starter sound).
// The volume is the generator's own mix, not part of the sound. After each synth, a
// "layer" gain lets the conductor fade the instrument in and out.
const synths = {}, layers = {};
for (const r of ROLES) {
  layers[r.id] = ctx.createGain();
  layers[r.id].connect(fx.input);
  fx.connect(layers[r.id], r.reverb, r.delay);
  synths[r.id] = new Synth(ctx, { ...currentPatch(r.patch), volume: r.volume }, layers[r.id]);
}
synths.keys.maxVoices = 14; // arpeggio notes ring over each other

// The synth page is open in another tab and a sound changed: apply it right away.
PatchStore.onChange(() => {
  for (const r of ROLES) {
    const s = synths[r.id];
    s.loadPatch({ ...currentPatch(r.patch), volume: s.params.volume });
  }
});

const harmony = new Harmony(2, "dorian"); // D dorian
const gen = new Generator(ctx, synths, harmony, layers);

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const colors = Object.fromEntries(ROLES.map((r) => [r.id, css.getPropertyValue(`--c-${r.id}`).trim()]));

// ---- Settings, remembered in the browser ----

const SAVE_KEY = "drifton.focus.v1";
const prefs = { mood: "auto", key: 2, volume: 80, evolve: true, volumes: {}, on: {}, open: {} };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch {}
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(prefs)); } catch {} };

// Folding sections: remember which ones are open.
document.querySelectorAll("details.fold").forEach((d) => {
  const k = d.dataset.fold;
  if (prefs.open[k] !== undefined) d.open = prefs.open[k];
  d.addEventListener("toggle", () => { prefs.open[k] = d.open; save(); });
});

// Forget every saved setting and start again from the defaults.
document.getElementById("reset").addEventListener("click", () => {
  if (!confirm("Reset all Focus music settings to the defaults?")) return;
  try { localStorage.removeItem(SAVE_KEY); } catch {}
  location.href = location.pathname; // reload, without ?mood=…
});

// ---- Transport ----

const playBtn = $("play");
const PLAY_PATH = "M8 5v14l11-7z";
const STOP_PATH = "M7 7h10v10H7z";

playBtn.addEventListener("click", async () => {
  await ctx.resume();
  if (gen.running) gen.stop();
  else gen.start();
  fx.setActive(gen.running);
  playBtn.classList.toggle("playing", gen.running);
  document.querySelectorAll(".play-path").forEach((p) => p.setAttribute("d", gen.running ? STOP_PATH : PLAY_PATH));
});

$("volume").value = prefs.volume;
setParam(ctx, master.input.gain, prefs.volume / 100, false);
$("volume").addEventListener("input", (e) => {
  prefs.volume = Number(e.target.value);
  setParam(ctx, master.input.gain, prefs.volume / 100, true);
  save();
});

// ---- Sliders: each one has an output text and does something when it moves ----

function slider(id, format, apply) {
  const el = $(id);
  const run = () => {
    const v = Number(el.value);
    $(id + "-out").textContent = format(v);
    apply(v);
  };
  el.addEventListener("input", () => { run(); prefs[id] = Number(el.value); save(); });
  if (prefs[id] !== undefined) el.value = prefs[id];
  run();
  return { set(v) { el.value = v; prefs[id] = v; run(); } };
}

const pct = (v) => Math.round(v) + "%";
let pulseRate = 16; // set by the mood (Hz)
const ctl = {
  bpm: slider("bpm", (v) => v + " bpm", (v) => { gen.bpm = v; fx.setDelayTime((60 / v) * 0.75); }),
  chordLen: slider("chord-len", (v) => v + " s", (v) => (gen.chordSeconds = v)),
  density: slider("density", pct, (v) => gen.setDensity(v / 100)),
  movement: slider("movement", pct, (v) => (gen.movement = v / 100)),
  space: slider("space", pct, (v) => fx.setReverb(v / 100)),
  echo: slider("echo", pct, (v) => fx.setDelay(v / 100)),
  warmth: slider("warmth", pct, (v) => fx.setWarmth(v / 100)),
  pulse: slider("pulse", pct, (v) => fx.setPulse(v / 100, pulseRate)),
  tape: slider("tape", pct, (v) => fx.setTape(v / 100)),
};

// ---- Harmony controls ----

const keySel = $("key");
NOTE_NAMES.forEach((n, i) => keySel.append(new Option(n, i, false, i === prefs.key)));
if (prefs.mode) $("mode").value = prefs.mode;
function applyKey() {
  harmony.setKey(Number(keySel.value), $("mode").value);
  prefs.key = Number(keySel.value);
  prefs.mode = $("mode").value;
  save();
}
keySel.addEventListener("change", applyKey);
$("mode").addEventListener("change", applyKey);
applyKey();

// ---- Moods: set everything at once ----

const moodsEl = $("moods");
function applyMood(id, keepSliders = false) {
  const real = id === "auto" ? moodForNow() : id;
  const m = MOODS[real];
  prefs.mood = id;
  if (id === "auto") prefs.autoMood = real; // the mood Auto applied, to notice when the hour changes it
  pulseRate = m.pulseRate;
  harmony.setStyle(m.chords);
  gen.riff = m.riff;
  if (!keepSliders) {
    $("mode").value = m.mode;
    applyKey();
    ctl.bpm.set(m.bpm);
    ctl.chordLen.set(m.chordSeconds);
    ctl.density.set(Math.round(m.density * 100));
    ctl.movement.set(Math.round(m.movement * 100));
    ctl.space.set(Math.round(m.reverb * 100));
    ctl.echo.set(Math.round(m.delay * 100));
    ctl.warmth.set(Math.round(m.warmth * 100));
    ctl.tape.set(Math.round(m.tape * 100));
  }
  ctl.pulse.set(keepSliders && prefs.pulse !== undefined ? prefs.pulse : Math.round(m.pulse * 100));
  moodsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === id));
  $("mood-help").textContent = (id === "auto" ? `Auto, from the time of day: ${m.label}. ` : "") + m.help;
  save();
}
moodsEl.innerHTML = `<button data-v="auto">Auto</button>` +
  Object.entries(MOODS).map(([id, m]) => `<button data-v="${id}">${m.label}</button>`).join("");
moodsEl.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) applyMood(b.dataset.v);
});
// First visit: the mood sets everything. Later visits: keep my own tweaks, except in
// Auto when the time of day now calls for another mood.
const hourChanged = () => prefs.mood === "auto" && moodForNow() !== prefs.autoMood;
// A link can open a mood directly: generator/index.html?mood=drone (the old Drone page).
const asked = new URLSearchParams(location.search).get("mood");
if (MOODS[asked]) applyMood(asked);
else applyMood(prefs.mood, prefs.bpm !== undefined && !hourChanged());
// While the page is open, Auto follows the clock (checked every minute).
setInterval(() => { if (hourChanged()) applyMood("auto"); }, 60000);

// ---- Instruments ----

const rolesEl = $("roles");
const legend = $("legend");
for (const r of ROLES) {
  const row = document.createElement("div");
  row.className = "role";
  row.style.setProperty("--c", colors[r.id]);
  const vol = prefs.volumes[r.id] ?? Math.round(r.volume * 100);
  const on = prefs.on[r.id] ?? true;
  row.innerHTML = `
    <label class="name"><input type="checkbox" ${on ? "checked" : ""}><span class="dot"></span>${r.name}</label>
    <input type="range" min="0" max="100" value="${vol}" aria-label="${r.name} volume">
    <a class="edit" href="../synth/index.html#${r.patch}" target="_blank" rel="noopener">Edit</a>`;
  const [check, range] = row.querySelectorAll("input");
  gen.on[r.id] = on;
  synths[r.id].set("volume", vol / 100);
  check.addEventListener("change", () => { gen.setRole(r.id, check.checked); prefs.on[r.id] = check.checked; save(); });
  range.addEventListener("input", () => { synths[r.id].set("volume", range.value / 100); prefs.volumes[r.id] = Number(range.value); save(); });
  rolesEl.append(row);

  const tag = document.createElement("span");
  tag.style.setProperty("--c", colors[r.id]);
  tag.textContent = r.name;
  legend.append(tag);
}

$("evolve").checked = prefs.evolve;
gen.evolve = prefs.evolve;
$("evolve").addEventListener("change", (e) => { gen.setEvolve(e.target.checked); prefs.evolve = e.target.checked; save(); });

// ---- Display: chord name and piano roll ----

const WINDOW = 45;          // seconds shown in the piano roll
const LOW = 30, HIGH = 92;  // MIDI range shown

function drawRoll() {
  const canvas = $("roll");
  const g = prepCanvas(canvas);
  const { width: W, height: H } = canvas;
  const now = ctx.currentTime;
  const dpr = devicePixelRatio;
  const rowH = H / (HIGH - LOW);
  const X = (t) => W - ((now - t) / WINDOW) * W;
  const Y = (note) => H - (note - LOW + 1) * rowH;

  // Faint line on every C.
  g.fillStyle = css.getPropertyValue("--muted").trim();
  g.globalAlpha = 0.18;
  for (let n = LOW; n <= HIGH; n++) if (n % 12 === 0) g.fillRect(0, Y(n) + rowH / 2, W, dpr);

  // Chord changes: vertical line + name.
  g.font = `${11 * dpr}px sans-serif`;
  for (const c of gen.chords) {
    if (c.t > now || c.t < now - WINDOW) continue;
    g.globalAlpha = 0.3;
    g.fillRect(X(c.t), 0, dpr, H);
    g.globalAlpha = 0.8;
    g.fillText(c.name, X(c.t) + 4 * dpr, 14 * dpr);
  }

  // Notes.
  for (const n of gen.notes) {
    if (n.start > now) continue;
    const x0 = X(n.start);
    const x1 = X(Math.min(n.end, now));
    if (x1 < 0) continue;
    g.fillStyle = colors[n.role];
    g.globalAlpha = n.end > now ? 0.95 : 0.55;
    g.fillRect(x0, Y(n.note), Math.max(4 * dpr, x1 - x0), Math.max(3 * dpr, rowH - dpr));
  }
  g.globalAlpha = 1;
}

function updateReadout() {
  const now = ctx.currentTime;
  const chord = gen.running ? gen.chordAt(now) : null;
  $("chord").innerHTML = chord ? `${chord.name}<small>${chord.roman}</small>` : "—";
  const keyName = `${NOTE_NAMES[harmony.root]} ${harmony.mode}`;
  $("status").textContent = gen.running
    ? `${keyName}, next chord in ${Math.max(0, Math.round(gen.nextChord - now))} s`
    : `${keyName}, press play`;
}

// ---- Visualizer (visual.js), and its full-screen mode ----

const visual = new Visualizer($("visual-canvas"), master.analyser, gen, fx);
const visualBox = $("visual");
let wakeLock = null;

$("v-play").addEventListener("click", () => playBtn.click());
// Full screen is done in CSS (the box covers the window): it works on iPhone too, where
// pages cannot ask for real full screen. The screen is kept awake meanwhile.
async function immerse(on) {
  visualBox.classList.toggle("immersive", on);
  document.body.classList.toggle("no-scroll", on);
  $("v-full").setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
  document.querySelector(".v-full-path").setAttribute("d", on
    ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5");
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
$("v-full").addEventListener("click", () => immerse(!visualBox.classList.contains("immersive")));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") immerse(false); });

// Draw the visual only while it is on screen.
let visualShown = true;
new IntersectionObserver(([e]) => (visualShown = e.isIntersecting)).observe(visualBox);

function frame() {
  if (visualShown) visual.draw();
  drawRoll();
  updateReadout();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
