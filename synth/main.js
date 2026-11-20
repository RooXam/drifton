// Wires everything together: creates the instruments, builds the controls from
// PARAM_GROUPS, the keyboard and the visualisations.
//
// There are several instruments (one Synth each, see patches.js). The controls and the
// keyboard always act on the selected one; the others keep their sound and any notes
// left ringing in Hold mode.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const master = new MasterBus(ctx);
const instruments = Object.keys(STARTER_PATCHES).map((name) => ({
  name,
  synth: new Synth(ctx, currentPatch(name), master.input),
}));
let current = instruments[0];

const controls = {};    // param key → { def, input, output, seg, select }
const envCanvases = []; // { canvas, prefix }
const lfoTraces = [];   // { canvas, index, values }
const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

const $ = (id) => document.getElementById(id);

// Browsers only let audio start after a user gesture (click / key press).
const statusEl = $("status");
function wake() { if (ctx.state !== "running") ctx.resume(); }
function showState() {
  statusEl.textContent = ctx.state === "running" ? "" : "Audio is asleep: click anywhere or press a key.";
}
ctx.onstatechange = showState;
document.addEventListener("pointerdown", wake, true);
document.addEventListener("keydown", wake, true);
showState();

// ---- Controls ----

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Sliders work on positions; "log" params need converting between position and value.
function toSlider(def, v) {
  return def.curve === "log" ? Math.round((1000 * Math.log(v / def.min)) / Math.log(def.max / def.min)) : v;
}
function fromSlider(def, pos) {
  return def.curve === "log" ? def.min * Math.pow(def.max / def.min, pos / 1000) : Number(pos);
}

// `compact`: no label in front (used in the modulation matrix).
function makeControl(def, compact) {
  if (def.type === "choice") {
    // A <div>, not a <label>: clicking a label holding buttons would press the first one.
    const row = el("div", "row");
    if (!compact) row.append(el("span", null, def.label));
    const seg = el("div", "seg");
    for (const opt of def.options) {
      const b = el("button", null, opt.label);
      b.type = "button";
      b.dataset.value = opt.value;
      b.addEventListener("click", () => setValue(def.key, opt.value));
      seg.append(b);
    }
    row.append(seg);
    controls[def.key] = { def, seg };
    return row;
  }

  const row = el("label", "row");
  if (!compact) row.append(el("span", null, def.label));

  if (def.type === "select") {
    const select = el("select");
    select.setAttribute("aria-label", def.label);
    for (const opt of def.options) {
      const o = el("option", null, opt.label);
      o.value = opt.value;
      select.append(o);
    }
    select.addEventListener("change", () => setValue(def.key, select.value));
    row.append(select);
    controls[def.key] = { def, select };
    return row;
  }

  const input = el("input");
  input.type = "range";
  input.setAttribute("aria-label", def.label);
  if (def.curve === "log") {
    input.min = 0; input.max = 1000; input.step = 1;
  } else {
    input.min = def.min; input.max = def.max; input.step = def.step;
  }
  input.addEventListener("input", () => setValue(def.key, fromSlider(def, input.value)));
  const output = el("output");
  row.append(input, output);
  controls[def.key] = { def, input, output };
  return row;
}

function buildControls(root) {
  for (const group of PARAM_GROUPS) {
    const section = el("section");
    section.append(el("h2", null, group.title));
    if (group.help) section.append(el("p", "help", group.help));
    if (group.env) {
      const canvas = el("canvas", "env-shape");
      section.append(canvas);
      envCanvases.push({ canvas, prefix: group.env });
    }
    if (group.lfo !== undefined) {
      const canvas = el("canvas", "lfo-trace");
      section.append(canvas);
      lfoTraces.push({ canvas, index: group.lfo, values: [] });
    }
    if (group.matrix) {
      // Params come in triples: source, destination, amount.
      for (let i = 0; i < group.params.length; i += 3) {
        const row = el("div", "mod-row");
        row.append(el("span", "mod-num", String(i / 3 + 1)));
        for (const def of group.params.slice(i, i + 3)) row.append(makeControl(def, true));
        section.append(row);
      }
    } else {
      for (const def of group.params) section.append(makeControl(def));
    }
    root.append(section);
  }
}

// Show a param's current value in its control.
function refresh(key) {
  const c = controls[key];
  const v = current.synth.params[key];
  if (c.seg) {
    for (const b of c.seg.children) b.classList.toggle("active", b.dataset.value === v);
  } else if (c.select) {
    c.select.value = v;
  } else {
    c.input.value = toSlider(c.def, v);
    c.output.textContent = formatValue(c.def, v);
  }
}

function refreshAll() {
  Object.keys(controls).forEach(refresh);
  drawEnvelopes();
}

function drawEnvelopes() {
  for (const { canvas, prefix } of envCanvases) {
    drawEnvelope(canvas, envFrom(current.synth.params, prefix), accent);
  }
}

function setValue(key, value) {
  current.synth.set(key, value);
  refresh(key);
  if (/^(amp|fenv)\./.test(key)) drawEnvelopes();
  scheduleSave(current);
}

// Back to the starter sound, and forget the saved one.
function resetPatch() {
  current.synth.loadPatch(makePatch(current.name));
  PatchStore.remove(current.name);
  refreshAll();
  updatePatchState();
}

// ---- Saving ----

// Every change is saved automatically, a moment after the last slider movement
// (no need to write to storage 60 times a second while dragging).
let saveTimer = null;
function scheduleSave(inst) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    PatchStore.set(inst.name, { ...inst.synth.params });
    updatePatchState();
  }, 300);
}

function updatePatchState(message) {
  const edited = !isStarterPatch(current.name, current.synth.params);
  $("patch-state").textContent = message || (edited ? "Edited · saved" : "Starter sound");
}

buildControls($("controls"));
window.addEventListener("resize", drawEnvelopes);

// ---- Instrument tabs ----

const tabs = $("instruments");
for (const inst of instruments) {
  const b = el("button", null, inst.name);
  b.type = "button";
  b.addEventListener("click", () => selectInstrument(inst));
  inst.tab = b;
  tabs.append(b);
}

function selectInstrument(inst) {
  current = inst;
  keyboard.setSynth(inst.synth);
  for (const i of instruments) i.tab.classList.toggle("active", i === inst);
  for (const t of lfoTraces) t.values = [];
  refreshAll();
  updatePatchState();
  // Keep the selected instrument in the address (#Bells), without adding history steps.
  try {
    history.replaceState(null, "", location.pathname + location.search + "#" + inst.name);
  } catch {}
}

// ---- Animation: LFO traces and "playing" dots on the tabs ----

function animate() {
  for (const t of lfoTraces) {
    t.values.push(current.synth.lfos[t.index].value());
    if (t.values.length > 240) t.values.shift();
    drawTrace(t.canvas, t.values, accent);
  }
  for (const inst of instruments) inst.tab.classList.toggle("sounding", inst.synth.voices.size > 0);
  requestAnimationFrame(animate);
}

// ---- Keyboard, buttons, scope ----

const octLabel = $("oct-label");
const keyboard = new Keyboard($("keyboard"), current.synth, (base) => { octLabel.textContent = noteName(base); });
octLabel.textContent = noteName(keyboard.base);

$("oct-down").addEventListener("click", () => keyboard.shiftOctave(-1));
$("oct-up").addEventListener("click", () => keyboard.shiftOctave(1));
$("hold").addEventListener("change", (e) => keyboard.setHold(e.target.checked));
$("panic").addEventListener("click", () => {
  keyboard.releaseAll();
  for (const inst of instruments) inst.synth.allOff();
});
$("reset").addEventListener("click", resetPatch);

// ---- Export / import a sound as a JSON file ----

$("export").addEventListener("click", () => {
  const data = { drifton: "patch", version: 1, instrument: current.name, params: current.synth.params };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `drifton-${current.name.toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow importing the same file again
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const patch = sanitizePatch(data.params || data, current.synth.params);
    current.synth.loadPatch(patch);
    PatchStore.set(current.name, { ...patch });
    refreshAll();
    updatePatchState(`Imported ${file.name}`);
  } catch {
    updatePatchState("This file is not a Drifton sound.");
  }
});

// Another tab changed the saved sounds (e.g. the same page open twice): follow it.
PatchStore.onChange(() => {
  for (const inst of instruments) inst.synth.loadPatch(currentPatch(inst.name));
  refreshAll();
  updatePatchState();
});

new Scope(master.analyser, $("scope"), $("spectrum"));
// "synth/index.html#Bells" opens on the Bells instrument (used by the generator's Edit links).
const fromHash = instruments.find((i) => i.name === decodeURIComponent(location.hash.slice(1)));
selectInstrument(fromHash || current);
requestAnimationFrame(animate);
