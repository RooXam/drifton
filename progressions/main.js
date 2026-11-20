// Chord progressions page: pick a style, a progression, a key; listen; export MIDI.

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
let lit = -1; // index of the chord lit in the strip

// ---- Settings, remembered in the browser ----

const SAVE_KEY = "drifton.progressions.v1";
const state = { style: "hiphop", pick: 0, key: 0, bpm: 80, rhythm: "push", colour: "colour", sound: "piano", volume: 80, view: "piano" };
try { Object.assign(state, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch {}
if (!STYLE_LIST.some((s) => s.id === state.style)) state.style = STYLE_LIST[0].id;
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch {}
}

const style = () => STYLE_LIST.find((s) => s.id === state.style);
const progression = () => style().progressions[Math.min(state.pick, style().progressions.length - 1)];

// The numerals to play: plain, or the style's most common coloured version.
function numeralsOf(p) {
  if (state.colour === "colour") {
    const coloured = p.colours.find(([v]) => v.join(" ") !== p.roman.join(" "));
    if (coloured) return coloured[0];
  }
  return p.roman;
}

const chordsOf = (p) => numeralsOf(p).map((t) => makeChord(t, state.key));

// The notes to play. Guitar view: playable chord shapes (guitar.js). Otherwise the piano
// voicing, voice-led around the loop twice, keeping the second round: the last chord
// then also leads smoothly back into the first.
function voicingsOf(chords) {
  if (state.view === "guitar") return guitarVoicings(chords);
  let prev = null;
  const out = [];
  for (let round = 0; round < 2; round++) {
    chords.forEach((c, i) => {
      const v = voiceChord(c, prev);
      prev = v.notes;
      out[i] = v;
    });
  }
  return out;
}

// A minor progression: its tonic chord (I) is minor. Used to light the scale on the Push.
const isMinor = (p) => p.roman.some((r) => { const n = parseNumeral(r); return n && n.step === 0 && !n.acc && n.lower; });

let shown = []; // the chords of the progression, as shown in the views
function refreshPlayer() {
  const chords = chordsOf(progression());
  const voicings = voicingsOf(chords);
  player.setVoicings(voicings);
  shown = chords.map((c, i) => ({ name: c.name, frets: voicings[i].frets || null, voicing: voicings[i] }));
  push.setProgression(state.key, isMinor(progression()), voicings);
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
segmented("view", "view", () => {
  for (const id of ["keys", "guitar", "push"]) $(id).hidden = id !== { piano: "keys", guitar: "guitar", push: "push" }[state.view];
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
};

function renderStyles() {
  $("styles").innerHTML = STYLE_LIST.map((s) =>
    `<button data-id="${s.id}" class="${s.id === state.style ? "active" : ""}">${esc(SHORT[s.id] || s.label)}</button>`).join("");
  const s = style();
  $("style-help").textContent = s.id === "common"
    ? `The loops every app offers, for reference: the most used in all ${s.songs.toLocaleString("en")} songs.`
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
  const s = style();
  $("list").innerHTML = s.progressions.map((p, i) => {
    const names = chordsOf(p).map((c) => c.name).join("  ");
    const share = (p.share * 100).toFixed(p.share < 0.1 ? 1 : 0) + "%";
    const where = s.id === "common" ? "of all songs" : `of ${esc(s.label)} songs`;
    const links = p.examples.map((id, k) =>
      `<a href="https://open.spotify.com/track/${esc(id)}" target="_blank" rel="noopener" title="A song using it (in its own key)">${k ? k + 1 : "hear it in a song"}</a>`).join(" · ");
    return `
      <div class="prog ${i === state.pick ? "active" : ""}" data-i="${i}" tabindex="0" role="button">
        <div class="numerals">${numeralsOf(p).map((n) => `<span>${esc(n)}</span>`).join("")}</div>
        ${s.id === "common" ? "" : `<div class="lift" title="How many times more common than in all songs">×${p.lift}</div>`}
        <div class="names">${esc(names)}</div>
        <div class="meta">${share} ${where}${links ? " · " + links : ""}</div>
      </div>`;
  }).join("");
}

function pick(i) {
  const same = i === state.pick;
  state.pick = i;
  save();
  $("list").querySelectorAll(".prog").forEach((el) => el.classList.toggle("active", Number(el.dataset.i) === i));
  refreshPlayer();
  renderStrip();
  if (same && player.running) togglePlay(); // tap the playing one again: stop
  else togglePlay(true);
}

$("list").addEventListener("click", (e) => {
  if (e.target.closest("a")) return; // a Spotify link
  const row = e.target.closest(".prog");
  if (row) pick(Number(row.dataset.i));
});
$("list").addEventListener("keydown", (e) => {
  const row = e.target.closest(".prog");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(Number(row.dataset.i)); }
});

// ---- Current progression ----

function renderStrip() {
  const p = progression();
  const chords = chordsOf(p);
  $("strip").innerHTML = chords.map((c, i) =>
    `<div class="chord" data-i="${i}"><b>${esc(c.name)}</b><small>${esc(c.numeral)}</small></div>`).join("");
  lit = -1;
}

// Something that changes the chords: key, colours, style.
function changed() {
  save();
  renderList();
  renderStrip();
  refreshPlayer();
}

// ---- MIDI export ----

function exportMidi() {
  const voicings = voicingsOf(chordsOf(progression()));
  const repeat = Math.ceil(4 / voicings.length); // at least 4 bars
  const notes = [];
  for (let r = 0; r < repeat; r++) {
    voicings.forEach((v, i) => {
      const bar = (r * voicings.length + i) * 4;
      for (const e of chordEvents(v, state.rhythm)) notes.push({ ...e, start: e.start + bar });
    });
  }
  const label = numeralsOf(progression()).join(" ");
  const file = `${label} in ${KEY_NAMES[state.key]}`
    .replace(/#/g, "s").replace(/°/g, "dim").replace(/\//g, " over ").replace(/[^\w +()-]/g, "")
    .replace(/\s+/g, "-");
  downloadFile(writeMidi(notes, state.bpm, `Drifton ${label}`), `drifton-${file}.mid`);
}

// ---- Keyboard shortcuts ----

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select")) return;
  if (e.key === " " && !e.target.closest(".prog, button")) { e.preventDefault(); togglePlay(); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = style().progressions.length;
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
  const s = style();
  $("status").textContent = player.running
    ? `${SHORT[s.id] || s.label} · ${state.bpm} bpm`
    : "Press play, or tap a progression below.";
  requestAnimationFrame(frame);
}

renderStyles();
changed();
requestAnimationFrame(frame);
