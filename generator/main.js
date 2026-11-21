// Generator page ("Focus music"): creates the instruments, the effects, the harmony and
// the generator, wires the controls (remembered in the browser) and draws the piano roll.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const master = new MasterBus(ctx);
master.input.gain.value = 0.8;
// The end of a session fades everything out here, before the volume.
const sessionFade = ctx.createGain();
sessionFade.connect(master.input);
const fx = new FxBus(ctx, sessionFade); // ../synth/effects.js: reverb, echo, warmth, pulse

const ROLES = [
  { id: "pad", name: "Pad", patch: "Pad", volume: 1 },
  { id: "bass", name: "Bass", patch: "Bass", volume: 0.6 },
  { id: "keys", name: "Keys", patch: "Keys", volume: 0.55 },
  { id: "bells", name: "Bells", patch: "Bells", volume: 0.75 },
  { id: "texture", name: "Texture", patch: "Texture", volume: 0.35 },
];

// Each instrument uses the sound saved on the synth page (or its starter sound), with
// its own effects: chorus inside the synth, and how much goes to the room and the echo
// (the sound's "fx.reverb" / "fx.delay"). The volume is the generator's own mix, not
// part of the sound. After each synth, a "layer" gain lets the conductor fade the
// instrument in and out. Pad and texture first go through a "breathing" filter
// (session.js) that opens and closes slowly.
const synths = {}, layers = {}, sends = {}, breath = {};
for (const r of ROLES) {
  const patch = currentPatch(r.patch);
  layers[r.id] = ctx.createGain();
  layers[r.id].connect(fx.input);
  sends[r.id] = fx.connect(layers[r.id], patch["fx.reverb"], patch["fx.delay"]);
  let out = layers[r.id];
  if (r.id === "pad" || r.id === "texture") {
    breath[r.id] = new BreathFilter(ctx, r.id === "pad" ? 2000 : 2600);
    breath[r.id].output.connect(layers[r.id]);
    out = breath[r.id].input;
  }
  synths[r.id] = new Synth(ctx, { ...patch, volume: r.volume }, out);
}
synths.keys.maxVoices = 14; // arpeggio notes ring over each other

// The synth page is open in another tab and a sound changed: apply it right away.
PatchStore.onChange(() => {
  for (const r of ROLES) {
    const s = synths[r.id];
    s.loadPatch({ ...currentPatch(r.patch), volume: s.params.volume });
    fx.setSends(sends[r.id], s.params["fx.reverb"], s.params["fx.delay"]);
  }
});

const harmony = new Harmony(2, "dorian"); // D dorian
const gen = new Generator(ctx, synths, harmony, layers);

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const colors = Object.fromEntries(ROLES.map((r) => [r.id, css.getPropertyValue(`--c-${r.id}`).trim()]));

// ---- Settings, remembered in the browser ----

const SAVE_KEY = "drifton.focus.v1";
const prefs = { mood: "auto", key: 2, volume: 80, evolve: true, session: 0, volumes: {}, on: {}, open: {} };
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

// ---- Session: its arc, the slow drift, and what the music actually plays ----

// What the sliders say. The music plays values moved a little around them by the
// session arc, the slow drift and your learned tastes (steer), so the sliders never
// jump around by themselves.
const base = { bpm: 72, density: 0.35, movement: 0.4, reverb: 0.35, warmth: 0.55 };
let mood = MOODS.focus;  // the mood in use (Auto: the one it picked)
let moodId = "focus";
const taste = new Taste(); // taste.js: what Like / Dislike / Skip have taught it
let session = null;      // while playing: { start, arc, fading }
// Typical drift: ±6 % density, ±4 % movement, brightness ±0.05 (on the warmth and the
// breathing filters). Small on purpose: you should not notice it, only feel it.
const drift = new Drift({ density: 0.06, movement: 0.04, bright: 0.05 });

function steer() {
  const t = session ? ctx.currentTime - session.start : 0;
  const e = session ? session.arc.energy(t) : 1; // 0.45 at the start and end, 1 in the middle
  const d = drift.x;
  const k = taste.offsets(moodId);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  // Low energy: fewer bells, less rhythm, a darker sound, one optional layer at a time.
  gen.density = clamp((base.density + k.density + d.density) * (0.35 + 0.65 * e));
  gen.movement = clamp((base.movement + k.movement + d.movement) * (0.5 + 0.5 * e));
  const bright = k.bright + d.bright;
  fx.setWarmth(clamp(base.warmth - bright + (1 - e) * 0.25));
  fx.setReverb(clamp(base.reverb + k.reverb));
  const bpm = Math.round(Math.min(115, Math.max(45, base.bpm + k.tempo)));
  if (gen.bpm !== bpm) { gen.bpm = bpm; fx.setDelayTime((60 / bpm) * 0.75); }
  gen.maxLayers = Math.min(mood.layers || 2, e < 0.75 ? 1 : 2);
  // The breathing filters: up to an octave darker at low energy, and drifting too.
  for (const b of Object.values(breath)) b.setBase(-(1 - e) * 1.8 + bright * 4);
}

function makeArc(skipRise) {
  return new SessionArc(prefs.session, { shape: mood.arc, fade: mood.fade || 75, skipRise });
}

// Every 2 seconds while playing: drift a little, follow the arc, end the session.
setInterval(() => {
  if (!session) return;
  drift.step(2);
  steer();
  const t = ctx.currentTime - session.start;
  if (!session.fading && t >= session.arc.fadeAt) fadeOut(session.arc.endAt - t);
  if (t >= session.arc.endAt) stopPlaying();
}, 2000);

// The end of a session: everything fades out, slowly (a falling curve in decibels,
// the way a hand turns a volume knob down), then the music stops.
function fadeOut(seconds) {
  session.fading = true;
  const g = sessionFade.gain, now = ctx.currentTime;
  holdAt(g, now);
  g.exponentialRampToValueAtTime(0.001, now + seconds);
  g.setValueAtTime(0, now + seconds);
}

function cancelFade() {
  const g = sessionFade.gain;
  holdAt(g, ctx.currentTime);
  g.setTargetAtTime(1, ctx.currentTime, 0.5);
}

// ---- Transport ----

const playBtn = $("play");
const PLAY_PATH = "M8 5v14l11-7z";
const STOP_PATH = "M7 7h10v10H7z";

function startPlaying() {
  const g = sessionFade.gain;
  g.cancelScheduledValues(0);
  g.setValueAtTime(1, ctx.currentTime);
  session = { start: ctx.currentTime + 0.1, arc: makeArc(false), fading: false };
  steer(); // the arc's gentle start, before the first notes
  gen.start();
  showPlaying();
}

function stopPlaying() {
  gen.stop();
  session = null;
  steer();
  showPlaying();
}

function showPlaying() {
  fx.setActive(gen.running);
  document.querySelectorAll(".taste button").forEach((b) => (b.disabled = !gen.running));
  playBtn.classList.toggle("playing", gen.running);
  document.querySelectorAll(".play-path").forEach((p) => p.setAttribute("d", gen.running ? STOP_PATH : PLAY_PATH));
}

playBtn.addEventListener("click", async () => {
  await ctx.resume();
  if (gen.running) stopPlaying();
  else startPlaying();
});

// ---- Learn my tastes: Like, Dislike, Skip (taste.js) ----

const TASTE_SAYS = {
  up: "Noted: more like this.",
  down: "Noted: less like this. Trying something else.",
  skip: "Trying something else.",
};
let tasteTimer = null;
function showTaste() {
  const said = taste.describe(moodId);
  $("taste-info").textContent = said ? `Learned for ${mood.label}, ${said}` : `Like, Dislike and Skip teach it your taste for each mood.`;
  $("forget").hidden = !Object.values(taste.moods).some((s) => s.votes);
}
document.querySelector(".taste").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-vote]");
  if (!b || !gen.running) return;
  const kind = b.dataset.vote;
  taste.vote(moodId, kind);
  steer();                           // the new variant, from now on
  if (kind === "skip") gen.skip();   // and a new chord at the next bar
  $("taste-msg").textContent = TASTE_SAYS[kind];
  clearTimeout(tasteTimer);
  tasteTimer = setTimeout(() => ($("taste-msg").textContent = ""), 3500);
  showTaste();
});
$("forget").addEventListener("click", () => {
  if (!confirm("Forget what Like, Dislike and Skip have taught, for every mood?")) return;
  taste.forget();
  steer();
  showTaste();
});

// Session length: endless, or a number of minutes with a beginning, a middle and an end.
const SESSIONS = [0, 15, 25, 50, 90];
const sessionEl = $("session");
sessionEl.innerHTML = SESSIONS.map((m) => `<button data-v="${m}">${m ? m + " min" : "Endless"}</button>`).join("");
function setSession(minutes) {
  prefs.session = minutes;
  save();
  sessionEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.v) === minutes));
  // Changed while playing: the new length counts from now, without a second gentle start.
  if (session) {
    if (session.fading) cancelFade();
    session = { start: ctx.currentTime, arc: makeArc(true), fading: false };
    steer();
  }
}
sessionEl.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) setSession(Number(b.dataset.v));
});
if (!SESSIONS.includes(prefs.session)) prefs.session = 0;
setSession(prefs.session);

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
  bpm: slider("bpm", (v) => v + " bpm", (v) => { base.bpm = v; steer(); }),
  chordLen: slider("chord-len", (v) => v + " s", (v) => (gen.chordSeconds = v)),
  density: slider("density", pct, (v) => { base.density = v / 100; steer(); gen.setDensity(gen.density); }),
  movement: slider("movement", pct, (v) => { base.movement = v / 100; steer(); }),
  space: slider("space", pct, (v) => { base.reverb = v / 100; steer(); }),
  echo: slider("echo", pct, (v) => fx.setDelay(v / 100)),
  warmth: slider("warmth", pct, (v) => { base.warmth = v / 100; steer(); }),
  pulse: slider("pulse", pct, (v) => fx.setPulse(v / 100, pulseRate)),
  tape: slider("tape", pct, (v) => fx.setTape(v / 100)),
};

// ---- Harmony controls ----

const keySel = $("key");
NOTE_NAMES.forEach((n, i) => keySel.append(new Option(n, i, false, i === prefs.key)));
if (prefs.mode) $("mode").value = prefs.mode;
let linked = null; // a progression from the Progressions page: { numerals, key } (below)
function applyKey() {
  const key = Number(keySel.value);
  harmony.setKey(key, $("mode").value);
  if (linked) {
    // The key of a linked progression is not saved: it is the link's, not yours. A new
    // key transposes the progression.
    if (key !== linked.key) { linked.key = key; gen.setProgression(progressionChords(linked.numerals, key)); showLinked(); }
    return;
  }
  prefs.key = key;
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
  mood = m;
  moodId = real;
  // A mood with its own session length (Sleep) sets it when chosen by hand, if none was set.
  if (!keepSliders && id !== "auto" && m.session && !prefs.session) setSession(m.session);
  // Playing: the session keeps its start, with this mood's arc and fade.
  if (session && !session.fading) session.arc = makeArc(ctx.currentTime - session.start > session.arc.rise);
  pulseRate = m.pulseRate;
  harmony.setStyle(m.chords);
  gen.riff = m.riff;
  if (!keepSliders) {
    if (!linked) { $("mode").value = m.mode; applyKey(); } // a progression keeps its own key
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
  steer();
  showTaste();
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

// ---- A progression chosen on the Progressions page ----
// generator/index.html?prog=I-V-vi-IV&tonic=0 (&mood=calm): loop those chords, one per
// chord change, in that key, instead of the generator's own chain. The numerals are
// read by ../progressions/theory.js, like on the Progressions page.
function linkProgression() {
  const q = new URLSearchParams(location.search);
  if (!q.get("prog")) return;
  // A "+" (augmented chord) left unencoded in a link arrives as a space: put it back.
  const numerals = q.get("prog").replace(/ /g, "+").split("-").map((n) => n.trim()).filter(Boolean);
  const tonic = Number(q.get("tonic"));
  const key = Number.isInteger(tonic) && tonic >= 0 && tonic < 12 ? tonic : Number(keySel.value);
  const chords = progressionChords(numerals, key);
  if (!chords.length) return;
  linked = { numerals: chords.map((c) => c.roman), key };
  gen.setProgression(chords);
  // The bells walk on the key's scale: natural minor if the tonic chord is minor ("i"),
  // else major.
  const tonicChord = linked.numerals.map(parseNumeral).find((n) => n.step === 0 && n.acc === 0);
  keySel.value = key;
  $("mode").value = tonicChord && tonicChord.lower ? "aeolian" : "ionian";
  harmony.setKey(key, $("mode").value);
  showLinked();
}

function showLinked() {
  $("prog-note").hidden = !linked;
  if (linked) $("prog-what").textContent = `${linked.numerals.join(" – ")} in ${KEY_NAMES[linked.key]}`;
}

// Back to the generator's own chords, in your key and mode; the address loses the link.
$("prog-clear").addEventListener("click", () => {
  linked = null;
  gen.setProgression(null);
  try { history.replaceState(null, "", location.pathname); } catch {}
  keySel.value = prefs.key;
  $("mode").value = prefs.mode || mood.mode;
  applyKey();
  showLinked();
});
linkProgression();

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
  let left = "";
  if (session && session.fading) left = " · fading out";
  else if (session && !session.arc.endless) left = ` · ${Math.max(1, Math.ceil((session.arc.endAt - (now - session.start)) / 60))} min left`;
  $("status").textContent = gen.running
    ? `${keyName}, next chord in ${Math.max(0, Math.round(gen.nextChord - now))} s${left}`
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
