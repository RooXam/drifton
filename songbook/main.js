// Songbook page: a list of songs; one song shows its parts, chord shapes and numerals,
// and can be played along (whole song, or one part in a loop).
// The address says what is open: #hurt (a song), #new (paste a new song).
//
// Two sources of songs:
// - built in (songs.js): chords only, published with the site;
// - my library (../library.js, on this device only): songs I pasted, and the lyrics I
//   added to built-in songs. Lyrics are never published: they stay on the device.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const sound = new ChordSound(ctx);
const player = new ProgressionPlayer(ctx, sound);
const guitar = new GuitarView(document.getElementById("guitar"));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- Settings, remembered in the browser (per song: transposition and key) ----

const SAVE_KEY = "drifton.songbook.v1";
const prefs = { bpm: 80, beats: "4", rhythm: "pulse", sound: "piano", volume: 80, numerals: false, follow: true, lyrics: true, songs: {} };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch {}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(prefs)); } catch {}
}

// ---- Songs: chords read once, key guessed ----

const tuningShift = (t) => (/half/i.test(t) ? -1 : /(full|whole)/i.test(t) ? -2 : 0);

// Common part: sections = parts → lines → chords (for the chord view).
function finish(song, sections, writtenKey) {
  const all = sections.flatMap((s) => s.lines.flatMap((l) => l.chords));
  const starts = sections.map((s) => s.lines.find((l) => l.chords.length)?.chords[0]).filter(Boolean);
  let auto = all.length ? guessKey(all, starts) : { tonic: 0, minor: false };
  // The key written on the sheet wins if its tonic chord is really in the song (some
  // sheets give the sounding key of a detuned guitar, not the key of the shapes).
  const written = parseKey(writtenKey);
  if (written && all.some((c) => c.root === written.tonic && c.minor === written.minor)) auto = written;
  return { ...song, sections, all, auto, distinct: [...new Set(all.map((c) => c.text))] };
}

function prepareBuiltIn(s) {
  const sections = s.sections.map((sec) => ({
    name: sec.name,
    lines: sec.lines.map(([chords, repeat]) => ({ chords: chords.map(parseSymbol).filter(Boolean), repeat: repeat || 1 })),
  }));
  return finish({ ...s, tuning: tuningShift(s.tuning) }, sections, s.key);
}

// A song I pasted: its sheet (words + chords) gives the parts.
function prepareMine(item) {
  const sheet = parseSheet(item.text || "");
  const sections = sheet.map((p) => ({
    name: p.name,
    lines: p.lines.map((l) => ({ chords: l.segments.filter((s) => s.chord).map((s) => s.chord), repeat: l.repeat || 1 }))
      .filter((l) => l.chords.length),
  })).filter((p) => p.lines.length);
  return finish({ id: item.id, title: item.title || "Untitled", artist: item.artist || "", capo: Number(item.capo) || 0,
    tuning: 0, source: null, mine: true, sheet, item }, sections, "");
}

const BUILT_IN = SONGS.map(prepareBuiltIn);
let mine = [];      // my pasted songs (prepared)
let lyricsOf = {};  // built-in song id → my library item holding its lyrics

async function loadLibrary() {
  const items = await Library.list("song");
  mine = items.filter((x) => !x.builtin).map(prepareMine);
  lyricsOf = Object.fromEntries(items.filter((x) => x.builtin).map((x) => [x.builtin, x]));
}

const keyLabel = (k) => `${tonicName(k.tonic, k.minor)} ${k.minor ? "minor" : "major"}`;

function showOnly(view) {
  stop();
  for (const v of ["list-view", "song-view", "editor"]) $(v).hidden = v !== view;
  $("intro").hidden = view !== "list-view";
}

// ---- List ----

function card(s, extra = "") {
  const bits = [`Key <em>${esc(keyLabel(s.auto))}</em>`];
  if (s.capo) bits.push(`capo ${s.capo}`);
  if (s.tuning) bits.push(esc(s.tuning === -1 ? "½ step down" : "1 step down"));
  bits.push(`${s.distinct.length} chords`);
  return `<a class="song-card" href="#${encodeURIComponent(s.id)}">
    <b>${esc(s.title)}${extra}</b><span class="artist">${esc(s.artist)}</span>
    <span class="info">${bits.join(" · ")}</span></a>`;
}

function showList() {
  showOnly("list-view");
  document.title = "Drifton Songbook";
  $("my-songs").innerHTML = mine.map((s) => card(s)).join("");
  $("my-title").hidden = !mine.length;
  $("songs").innerHTML = BUILT_IN.map((s) => card(s, lyricsOf[s.id] ? ` <span class="tag">lyrics</span>` : "")).join("");
}

$("add-song").addEventListener("click", () => (location.hash = "new"));
$("export").addEventListener("click", async () => {
  const n = await Library.exportFile();
  $("lib-status").textContent = n ? `${n} items exported.` : "Your library is empty.";
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const n = await Library.importFile(file);
    await loadLibrary();
    showList();
    $("lib-status").textContent = `${n} items imported.`;
  } catch (err) {
    $("lib-status").textContent = `Could not import: ${err.message}`;
  }
});

// ---- One song ----

let song = null;   // the prepared song shown
let seq = [];      // every chord of the song in order: { si, li, ci, name, chord }
let playing = [];  // the part of `seq` being played (whole song or one part)
let loopPart = -1; // index of the part looped, −1 = whole song
let parts = [];    // names of the parts shown
let shapes = new Map(), chartNames = [];
let lit = null;

const settings = () => (prefs.songs[song.id] = prefs.songs[song.id] || { semis: 0, key: "auto" });
function songKey() {
  const k = settings().key;
  if (k === "auto") return song.auto;
  const [t, m] = k.split(":");
  return { tonic: Number(t), minor: m === "m" };
}
const nameOf = (chord) => transposeSymbol(chord, settings().semis, songKey());

function showSong(id) {
  song = BUILT_IN.find((s) => s.id === id) || mine.find((s) => s.id === id);
  if (!song) return showList();
  showOnly("song-view");
  // A built-in song with my lyrics: the sheet comes from my library.
  if (!song.mine) song.sheet = lyricsOf[song.id] ? parseSheet(lyricsOf[song.id].text) : null;
  document.title = `${song.title} · Drifton Songbook`;
  $("song-title").innerHTML = `${esc(song.title)}<small>${esc(song.artist)}</small>`;

  // Key list: "Auto" (the guess) or any of the 24 keys.
  const sel = $("key");
  sel.innerHTML = `<option value="auto">Auto · ${esc(keyLabel(song.auto))}</option>` +
    [false, true].flatMap((minor) => KEY_NAMES.map((_, t) =>
      `<option value="${t}:${minor ? "m" : ""}">${esc(keyLabel({ tonic: t, minor }))}</option>`)).join("");
  sel.value = settings().key;
  loopPart = -1;
  render();
  window.scrollTo(0, 0);
}

const withLyrics = () => !!song.sheet && (song.mine || prefs.lyrics);

// Everything that depends on the transposition, the key or the view.
function render() {
  const st = settings();
  $("semis").textContent = st.semis > 0 ? "+" + st.semis : st.semis;
  const key = songKey();
  const shown = { tonic: (key.tonic + st.semis + 12) % 12, minor: key.minor };
  const meta = [`Key <b>${esc(keyLabel(shown))}</b>`];
  if (song.capo) meta.push(`Capo <b>${song.capo}</b>`);
  meta.push(`Tuning <b>${esc(song.tuning ? (song.tuning === -1 ? "½ step down" : "1 step down") : "standard")}</b>`);
  if (song.source) meta.push(`<a href="${esc(song.source)}" target="_blank" rel="noopener">Chords + lyrics ↗</a>`);
  if (!song.mine) meta.push(`<a href="https://open.spotify.com/search/${encodeURIComponent(song.artist.split(" feat.")[0] + " " + song.title)}" target="_blank" rel="noopener">Spotify ↗</a>`);
  $("song-meta").innerHTML = meta.join("");

  // Lyrics: add / edit, and the switch between the two views.
  $("edit-lyrics").textContent = song.mine ? "Edit song" : song.sheet ? "Edit lyrics" : "Add lyrics";
  $("view-switch").hidden = song.mine || !song.sheet;
  $("view-switch").querySelectorAll("button").forEach((b) => b.classList.toggle("active", (b.dataset.v === "lyrics") === withLyrics()));

  seq = [];
  const html = withLyrics() ? renderSheet(key) : renderChords(key);
  $("sections").innerHTML = html;
  $("sections").classList.toggle("sheet", withLyrics());

  // Chord shapes (transposed), the sound of each, and the charts.
  shapes = new Map();
  for (const name of new Set(seq.map((x) => x.name))) {
    const chord = parseSymbol(name);
    const shape = chord && guitarShape(chord, null);
    const shift = song.capo + song.tuning;
    const voicing = shape
      ? { bass: shape.pitches[0] + shift, notes: shape.pitches.slice(1).map((p) => p + shift), strum: true }
      : { ...voiceChord(chord, null) };
    shapes.set(name, { frets: shape ? shape.frets : null, voicing });
  }
  chartNames = [...shapes.keys()];
  refreshPlayer();
  lit = null;
}

const loopButton = (si) => `<button class="loop" data-part="${si}">▶ loop</button>`;

// Chord view: one row of chips per line.
function renderChords(key) {
  parts = song.sections.map((s) => s.name);
  return song.sections.map((sec, si) => {
    const lines = sec.lines.map((line, li) => {
      const chips = line.chords.map((c, ci) =>
        `<span class="chip" data-pos="${si}-${li}-${ci}"><b>${esc(nameOf(c))}</b>${prefs.numerals ? `<small>${esc(numeralOf(c, key))}</small>` : ""}</span>`).join("");
      for (let r = 0; r < line.repeat; r++) line.chords.forEach((c, ci) => seq.push({ si, li, ci, name: nameOf(c), chord: c }));
      return `<div class="line">${chips}${line.repeat > 1 ? `<span class="repeat">×${line.repeat}</span>` : ""}</div>`;
    }).join("");
    return `<div class="part"><div class="part-head"><h3>${esc(sec.name)}</h3>${loopButton(si)}</div>
      <div class="lines">${lines}</div></div>`;
  }).join("");
}

// Lyrics view: each chord above the piece of words it starts.
function renderSheet(key) {
  parts = song.sheet.map((p) => p.name);
  return song.sheet.map((part, si) => {
    const lines = part.lines.map((line, li) => {
      let ci = 0;
      const segs = line.segments.map((s) => {
        let chord = "";
        if (s.chord) {
          chord = `<b class="ch" data-pos="${si}-${li}-${ci}">${esc(nameOf(s.chord))}${prefs.numerals ? `<small>${esc(numeralOf(s.chord, key))}</small>` : ""}</b>`;
          ci++;
        }
        return `<span class="sg${s.chord ? "" : " plain"}">${chord}<span class="ly">${esc(s.text) || "&nbsp;"}</span></span>`;
      }).join("");
      const chords = line.segments.filter((s) => s.chord);
      for (let r = 0; r < (line.repeat || 1); r++) chords.forEach((s, k) => seq.push({ si, li, ci: k, name: nameOf(s.chord), chord: s.chord }));
      return `<div class="sline${line.chordsOnly ? " only" : ""}">${segs}${line.repeat > 1 ? `<span class="repeat">×${line.repeat}</span>` : ""}</div>`;
    }).join("");
    return `<div class="part"><div class="part-head"><h3>${esc(part.name)}</h3>${loopButton(si)}</div>${lines}</div>`;
  }).join("");
}

$("view-switch").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  prefs.lyrics = b.dataset.v === "lyrics";
  save();
  stop();
  render();
});

function refreshPlayer() {
  playing = loopPart < 0 ? seq : seq.filter((x) => x.si === loopPart);
  player.setVoicings(playing.map((x) => shapes.get(x.name).voicing));
}

// ---- Editor: paste a song, or the lyrics of a built-in song ----

let editing = null; // { builtin } or { item } or {} for a new song

function openEditor(target) {
  editing = target;
  showOnly("editor");
  const item = target.item || (target.builtin && lyricsOf[target.builtin]) || null;
  const builtin = target.builtin && BUILT_IN.find((s) => s.id === target.builtin);
  $("editor-title").textContent = builtin ? `Lyrics · ${builtin.title}` : item ? "Edit song" : "Add a song";
  $("ed-fields").hidden = !!builtin;
  $("ed-title").value = item ? item.title || "" : "";
  $("ed-artist").value = item ? item.artist || "" : "";
  $("ed-capo").value = item ? item.capo || 0 : 0;
  $("ed-text").value = item ? item.text : "";
  $("ed-delete").hidden = !item;
  $("ed-status").textContent = "";
  document.title = "Drifton Songbook";
  window.scrollTo(0, 0);
}

$("edit-lyrics").addEventListener("click", () => {
  if (song.mine) openEditor({ item: song.item });
  else openEditor({ builtin: song.id });
});

$("ed-save").addEventListener("click", async () => {
  const text = $("ed-text").value;
  const sheet = parseSheet(text);
  const chords = sheet.flatMap((p) => p.lines.flatMap((l) => l.segments.filter((s) => s.chord)));
  if (!chords.length) {
    $("ed-status").textContent = "No chords found: paste the song with its chords (above the words, or like [Am]).";
    return;
  }
  const old = editing.item || (editing.builtin && lyricsOf[editing.builtin]);
  const item = editing.builtin
    ? { id: "lyrics:" + editing.builtin, kind: "song", builtin: editing.builtin, text }
    : { id: old ? old.id : "song:" + Date.now().toString(36), kind: "song", text,
        title: $("ed-title").value.trim() || "Untitled", artist: $("ed-artist").value.trim(), capo: Number($("ed-capo").value) || 0 };
  await Library.put(item);
  Library.persist();
  await loadLibrary();
  location.hash = encodeURIComponent(editing.builtin || item.id);
  route();
});

$("ed-cancel").addEventListener("click", () => {
  if (location.hash === "#new") location.hash = "";
  else route(); // back to the song (or the list)
});
$("ed-delete").addEventListener("click", async () => {
  const old = editing.item || (editing.builtin && lyricsOf[editing.builtin]);
  if (!old || !confirm(editing.builtin ? "Remove these lyrics from your library?" : "Remove this song from your library?")) return;
  await Library.remove(old.id);
  await loadLibrary();
  location.hash = editing.builtin ? encodeURIComponent(editing.builtin) : "";
  route();
});

// ---- Playing ----

const PLAY_PATH = "M8 5v14l11-7z", STOP_PATH = "M7 7h10v10H7z";

async function play(from = 0) {
  await ctx.resume();
  player.stop();
  refreshPlayer();
  player.start(from);
  updateButtons();
}
function stop() {
  player.stop();
  updateButtons();
}
function updateButtons() {
  $("play").classList.toggle("playing", player.running);
  $("play-icon").setAttribute("d", player.running ? STOP_PATH : PLAY_PATH);
  document.querySelectorAll(".loop").forEach((b) => {
    const on = player.running && Number(b.dataset.part) === loopPart;
    b.classList.toggle("on", on);
    b.textContent = on ? "■ stop" : "▶ loop";
  });
}

$("play").addEventListener("click", () => {
  if (player.running) return stop();
  loopPart = -1;
  play(0);
});

$("sections").addEventListener("click", (e) => {
  const loop = e.target.closest(".loop");
  if (loop) {
    const part = Number(loop.dataset.part);
    if (player.running && loopPart === part) return stop();
    loopPart = part;
    return play(0);
  }
  // Tap a chord: play the song from there.
  const chip = e.target.closest("[data-pos]");
  if (chip) {
    loopPart = -1;
    refreshPlayer();
    const [si, li, ci] = chip.dataset.pos.split("-").map(Number);
    const from = seq.findIndex((x) => x.si === si && x.li === li && x.ci === ci);
    play(Math.max(0, from));
  }
});

// ---- Controls ----

function changeSemis(d) {
  const st = settings();
  st.semis = Math.max(-11, Math.min(11, st.semis + d));
  save();
  render();
}
$("down").addEventListener("click", () => changeSemis(-1));
$("up").addEventListener("click", () => changeSemis(1));
$("key").addEventListener("change", (e) => { settings().key = e.target.value; save(); render(); });

$("numerals").checked = prefs.numerals;
$("numerals").addEventListener("change", (e) => { prefs.numerals = e.target.checked; save(); render(); });
$("follow").checked = prefs.follow;
$("follow").addEventListener("change", (e) => { prefs.follow = e.target.checked; save(); });

const bpm = $("bpm");
bpm.value = prefs.bpm;
function applyBpm() {
  prefs.bpm = Number(bpm.value);
  player.bpm = prefs.bpm;
  $("bpm-out").textContent = prefs.bpm + " bpm";
}
bpm.addEventListener("input", () => { applyBpm(); save(); });
applyBpm();

function segmented(id, field, onChange) {
  const el = $(id);
  const paint = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === prefs[field]));
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    prefs[field] = b.dataset.v;
    paint();
    onChange();
    save();
  });
  paint();
  onChange();
}
segmented("beats", "beats", () => (player.beats = Number(prefs.beats)));
segmented("rhythm", "rhythm", () => (player.rhythm = prefs.rhythm));
segmented("sound", "sound", () => sound.setKind(prefs.sound));

$("volume").value = prefs.volume;
sound.setVolume(prefs.volume / 100);
$("volume").addEventListener("input", (e) => {
  prefs.volume = Number(e.target.value);
  sound.setVolume(prefs.volume / 100);
  save();
});

document.addEventListener("keydown", (e) => {
  if ($("song-view").hidden || e.target.closest("input, select, button, textarea")) return;
  if (e.key === " ") { e.preventDefault(); $("play").click(); }
});

// ---- Display loop: light the chord playing, follow it ----

function frame() {
  if (song && !$("song-view").hidden) {
    const m = player.running ? player.current(ctx.currentTime) : null;
    const item = m ? playing[m.index] : null;
    const pos = item ? `${item.si}-${item.li}-${item.ci}` : null;
    if (pos !== lit) {
      lit = pos;
      document.querySelectorAll("#sections .on").forEach((el) => el.classList.remove("on"));
      const el = pos && document.querySelector(`#sections [data-pos="${pos}"]`);
      if (el) {
        el.classList.add("on");
        if (prefs.follow) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      $("now").innerHTML = item ? `${esc(item.name)}<small>${esc(numeralOf(item.chord, songKey()))}</small>` : "—";
      $("status").textContent = item
        ? `${parts[item.si]}${loopPart >= 0 ? " (loop)" : ""} · ${prefs.bpm} bpm`
        : "Press play, tap a chord to start from there, or loop a part.";
    }
    guitar.show(chartNames.map((n) => ({ name: n, frets: shapes.get(n).frets })), item ? chartNames.indexOf(item.name) : -1);
  }
  requestAnimationFrame(frame);
}

// ---- Which view: the address decides ----

function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === "new") openEditor({});
  else if (id) showSong(id);
  else showList();
}
window.addEventListener("hashchange", route);
loadLibrary().then(route);
requestAnimationFrame(frame);
