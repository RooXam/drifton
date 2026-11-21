// Sketch page: the project, the views and the controls, wired together.
//
// `app` is the shared state every view reads: the project, the selected slot, the
// transport. Every change to the project goes through app.edit(), which keeps an undo
// step, saves (localStorage) and redraws.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const $ = (id) => document.getElementById(id);

// ---- Projects, saved on this device ----

const store = ProjectStore.load() || (() => {
  const p = demoProject();
  return { current: p.id, projects: [p] };
})();

// Settings of this device, not of the project.
const PREFS_KEY = "drifton.sketch.prefs.v1";
const prefs = { volume: 80, space: 30, echo: 25, tapMode: "launch", view: "edit", velocity: 80, open: {} };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

const sound = new SketchSound(ctx);

const app = {
  ctx, sound, store,
  sel: { track: 2, slot: 0 },
  tapMode: prefs.tapMode,
  recording: false,
  velocity: prefs.velocity / 100,
  undoStack: [],
  get project() { return store.projects.find((p) => p.id === store.current); },

  select(track, slot) {
    this.sel = { track, slot };
    editor.selected();
    renderAll();
  },

  // Keep an undo step. `merge`: a slider being dragged makes one step, not hundreds.
  snapshot(merge) {
    const now = Date.now();
    if (merge && this.lastMerge === merge && now - this.lastMergeAt < 1500) { this.lastMergeAt = now; return; }
    this.lastMerge = merge;
    this.lastMergeAt = now;
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 60) this.undoStack.shift();
  },

  edit(fn, opts = {}) {
    this.snapshot(opts.merge);
    fn();
    this.changed(opts);
  },

  // The project changed: save soon, redraw what is needed.
  changed(opts = {}) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(save, 300);
    if (opts.only === "none") return;
    if (opts.only === "editor") { grid.render(); editor.render(); renderClipHead(); }
    else renderAll();
  },

  undo() {
    const last = this.undoStack.pop();
    if (!last) return toast("Nothing to undo.");
    const i = store.projects.findIndex((p) => p.id === store.current);
    store.projects[i] = cleanProject(JSON.parse(last));
    applyProjectSound();
    this.changed();
    toast("Undone.");
  },

  refreshTransport,
};

function save() {
  if (!ProjectStore.save(store)) toast("Could not save on this device (storage full or blocked).");
}
window.addEventListener("pagehide", save);

const transport = new Transport(ctx, sound, () => app.project);
app.transport = transport;
transport.onBar = () => { grid.frame(); pads.status(); };
const grid = new SessionGrid($("grid"), app);
const editor = new ClipEditor(app);
app.editor = editor;
const pads = new PlayPads(app);

// ---- Drawing everything from the project ----

function renderAll() {
  const p = app.project;
  $("project-title").textContent = p.name;
  grid.render();
  renderClipHead();
  editor.render();
  pads.render();
  renderPadTracks();
  renderSong();
  renderMix();
  renderExport();
  renderProjects();
  refreshTransport();
}

function renderClipHead() {
  const p = app.project, { track, slot } = app.sel;
  const t = p.tracks[track], clip = t.clips[slot];
  const drums = TRACK_DEFS[track].drums;
  $("clip-dot").style.background = `var(--c-${t.id})`;
  $("clip-where").textContent = `${t.name} · slot ${slot + 1}`;
  $("clip-name").value = clip ? clip.name : "";
  $("clip-name").disabled = !clip;
  $("clip-empty").hidden = !!clip;
  $("clip-body").hidden = !clip;
  if (!clip) return;
  paintSeg("bars", String(clip.bars));
  paintSeg("scale-mode", p.chromatic ? "chromatic" : "scale");
  $("scale-mode").hidden = $("octave").hidden = $("transpose").hidden = $("to-focus").hidden = drums;
  $("edit-help").textContent = drums
    ? "Tap a step to add or remove a hit; new hits take the velocity above. The strip on top shows the whole clip: tap a bar to edit it."
    : "Tap to add a note, tap a note to remove it, drag sideways to set its length. Tap a note name to hear it. The velocity applies to new notes and to the last one touched.";
}

// Segmented control helpers: the button whose data-v is `value` is lit.
function paintSeg(id, value) {
  $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === value));
}
function onSeg(id, fn) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) fn(b.dataset.v, b);
  });
}

// ---- Transport bar ----

const PLAY_PATH = "M8 5v14l11-7z", STOP_PATH = "M7 7h10v10H7z";

function refreshTransport() {
  $("play").classList.toggle("playing", transport.running);
  $("play-icon").setAttribute("d", transport.running ? STOP_PATH : PLAY_PATH);
  $("rec").classList.toggle("on", app.recording);
  $("metro").classList.toggle("on", app.project.metronome);
  $("tempo-read").textContent = app.project.bpm + " bpm";
}

function togglePlay() {
  ctx.resume();
  if (transport.running) transport.stop();
  else {
    // Nothing to play: start the scene of the selected slot.
    const any = transport.tracks.some((t) => t.playing >= 0 || t.queued !== null);
    if (!any) transport.launchScene(app.sel.slot);
    else transport.start();
  }
  sound.fx.setActive(transport.running);
  refreshTransport();
  pads.status();
}
$("play").addEventListener("click", togglePlay);
$("stop-all").addEventListener("click", () => { transport.stopAll(); grid.frame(); });
$("undo").addEventListener("click", () => app.undo());
$("metro").addEventListener("click", () => app.edit(() => (app.project.metronome = !app.project.metronome)));

// Record: into the selected clip (made if the slot is empty), launched if needed.
function toggleRecord() {
  ctx.resume();
  if (app.recording) {
    app.recording = false;
  } else {
    const { track, slot } = app.sel;
    const clips = app.project.tracks[track].clips;
    app.snapshot();
    if (!clips[slot]) { clips[slot] = newClip(2, "Take"); app.changed(); }
    app.recording = true;
    const st = transport.tracks[track];
    if (!transport.running || (st.playing !== slot && st.queued !== slot)) transport.launch(track, slot);
    showView("play");
  }
  refreshTransport();
  grid.frame();
  pads.status();
}
$("rec").addEventListener("click", toggleRecord);

// Desktop shortcuts: space plays / stops, R records, 1–8 launch scenes, Cmd/Ctrl Z undoes.
document.addEventListener("keydown", (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "range" && e.target.type !== "checkbox") return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); app.undo(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    togglePlay();
  } else if (e.key === "r" || e.key === "R") toggleRecord();
  else if (/^[1-8]$/.test(e.key)) { transport.launchScene(+e.key - 1); refreshTransport(); grid.frame(); }
});

// ---- Session view options ----

paintSeg("tap-mode", app.tapMode);
onSeg("tap-mode", (v) => { app.tapMode = prefs.tapMode = v; paintSeg("tap-mode", v); savePrefs(); });

function showView(v) {
  prefs.view = v;
  savePrefs();
  paintSeg("view", v);
  $("edit-view").hidden = v !== "edit";
  $("play-view").hidden = v !== "play";
  if (v === "edit") editor.render();
}
onSeg("view", showView);

// ---- Clip editor toolbar ----

const clipNow = () => app.project.tracks[app.sel.track].clips[app.sel.slot];

onSeg("new-clip", (v) => app.edit(() => {
  app.project.tracks[app.sel.track].clips[app.sel.slot] = newClip(+v);
}));
$("clip-name").addEventListener("input", (e) => {
  const clip = clipNow();
  if (clip) app.edit(() => (clip.name = e.target.value.slice(0, 24)), { only: "editor", merge: "name" });
});
onSeg("bars", (v) => app.edit(() => ClipOps.setBars(clipNow(), +v), { only: "editor" }));
onSeg("scale-mode", (v) => app.edit(() => (app.project.chromatic = v === "chromatic")));
onSeg("octave", (v) => editor.shiftOctave(+v));

const velocity = $("velocity");
velocity.value = prefs.velocity;
$("velocity-out").textContent = prefs.velocity + "%";
velocity.addEventListener("input", () => {
  prefs.velocity = +velocity.value;
  app.velocity = prefs.velocity / 100;
  $("velocity-out").textContent = prefs.velocity + "%";
  savePrefs();
  editor.setVelocity(app.velocity);
});

document.querySelectorAll("#clip-body .actions").forEach((row) => row.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const { track, slot } = app.sel;
  const t = app.project.tracks[track];
  const clip = t.clips[slot];
  if (!clip) return;
  const a = b.dataset.a;
  if (a === "quantize") app.edit(() => ClipOps.quantize(clip), { only: "editor" });
  else if (a === "clear") app.edit(() => (clip.notes = []), { only: "editor" });
  else if (a === "double") {
    if (clip.bars >= 4) toast("Clips are 4 bars at most.");
    else app.edit(() => ClipOps.double(clip), { only: "editor" });
  } else if (a === "duplicate") {
    // Into the next empty slot below (then above), like a copy you can vary.
    let to = t.clips.findIndex((c, i) => i > slot && !c);
    if (to < 0) to = t.clips.findIndex((c) => !c);
    if (to < 0) return toast("No empty slot left on this track.");
    app.edit(() => (t.clips[to] = ClipOps.copy(clip)));
    app.select(track, to);
  } else if (a === "delete") {
    app.edit(() => (t.clips[slot] = null));
    toast("Clip deleted (Undo brings it back).");
  } else if (a.startsWith("t")) app.edit(() => ClipOps.transpose(clip, +a.slice(1)), { only: "editor" });
  else if (a === "export") exportClip(track, slot);
  else if (a === "focus") playInFocus(clip);
}));

async function exportClip(track, slot) {
  const bytes = SketchMidi.clip(app.project, track, slot);
  const name = `sketch-${TRACK_DEFS[track].id}-${slot + 1}.mid`;
  const how = await deliverFile(bytes, name, "audio/midi");
  if (how === "downloaded") toast(`Saved ${name}.`);
}

// The clip's chords, one per bar, as numerals → Focus music plays them.
function playInFocus(clip) {
  const numerals = Progression.fromClip(clip, app.project.key);
  if (!numerals) return toast("This clip has no notes yet.");
  save();
  location.href = `../generator/index.html?prog=${encodeURIComponent(numerals.join("-"))}&tonic=${app.project.key}`;
}

// ---- Pads view ----

function renderPadTracks() {
  $("pad-track").innerHTML = app.project.tracks.map((t, i) =>
    `<button data-v="${i}" class="${i === app.sel.track ? "active" : ""}" style="--c:var(--c-${t.id})">${t.name}</button>`).join("");
}
onSeg("pad-track", (v) => {
  const track = +v;
  // Keep the row; the pads play this track.
  app.select(track, app.sel.slot);
});
onSeg("pad-octave", (v) => pads.shiftOctave(+v));
$("capture").addEventListener("click", () => toast(pads.recorder.capture(app.sel.track)));

// ---- Song settings ----

function slider(id, format, get, set, merge) {
  const el = $(id);
  el.addEventListener("input", () => { set(+el.value); $(id + "-out").textContent = format(+el.value); });
  return () => { el.value = get(); $(id + "-out").textContent = format(get()); };
}

const songSliders = [
  slider("bpm", (v) => v + " bpm", () => app.project.bpm, (v) => {
    const old = transport.stepDur;
    app.edit(() => (app.project.bpm = v), { merge: "bpm", only: "none" });
    transport.retime(old);
    sound.setTempo(v);
    refreshTransport();
  }),
  slider("swing", (v) => v + "%", () => Math.round(app.project.swing * 100), (v) => {
    app.edit(() => (app.project.swing = v / 100), { merge: "swing", only: "none" });
  }),
];
NOTE_NAMES.forEach((n, i) => $("key").append(new Option(n, i)));
for (const [id, s] of Object.entries(SKETCH_SCALES)) $("scale").append(new Option(s.name, id));
$("key").addEventListener("change", (e) => app.edit(() => (app.project.key = +e.target.value)));
$("scale").addEventListener("change", (e) => app.edit(() => (app.project.scale = e.target.value)));
$("metronome").addEventListener("change", (e) => app.edit(() => (app.project.metronome = e.target.checked)));
$("quantize").addEventListener("change", (e) => app.edit(() => (app.project.quantize = e.target.checked)));

function renderSong() {
  const p = app.project;
  songSliders.forEach((r) => r());
  $("key").value = p.key;
  $("scale").value = p.scale;
  $("metronome").checked = p.metronome;
  $("quantize").checked = p.quantize;
}

// Device sliders: volume, space (reverb), echo.
const deviceSliders = {
  volume: (v) => setParam(ctx, sound.master.input.gain, v / 100, true),
  space: (v) => sound.fx.setReverb(v / 100),
  echo: (v) => sound.fx.setDelay(v / 100),
};
for (const [id, apply] of Object.entries(deviceSliders)) {
  const el = $(id);
  const run = () => { $(id + "-out").textContent = el.value + "%"; apply(+el.value); };
  el.value = prefs[id];
  run();
  el.addEventListener("input", () => { prefs[id] = +el.value; savePrefs(); run(); });
}

// ---- Tracks: sound and volume ----

function renderMix() {
  const p = app.project;
  $("mix").innerHTML = p.tracks.map((t, i) => {
    const sounds = TRACK_DEFS[i].drums ? "" : `<select data-sound="${i}" aria-label="${t.name} sound">` +
      Object.keys(STARTER_PATCHES).map((n) => `<option${n === t.sound ? " selected" : ""}>${n}</option>`).join("") + `</select>`;
    return `<div class="mix-row" style="--c:var(--c-${t.id})"><span class="mix-name"><i class="dot"></i>${t.name}</span>` +
      `${sounds}<input type="range" min="0" max="100" value="${Math.round(t.volume * 100)}" data-vol="${i}" aria-label="${t.name} volume"></div>`;
  }).join("");
}
$("mix").addEventListener("input", (e) => {
  const i = e.target.dataset.vol;
  if (i === undefined) return;
  const t = app.project.tracks[+i];
  app.edit(() => (t.volume = e.target.value / 100), { merge: "vol" + i, only: "none" });
  sound.setVolume(t.id, t.volume);
});
$("mix").addEventListener("change", (e) => {
  const i = e.target.dataset.sound;
  if (i === undefined) return;
  const t = app.project.tracks[+i];
  app.edit(() => (t.sound = e.target.value), { only: "none" });
  sound.setSound(t.id, t.sound);
});

// The project's tempo, sounds and volumes → the instruments.
function applyProjectSound() {
  const p = app.project;
  sound.setTempo(p.bpm);
  p.tracks.forEach((t) => {
    sound.setVolume(t.id, t.volume);
    if (t.sound) sound.setSound(t.id, t.sound);
  });
}

// ---- Export to Live ----

function renderExport() {
  const p = app.project, sel = $("export-scene"), keep = sel.value;
  sel.innerHTML = p.scenes.map((n, i) => `<option value="${i}">Scene ${i + 1}${n ? " · " + escapeHtml(n) : ""}</option>`).join("");
  sel.value = keep || String(app.sel.slot);
}
$("export-scene-btn").addEventListener("click", async () => {
  const row = +$("export-scene").value;
  const bytes = SketchMidi.scene(app.project, row);
  if (!bytes) return toast("This scene is empty.");
  const name = `sketch-scene-${row + 1}.mid`;
  const how = await deliverFile(bytes, name, "audio/midi");
  if (how === "downloaded") toast(`Saved ${name}.`);
});
$("rename-scene").addEventListener("click", () => {
  const row = +$("export-scene").value;
  const name = prompt(`Name of scene ${row + 1}`, app.project.scenes[row]);
  if (name !== null) app.edit(() => (app.project.scenes[row] = name.trim().slice(0, 24)));
});

// ---- Projects ----

function renderProjects() {
  $("projects").innerHTML = store.projects.map((p) =>
    `<button data-id="${p.id}" class="${p.id === store.current ? "active" : ""}">${escapeHtml(p.name)}</button>`).join("");
}

function openProject(id) {
  transport.stop();
  transport.tracks.forEach((t) => { t.playing = -1; t.queued = null; });
  app.recording = false;
  store.current = id;
  app.undoStack = [];
  app.sel = { track: 2, slot: 0 };
  editor.base = {};
  editor.selected();
  applyProjectSound();
  app.changed();
}
function addProject(p) {
  store.projects.push(p);
  openProject(p.id);
}

$("projects").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.id !== store.current) openProject(b.dataset.id);
});
$("p-new").addEventListener("click", () => {
  const p = newProject(`Sketch ${store.projects.length + 1}`);
  Object.assign(p, { bpm: app.project.bpm, key: app.project.key, scale: app.project.scale });
  addProject(p);
});
$("p-rename").addEventListener("click", () => {
  const name = prompt("Project name", app.project.name);
  if (name && name.trim()) app.edit(() => (app.project.name = name.trim().slice(0, 60)));
});
$("p-dup").addEventListener("click", () => {
  const p = cleanProject(JSON.parse(JSON.stringify(app.project)));
  p.id = newProject().id;
  p.name = (app.project.name + " copy").slice(0, 60);
  addProject(p);
});
$("p-del").addEventListener("click", () => {
  if (!confirm(`Delete “${app.project.name}”? This cannot be undone.`)) return;
  store.projects = store.projects.filter((p) => p.id !== store.current);
  if (!store.projects.length) store.projects.push(newProject("Sketch 1"));
  openProject(store.projects[0].id);
});
$("p-export").addEventListener("click", () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ drifton: "sketch", version: 1, project: app.project }, null, 1));
  deliverFile(bytes, `sketch-${slug(app.project.name)}.json`, "application/json");
});
$("p-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const p = cleanProject(data.project || data);
    p.id = newProject().id; // never overwrite a project already here
    addProject(p);
    toast(`Imported “${p.name}”.`);
  } catch {
    toast("This file is not a Sketch project.");
  }
});

// ---- Folding sections: remember which ones are open ----

document.querySelectorAll("details.fold").forEach((d) => {
  const k = d.dataset.fold;
  if (prefs.open[k] !== undefined) d.open = prefs.open[k];
  d.addEventListener("toggle", () => { prefs.open[k] = d.open; savePrefs(); });
});

// ---- A short message at the bottom of the screen ----

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ---- A progression sent by a link: ?prog=i-bVI-bIII-bVII&tonic=9 ----

function openProgression() {
  const q = new URLSearchParams(location.search);
  const prog = q.get("prog");
  if (!prog) return;
  try { history.replaceState(null, "", location.pathname); } catch {} // a reload must not add it again
  const tonic = ((parseInt(q.get("tonic"), 10) || 0) % 12 + 12) % 12;
  const numerals = prog.split("-").map((s) => s.trim()).filter(Boolean);
  const chords = Progression.voice(numerals, tonic);
  if (!chords.length) return toast("This progression could not be read.");

  // The first empty row of the current project, or a new project.
  let row = app.project.tracks[0].clips.findIndex((_, r) => app.project.tracks.every((t) => !t.clips[r]));
  if (row < 0) {
    const p = newProject("Progression");
    store.projects.push(p);
    store.current = p.id;
    row = 0;
  }
  const p = app.project;
  app.snapshot();
  const tonicChord = numerals.map(parseNumeral).find((n) => n && n.step === 0 && n.acc === 0);
  p.key = tonic;
  p.scale = tonicChord && tonicChord.lower ? "minor" : "major";
  const [drums, bass, , pad] = p.tracks;
  drums.clips[row] = Progression.beatClip();
  bass.clips[row] = Progression.bassClip(chords);
  pad.clips[row] = Progression.padClip(chords);
  p.scenes[row] = "Progression";
  app.sel = { track: 3, slot: row };
  save();
  toast(`Progression added as scene ${row + 1}.`);
}

// ---- Start ----

openProgression();
applyProjectSound();
editor.selected();
showView(prefs.view);
renderAll();

function frame() {
  grid.frame();
  editor.frame();
  const heard = ctx.currentTime - (ctx.outputLatency || 0);
  if (transport.running) {
    const s = Math.max(0, Math.floor(transport.stepAt(heard)));
    $("pos").textContent = `${Math.floor(s / 16) + 1}.${Math.floor((s % 16) / 4) + 1}`;
  } else $("pos").textContent = "–";
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
