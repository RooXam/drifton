// Chord progressions page: pick a style, a progression, a key; listen; export MIDI.
// Also: favourites, a length filter, and progressions found in my own MIDI files.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const sound = new ChordSound(ctx);
const player = new ProgressionPlayer(ctx, sound);
const keys = new Keys(document.getElementById("keys"));
const guitar = new GuitarView(document.getElementById("guitar"));
const push = new PushView(document.getElementById("push"));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Styles with at least one progression (pop is the norm itself: nothing stands out).
const STYLE_LIST = PROGRESSION_DATA.styles.filter((s) => s.progressions.length);
// Two more lists next to the styles: my favourites, and my own progressions.
const FAV = "fav", MINE = "mine";
let lit = -1; // index of the chord lit in the strip

// ---- Settings, remembered in the browser ----

const SAVE_KEY = "drifton.progressions.v1";
const state = {
  style: "hiphop", pick: 0, key: 0, bpm: 80, rhythm: "push", colour: "colour", sound: "piano", volume: 80, view: "piano",
  voicing: "close", len: "any", pushLayout: "chromatic", per: "bar",
};
try { Object.assign(state, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch {}
if (!STYLE_LIST.some((s) => s.id === state.style) && state.style !== FAV && state.style !== MINE) state.style = STYLE_LIST[0].id;
if (!VOICINGS[state.voicing]) state.voicing = "close";
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch {}
}

// ---- Favourites: "style:numerals" ids, in the browser ----

const FAV_KEY = "drifton.progressions.favourites";
let favs = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []); } catch {}
const favId = (styleId, p) => `${styleId}:${p.roman.join(" ")}`;
function toggleFav(id) {
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch {}
}

// ---- My progressions: found in my MIDI files, kept in my library (../library.js) ----
// An item: { id, kind: "progression", name, roman, whole, tonic, minor, per, repeats }

let mine = [];
let lastFile = null; // { name, song }: the file analysed last, again when "one chord per" changes
async function loadMine() {
  try { mine = await Library.list("progression"); } catch { mine = []; }
}

// ---- The list shown: a style, the favourites, or mine; filtered by length ----

const style = () => STYLE_LIST.find((s) => s.id === state.style);

// The numerals to play: plain, or the style's most common coloured version.
function numeralsOf(p) {
  if (state.colour === "colour" && p.colours) {
    const coloured = p.colours.find(([v]) => v.join(" ") !== p.roman.join(" "));
    if (coloured) return coloured[0];
  }
  return p.roman;
}

const lengthOk = (n) => state.len === "any" || (state.len === "5" ? n >= 5 : n === Number(state.len));

// [{ p, style }]: style is null for my own progressions.
function entries() {
  let all;
  if (state.style === FAV) {
    all = STYLE_LIST.flatMap((s) => s.progressions.filter((p) => favs.has(favId(s.id, p))).map((p) => ({ p, style: s })));
  } else if (state.style === MINE) {
    all = mine.map((item) => ({ p: item, style: null }));
  } else {
    all = style().progressions.map((p) => ({ p, style: style() }));
  }
  return all.filter((e) => lengthOk(e.p.roman.length));
}

let listed = []; // entries(), as rendered
const current = () => listed[Math.min(state.pick, listed.length - 1)] || null;

const chordsOf = (p) => numeralsOf(p).map((t) => makeChord(t, state.key)).filter(Boolean);

// The notes to play. Guitar view: playable chord shapes (guitar.js). Otherwise the piano
// voicing chosen (voicing.js), voice-led around the loop.
function voicingsOf(chords) {
  if (state.view === "guitar") return guitarVoicings(chords);
  return voiceProgression(chords, state.voicing);
}

// A minor progression: its tonic chord (I) is minor. Used to light the scale on the Push.
const isMinor = (p) => p.roman.some((r) => { const n = parseNumeral(r); return n && n.step === 0 && !n.acc && n.lower; });

let shown = []; // the chords of the progression, as shown in the views
function refreshPlayer() {
  const e = current();
  const chords = e ? chordsOf(e.p) : [];
  const voicings = voicingsOf(chords);
  player.setVoicings(voicings);
  if (!voicings.length && player.running) togglePlay();
  shown = chords.map((c, i) => ({ name: c.name, frets: voicings[i].frets || null, voicing: voicings[i] }));
  if (voicings.length) push.setProgression(state.key, e.p.minor ?? isMinor(e.p), voicings);
}

// ---- Transport ----

const PLAY_PATH = "M8 5v14l11-7z", STOP_PATH = "M7 7h10v10H7z";

async function togglePlay(forceOn) {
  await ctx.resume();
  if (player.running && forceOn !== true) player.stop();
  else if (!player.running) { refreshPlayer(); player.start(); }
  $("play").classList.toggle("playing", player.running);
  $("play-icon").setAttribute("d", player.running ? STOP_PATH : PLAY_PATH);
}
$("play").addEventListener("click", () => togglePlay());

// ---- Controls ----

KEY_NAMES.forEach((n, i) => $("key").append(new Option(n, i, false, i === state.key)));
$("key").addEventListener("change", (e) => {
  state.key = Number(e.target.value);
  changed();
});

const bpm = $("bpm");
bpm.value = state.bpm;
function applyBpm() {
  state.bpm = Number(bpm.value);
  player.bpm = state.bpm;
  $("bpm-out").textContent = state.bpm + " bpm";
}
bpm.addEventListener("input", () => { applyBpm(); save(); });
applyBpm();

// Segmented controls: one active button, its data-v is the value.
function segmented(id, field, onChange) {
  const el = $(id);
  const paint = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === state[field]));
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state[field] = b.dataset.v;
    paint();
    onChange();
    save();
  });
  paint();
  onChange();
}
segmented("rhythm", "rhythm", () => (player.rhythm = state.rhythm));
segmented("colour", "colour", () => changed());
segmented("sound", "sound", () => sound.setKind(state.sound));
segmented("voicing", "voicing", () => refreshPlayer());
segmented("push-layout", "pushLayout", () => push.setLayout(state.pushLayout));
let started = false; // the controls below run their onChange once at start: keep the saved pick then
segmented("len", "len", () => { if (started) state.pick = 0; changed(); });
segmented("per", "per", () => { if (lastFile) analyse(lastFile.song, lastFile.name); });
segmented("view", "view", () => {
  for (const id of ["keys", "guitar", "push"]) $(id).hidden = id !== { piano: "keys", guitar: "guitar", push: "push" }[state.view];
  $("push-layout").hidden = state.view !== "push";
  refreshPlayer(); // the guitar plays its own shapes
});

$("volume").value = state.volume;
sound.setVolume(state.volume / 100);
$("volume").addEventListener("input", (e) => {
  state.volume = Number(e.target.value);
  sound.setVolume(state.volume / 100);
  save();
});

$("export").addEventListener("click", exportMidi);

// ---- Styles and list ----

// Short names for the buttons (all the same width); the full label goes in the help line.
const SHORT = {
  common: "Mainstream", rnb: "R&B", soul: "Soul · Gospel", jazz: "Jazz", lofi: "Lo-fi",
  dream: "Dream pop", cinematic: "Cinematic", asian: "J/K-pop", electronic: "Electronic",
  latin: "Latin", emo: "Emo · Punk", indie: "Indie · Folk", worship: "Worship",
  [FAV]: "★ Favourites", [MINE]: "My progressions",
};
const labelOf = (id) => SHORT[id] || (STYLE_LIST.find((s) => s.id === id) || {}).label || id;

function renderStyles() {
  const button = (id, cls = "") => `<button data-id="${id}" class="${cls} ${id === state.style ? "active" : ""}">${esc(labelOf(id))}</button>`;
  $("styles").innerHTML = STYLE_LIST.map((s) => button(s.id)).join("") + button(FAV, "wide") + button(MINE, "wide");
  const s = style();
  $("colour-row").hidden = state.style === MINE; // my own chords have no "style" version
  $("style-help").textContent =
    state.style === FAV ? "Your favourites, from every style. Tap ☆ on a progression to add it here."
    : state.style === MINE ? "Progressions found in your own MIDI files (open one below), kept on this device only."
    : s.id === "common" ? `The loops every app offers, for reference: the most used in all ${s.songs.toLocaleString("en")} songs.`
    : `Typical of ${s.label} (${s.songs.toLocaleString("en")} songs): used by many of its songs, ` +
      `and at least twice as often as in all songs (×). Tap one to hear it.`;
}

$("styles").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.style = b.dataset.id;
  state.pick = 0;
  renderStyles();
  changed();
});

function renderList() {
  listed = entries();
  if (listed.length && state.pick >= listed.length) state.pick = 0;
  if (!listed.length) {
    $("list").innerHTML = `<p class="empty">${
      state.style === FAV ? "No favourites here yet: tap ☆ on a progression to keep it."
      : state.style === MINE ? "None yet: open one of your MIDI files below, its chords will land here."
      : "No progression of this length in this style."}</p>`;
    return;
  }
  $("list").innerHTML = listed.map(({ p, style: s }, i) => {
    const names = chordsOf(p).map((c) => c.name).join("  ");
    let meta, side;
    if (!s) {
      // One of mine: where it comes from, its key.
      const key = `${KEY_NAMES[p.tonic]} ${p.minor ? "minor" : "major"}`;
      const how = p.repeats ? `a loop played ${p.repeats}×` : `${p.whole ? p.whole.length : p.roman.length} chords`;
      meta = `From ${esc(p.name)} · ${key} · ${how}, one chord per ${p.per === "beat" ? "beat" : "bar"}`;
      side = `<button class="icon-btn remove" data-id="${esc(p.id)}" aria-label="Remove from My progressions" title="Remove">×</button>`;
    } else {
      const share = (p.share * 100).toFixed(p.share < 0.1 ? 1 : 0) + "%";
      const where = s.id === "common" ? "of all songs" : `of ${esc(s.label)} songs`;
      const links = p.examples.map((id, k) =>
        `<a href="https://open.spotify.com/track/${esc(id)}" target="_blank" rel="noopener" title="A song using it (in its own key)">${k ? k + 1 : "hear it in a song"}</a>`).join(" · ");
      meta = `${share} ${where}${links ? " · " + links : ""}`;
      const id = favId(s.id, p), on = favs.has(id);
      side = (s.id === "common" ? "" : `<span class="lift" title="How many times more common than in all songs">×${p.lift}</span>`) +
        `<button class="icon-btn star ${on ? "on" : ""}" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="Favourite" title="${on ? "Remove from" : "Add to"} favourites">${on ? "★" : "☆"}</button>`;
    }
    return `
      <div class="prog ${i === state.pick ? "active" : ""}" data-i="${i}" tabindex="0" role="button">
        <div class="numerals">${numeralsOf(p).map((n) => `<span>${esc(n)}</span>`).join("")}</div>
        <div class="side">${side}</div>
        <div class="names">${esc(names)}</div>
        <div class="meta">${meta}</div>
      </div>`;
  }).join("");
}

function pick(i) {
  const same = i === state.pick;
  state.pick = i;
  // One of mine: hear it in the key it was found in.
  const e = current();
  if (e && !e.style && e.p.tonic !== state.key) {
    state.key = e.p.tonic;
    $("key").value = state.key;
    changed();
  } else {
    save();
    $("list").querySelectorAll(".prog").forEach((el) => el.classList.toggle("active", Number(el.dataset.i) === i));
    refreshPlayer();
    renderStrip();
  }
  if (same && player.running) togglePlay(); // tap the playing one again: stop
  else togglePlay(true);
}

$("list").addEventListener("click", async (e) => {
  if (e.target.closest("a")) return; // a Spotify link
  const star = e.target.closest(".star");
  if (star) {
    toggleFav(star.dataset.fav);
    const keep = current();
    renderList();
    // The favourites list lost a row: stay on the same progression if it's still there.
    const i = listed.findIndex((x) => keep && x.p === keep.p);
    state.pick = i >= 0 ? i : 0;
    renderList();
    refreshPlayer();
    renderStrip();
    return;
  }
  const remove = e.target.closest(".remove");
  if (remove) {
    await Library.remove(remove.dataset.id);
    await loadMine();
    changed();
    return;
  }
  const row = e.target.closest(".prog");
  if (row) pick(Number(row.dataset.i));
});
$("list").addEventListener("keydown", (e) => {
  const row = e.target.closest(".prog");
  if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(Number(row.dataset.i)); }
});

// ---- Current progression ----

// A link that opens the progression in another tool of the site: its numerals joined
// by "-", and the tonic as a pitch class (0 = C … 11 = B).
function toolLink(folder) {
  const e = current();
  if (!e) return `../${folder}/index.html`;
  return `../${folder}/index.html?prog=${encodeURIComponent(numeralsOf(e.p).join("-"))}&tonic=${state.key}`;
}

function renderStrip() {
  const e = current();
  const chords = e ? chordsOf(e.p) : [];
  $("strip").innerHTML = chords.map((c, i) =>
    `<div class="chord" data-i="${i}"><b>${esc(c.name)}</b><small>${esc(c.numeral)}</small></div>`).join("");
  $("to-focus").href = toolLink("generator");
  $("to-sketch").href = toolLink("sketch");
  lit = -1;
}

// Something that changes the chords: key, colours, style, filter.
function changed() {
  save();
  renderList();
  renderStrip();
  refreshPlayer();
}

// ---- MIDI export ----

function exportMidi() {
  const e = current();
  if (!e) return;
  const voicings = voicingsOf(chordsOf(e.p));
  const repeat = Math.ceil(4 / voicings.length); // at least 4 bars
  const notes = [];
  for (let r = 0; r < repeat; r++) {
    voicings.forEach((v, i) => {
      const bar = (r * voicings.length + i) * 4;
      for (const ev of chordEvents(v, state.rhythm)) notes.push({ ...ev, start: ev.start + bar });
    });
  }
  const label = numeralsOf(e.p).join(" ");
  const file = `${label} in ${KEY_NAMES[state.key]}`
    .replace(/#/g, "s").replace(/°/g, "dim").replace(/\//g, " over ").replace(/[^\w +()-]/g, "")
    .replace(/\s+/g, "-").slice(0, 120);
  downloadFile(writeMidi(notes, state.bpm, `Drifton ${label}`), `drifton-${file}.mid`);
}

// ---- Analyse my own MIDI file (analyze.js) ----

$("open-midi").addEventListener("click", () => $("midi-file").click());
$("midi-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow opening the same file again
  if (!file) return;
  try {
    const song = parseMidi(await file.arrayBuffer()); // ../score/midi.js
    if (!song.notes.length) throw new Error("no notes in it");
    lastFile = { name: file.name.replace(/\.midi?$/i, ""), song };
    await analyse(song, lastFile.name);
  } catch (err) {
    $("analysis").textContent = `Could not read ${file.name}: ${err.message}.`;
  }
});

async function analyse(song, name) {
  const a = analyzeSong(song, state.per);
  if (!a.chords.length) { $("analysis").textContent = `${name}: no chords found.`; return; }
  const keyName = (k) => `${KEY_NAMES[k.tonic]} ${k.minor ? "minor" : "major"}`;
  const item = {
    id: "progression:" + name, kind: "progression", name,
    roman: a.loop ? a.loop.roman : a.chords.slice(0, 32),
    whole: a.chords.slice(0, 512),
    tonic: a.tonic, minor: a.minor, per: state.per, repeats: a.loop ? a.loop.repeats : 0,
  };
  try { await Library.put(item); Library.persist(); } catch {}
  await loadMine();
  if (!mine.some((x) => x.id === item.id)) mine.unshift({ ...item, updated: Date.now() }); // no storage at all
  $("analysis").innerHTML =
    `<b>${esc(name)}</b>: ${keyName(a)}${a.alt ? ` (or maybe ${keyName(a.alt)})` : ""}, ${a.chords.length} chord changes. ` +
    (a.loop ? `The loop <b>${esc(a.loop.roman.join(" "))}</b> comes back ${a.loop.repeats} times: ` : `No loop that comes back often: the first chords are `) +
    `kept in My progressions, above.`;
  // Show it: My progressions, in its key.
  state.style = MINE;
  state.len = "any";
  $("len").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === "any"));
  state.pick = Math.max(0, mine.findIndex((x) => x.id === item.id));
  state.key = a.tonic;
  $("key").value = state.key;
  renderStyles();
  changed();
}

// ---- Keyboard shortcuts ----

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select")) return;
  if (e.key === " " && !e.target.closest(".prog, button")) { e.preventDefault(); togglePlay(); }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && listed.length) {
    e.preventDefault();
    const n = listed.length;
    pick((state.pick + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
  }
});

// ---- Display loop ----

function frame() {
  const m = player.running ? player.current(ctx.currentTime) : null;
  const i = m ? m.index : -1;
  if (i !== lit) {
    lit = i;
    $("strip").querySelectorAll(".chord").forEach((el) => el.classList.toggle("on", Number(el.dataset.i) === i));
  }
  if (state.view === "piano") keys.show(m ? m.voicing.bass : null, m ? m.voicing.notes : []);
  else if (state.view === "guitar") guitar.show(shown.map((c) => ({ name: c.name, frets: c.frets })), i);
  else push.show(m ? m.voicing : shown[0] ? shown[0].voicing : null);
  // In Key hides the notes outside the scale: say which chord notes are missing.
  const missing = state.view === "push" && state.pushLayout === "inkey" ? push.missing : [];
  const note = missing.length ? `Outside the scale, not on the In Key grid: ${missing.map((pc) => KEY_NAMES[pc]).join(", ")}.` : "";
  if ($("push-note").textContent !== note) $("push-note").textContent = note;
  $("status").textContent = player.running
    ? `${labelOf(state.style)} · ${state.bpm} bpm`
    : "Press play, or tap a progression below.";
  requestAnimationFrame(frame);
}

renderStyles();
changed();
started = true;
requestAnimationFrame(frame);
loadMine().then(() => { if (state.style === MINE) changed(); });
