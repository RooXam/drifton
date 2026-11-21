// Songbook page: a list of songs; one song shows its parts, chord shapes and numerals,
// and can be played along (whole song, or one part in a loop).
// The address says what is open: #hurt (a song), #new (paste a new song),
// #new-arrangement (write my own arrangement).
//
// Two sources of songs:
// - built in (songs.js): chords only, published with the site;
// - my library (../library.js, on this device only): songs I pasted, my arrangements
//   (arrange.js: bars, beats, my shapes and strum), and the lyrics I added to built-in
//   songs. Lyrics are never published: they stay on the device.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const sound = new SongSound(ctx);           // strum.js: piano, synth pad or guitar
const player = new SheetPlayer(ctx, sound); // strum.js: real chord lengths, strum patterns
const guitar = new GuitarView(document.getElementById("guitar"));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- Settings, remembered in the browser (per song: transposition and key) ----

const SAVE_KEY = "drifton.songbook.v1";
const prefs = { bpm: 80, beats: "4", rhythm: "pulse", sound: "piano", volume: 80, numerals: false, follow: true, lyrics: true, scrollSpeed: 4, songs: {} };
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

// My arrangement: bars with real lengths, my shapes, my strum (arrange.js). `sections`
// keeps only the chords, for the key and the list; the bars are drawn by renderBars.
function prepareArrangement(item) {
  const arr = parseArrangement(item.text || "");
  const sections = arr.sections.map((sec) => ({
    name: sec.name,
    lines: sec.lines.map((l) => ({ chords: l.bars.flatMap((b) => b.beats.filter((x) => x.chord).map((x) => x.chord)), repeat: l.repeat })),
  }));
  return finish({ id: item.id, title: item.title || arr.title || "Untitled", artist: item.artist || arr.artist || "",
    capo: arr.capo ?? (Number(item.capo) || 0), tuning: 0, source: null, mine: true, sheet: null, item, arr }, sections, arr.key);
}

const BUILT_IN = SONGS.map(prepareBuiltIn);
let mine = [];      // my pasted songs (prepared)
let lyricsOf = {};  // built-in song id → my library item holding its lyrics

async function loadLibrary() {
  const items = await Library.list("song");
  mine = items.filter((x) => !x.builtin).map((x) => (isArrangement(x.text) ? prepareArrangement(x) : prepareMine(x)));
  lyricsOf = Object.fromEntries(items.filter((x) => x.builtin).map((x) => [x.builtin, x]));
}

const keyLabel = (k) => `${tonicName(k.tonic, k.minor)} ${k.minor ? "minor" : "major"}`;

function showOnly(view) {
  stop();
  popover.close();
  reading.close();
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
  $("my-songs").innerHTML = mine.map((s) => card(s, s.arr ? ` <span class="tag">arrangement</span>` : "")).join("");
  $("my-title").hidden = !mine.length;
  $("songs").innerHTML = BUILT_IN.map((s) => card(s, lyricsOf[s.id] ? ` <span class="tag">lyrics</span>` : "")).join("");
}

$("add-song").addEventListener("click", () => (location.hash = "new"));
$("add-arr").addEventListener("click", () => (location.hash = "new-arrangement"));
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
let seq = [];      // every chord of the song in order: { si, li, ci, name, chord, beats?, at? }
let playing = [];  // the part of `seq` being played (whole song or one part)
let loopPart = -1; // index of the part looped, −1 = whole song
let parts = [];    // names of the parts shown
let shapes = new Map(), chartNames = [];
let lit = null;

const settings = () => (prefs.songs[song.id] = prefs.songs[song.id] || { semis: 0, key: "auto" });

// Rhythm, sound and tempo: shared by all the songs, except my arrangements, which keep
// their own (strummed on the guitar at their tempo, by default).
const PER_ARRANGEMENT = ["rhythm", "sound", "bpm"];
function opt(field) {
  if (!song || !song.arr || !PER_ARRANGEMENT.includes(field)) return prefs[field];
  const own = settings()[field];
  if (own !== undefined) return own;
  return { rhythm: song.arr.strum ? "strum" : "pulse", sound: "guitar", bpm: song.arr.tempo || prefs.bpm }[field];
}
function setOpt(field, value) {
  if (song && song.arr && PER_ARRANGEMENT.includes(field)) settings()[field] = value;
  else prefs[field] = value;
  save();
}
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
  // An arrangement has real lengths and its own strum: no "Each chord", a "My strum" rhythm.
  $("beats-row").hidden = !!song.arr;
  $("strum-btn").hidden = !(song.arr && song.arr.strum);
  $("play-help").textContent = song.arr
    ? "Your arrangement: each chord lasts its beats, at your tempo, with your shapes. With \"My strum\" each chord is strummed with your pattern (down from the low string, up from the high one)."
    : "The chord sheets have no timing: each chord lasts the same, so this is to practise the changes, not to play along with the record. You hear the shapes shown, with the capo and the tuning.";
  applyOptions();
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
  if (song.arr && song.arr.tempo) meta.push(`Tempo <b>${song.arr.tempo}</b>`);
  if (song.arr && song.arr.time !== 4) meta.push(`Time <b>${song.arr.time}/4</b>`);
  meta.push(`Tuning <b>${esc(song.tuning ? (song.tuning === -1 ? "½ step down" : "1 step down") : "standard")}</b>`);
  if (song.source) meta.push(`<a href="${esc(song.source)}" target="_blank" rel="noopener">Chords + lyrics ↗</a>`);
  if (!song.mine) meta.push(`<a href="https://open.spotify.com/search/${encodeURIComponent(song.artist.split(" feat.")[0] + " " + song.title)}" target="_blank" rel="noopener">Spotify ↗</a>`);
  $("song-meta").innerHTML = meta.join("");

  // Lyrics: add / edit, and the switch between the two views.
  $("edit-lyrics").textContent = song.arr ? "Edit arrangement" : song.mine ? "Edit song" : song.sheet ? "Edit lyrics" : "Add lyrics";
  $("view-switch").hidden = song.mine || !song.sheet;
  $("view-switch").querySelectorAll("button").forEach((b) => b.classList.toggle("active", (b.dataset.v === "lyrics") === withLyrics()));

  seq = [];
  popover.close();
  const html = song.arr ? renderBars(key) : withLyrics() ? renderSheet(key) : renderChords(key);
  $("sections").innerHTML = html;
  $("sections").classList.toggle("sheet", withLyrics());

  // Chord shapes (transposed), the sound of each, and the charts.
  // In an arrangement, my own shapes (only untransposed: moved, they'd be other chords).
  shapes = new Map();
  const shift = song.capo + song.tuning;
  for (const x of seq) {
    if (!x.chord || shapes.has(x.name)) continue;
    const chord = parseSymbol(x.name) || x.chord;
    const own = song.arr && !st.semis && song.arr.shapes[x.chord.text];
    const shape = own
      ? { frets: own, pitches: own.map((f, s) => (f < 0 ? null : TUNING[s] + f)).filter((p) => p !== null) }
      : guitarShape(chord, null);
    const voicing = shape && shape.pitches.length
      ? { bass: shape.pitches[0] + shift, notes: shape.pitches.slice(1).map((p) => p + shift), strum: true }
      : { ...voiceChord(chord, null) };
    shapes.set(x.name, { frets: shape ? shape.frets : null, voicing });
  }
  chartNames = [...shapes.keys()];
  renderStrum();
  $("r-now").textContent = song.title;
  refreshPlayer();
  lit = null;
}

// Arrangement view: each line of bars; in a bar, each chord as wide as its beats.
function renderBars(key) {
  const arr = song.arr;
  parts = arr.sections.map((s) => s.name);
  for (const e of arrangementEvents(arr)) {
    seq.push({ si: e.si, li: e.li, ci: e.ci, name: e.chord ? nameOf(e.chord) : "N.C.", chord: e.chord, beats: e.beats, at: e.at });
  }
  return arr.sections.map((sec, si) => {
    const lines = sec.lines.map((line, li) => {
      let ci = 0;
      const bars = line.bars.map((bar) => {
        const cells = [];
        for (const b of bar.beats) {
          if (b.hold && cells.length) cells[cells.length - 1].span++;
          else cells.push(b.hold ? { hold: true, span: 1 } : { chord: b.chord, ci: ci++, span: 1 });
        }
        const html = cells.map((c) => {
          const span = `style="grid-column: span ${c.span}"`;
          if (c.hold) return `<span class="hold" ${span}>·</span>`; // the chord of the bar before goes on
          const name = c.chord ? esc(nameOf(c.chord)) : "N.C.";
          const num = prefs.numerals && c.chord ? `<small>${esc(numeralOf(c.chord, key))}</small>` : "";
          return `<span class="chip" data-pos="${si}-${li}-${c.ci}" ${span}><b>${name}</b>${num}</span>`;
        }).join("");
        return `<div class="bar" style="grid-template-columns: repeat(${bar.beats.length}, 1fr)">${html}</div>`;
      }).join("");
      return `<div class="bars">${bars}${line.repeat > 1 ? `<span class="repeat">×${line.repeat}</span>` : ""}</div>`;
    }).join("");
    return `<div class="part"><div class="part-head"><h3>${esc(sec.name)}</h3>${loopButton(si)}</div>${lines}</div>`;
  }).join("");
}

// The strum pattern of an arrangement, drawn as arrows over the counts of the bar
// ("1 & 2 &…"); the stroke playing lights up.
const STROKE_ICON = { D: "↓", d: "↓", U: "↑", u: "↑", x: "×" };
function renderStrum() {
  const box = $("strum-view");
  const pattern = song.arr && song.arr.strum;
  box.hidden = !pattern;
  if (!pattern) return;
  const per = pattern.length / song.arr.time; // slots per beat
  const sub = { 1: [""], 2: ["", "&"], 3: ["", "&", "a"], 4: ["", "e", "&", "a"] }[per];
  box.innerHTML = `<span class="strum-label">Strum</span><span class="strokes">` + pattern.map((s, k) => {
    const count = sub ? (k % per === 0 ? String(k / per + 1) : sub[k % per]) : "";
    const soft = s === "d" || s === "u";
    return `<span class="stroke${s ? "" : " rest"}${soft ? " soft" : ""}" data-k="${k}"><b>${s ? STROKE_ICON[s] : "·"}</b><small>${count}</small></span>`;
  }).join("") + `</span>`;
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
  player.setVoicings(playing.map((x) => {
    if (!x.chord) return { rest: true, beats: x.beats }; // N.C.: a silence
    const v = shapes.get(x.name).voicing;
    // Arrangement: the real length, and where it starts in the bar (for the strum).
    return x.beats ? { ...v, beats: x.beats, at: x.at, barBeats: song.arr.time, pattern: song.arr.strum } : v;
  }));
}

// ---- Editor: paste a song, or the lyrics of a built-in song ----

let editing = null; // { builtin } or { item } or {} for a new song

const SHEET_HINT = $("ed-text").placeholder;
const ARRANGEMENT_HINT = `Hurt — Johnny Cash
Tempo 92 · Capo 0 · Strum: D  D U  U D U
Shapes: Am=x02210  C=x32010  Dsus2=xx0230  G=320003
[Verse]
| Am . C . | Dsus2 . . . | Am . C . | Dsus2 . . . |
[Chorus]
| G . . . | Am . . . | F . . . | C . . . |`;

function openEditor(target) {
  editing = target;
  showOnly("editor");
  const item = target.item || (target.builtin && lyricsOf[target.builtin]) || null;
  const builtin = target.builtin && BUILT_IN.find((s) => s.id === target.builtin);
  const arrangement = !!(target.arrangement || (item && !builtin && isArrangement(item.text)));
  $("editor-title").textContent = builtin ? `Lyrics · ${builtin.title}`
    : arrangement ? (item ? "Edit arrangement" : "My arrangement") : item ? "Edit song" : "Add a song";
  $("ed-text").placeholder = arrangement ? ARRANGEMENT_HINT : SHEET_HINT;
  $("arr-help").hidden = !arrangement;
  $("ed-help").hidden = arrangement;
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
  // An arrangement (bars and beats) or a chord sheet (chords over the words)?
  const arr = !editing.builtin && isArrangement(text) ? parseArrangement(text) : null;
  if (arr) {
    if (arr.errors.length) return void ($("ed-status").textContent = arr.errors.slice(0, 3).join(" "));
    if (!arrangementEvents(arr).some((e) => e.chord)) return void ($("ed-status").textContent = "No chords found: write bars like | Am . C . |");
  } else {
    const sheet = parseSheet(text);
    const chords = sheet.flatMap((p) => p.lines.flatMap((l) => l.segments.filter((s) => s.chord)));
    if (!chords.length) {
      $("ed-status").textContent = editing.arrangement
        ? "No bars found: write each bar between | |, one word per beat, like | Am . C . |"
        : "No chords found: paste the song with its chords (above the words, or like [Am]).";
      return;
    }
  }
  const old = editing.item || (editing.builtin && lyricsOf[editing.builtin]);
  const item = editing.builtin
    ? { id: "lyrics:" + editing.builtin, kind: "song", builtin: editing.builtin, text }
    : { id: old ? old.id : "song:" + Date.now().toString(36), kind: "song", text,
        title: $("ed-title").value.trim() || (arr && arr.title) || "Untitled",
        artist: $("ed-artist").value.trim() || (arr && arr.artist) || "", capo: Number($("ed-capo").value) || 0 };
  await Library.put(item);
  Library.persist();
  await loadLibrary();
  location.hash = encodeURIComponent(editing.builtin || item.id);
  route();
});

$("ed-cancel").addEventListener("click", () => {
  if (/^#new/.test(location.hash)) location.hash = "";
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
  $("r-play").classList.toggle("playing", player.running);
  $("r-play-icon").setAttribute("d", player.running ? STOP_PATH : PLAY_PATH);
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
  // Touch a chord: its card (chart, "Play from here", "Open in Chords").
  const chip = e.target.closest("[data-pos]");
  if (chip) {
    const x = seqAt(chip);
    if (!x || !x.chord) return;
    popover.show(chip, x.name, shapes.get(x.name).frets);
  }
});

const seqAt = (chip) => {
  const [si, li, ci] = chip.dataset.pos.split("-").map(Number);
  return seq.find((x) => x.si === si && x.li === li && x.ci === ci);
};

// Play the song from the chord touched (what touching a chord did before the card).
function playFrom(chip) {
  loopPart = -1;
  refreshPlayer();
  const [si, li, ci] = chip.dataset.pos.split("-").map(Number);
  const from = seq.findIndex((x) => x.si === si && x.li === li && x.ci === ci);
  play(Math.max(0, from));
}

// Hear one chord: its shape strummed once, with the sound chosen.
function hearChord(name) {
  const s = shapes.get(name);
  if (!s) return;
  ctx.resume();
  const t = ctx.currentTime + 0.03;
  [s.voicing.bass, ...s.voicing.notes].forEach((p, k) => sound.note(p, 0.6, t + k * 0.025, 1.8, k ? "chord" : "bass"));
}

const popover = new ChordPopover({ hear: hearChord, playFrom });

// ---- Reading: scroll on its own, full screen ----

const scroller = new AutoScroll(() => ($("autoscroll").checked = false));
const reading = new ReadingMode($("sheet-box"), (on) => {
  scroller.box = on ? $("sheet-box") : null;
  scroller.pos = null;
  $("reading").textContent = on ? "Close" : "Full screen";
  popover.close();
});
$("reading").addEventListener("click", () => reading.toggle());
$("autoscroll").addEventListener("change", (e) => scroller.set(e.target.checked));
$("scroll-speed").value = prefs.scrollSpeed;
scroller.speed = prefs.scrollSpeed;
$("scroll-speed").addEventListener("input", (e) => {
  prefs.scrollSpeed = scroller.speed = Number(e.target.value);
  save();
});
// The play button of the reading bar (the big one is out of sight in full screen).
$("r-play").addEventListener("click", () => $("play").click());

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

// Tempo, rhythm, sound: opt() / setOpt() read and keep them per arrangement (see above).
const bpm = $("bpm");
const showBpm = () => {
  player.bpm = Number(opt("bpm"));
  bpm.value = player.bpm;
  $("bpm-out").textContent = player.bpm + " bpm";
};
bpm.addEventListener("input", () => { setOpt("bpm", Number(bpm.value)); showBpm(); });

const repaints = []; // called when another song opens: its own settings may differ
function segmented(id, field, onChange) {
  const el = $(id);
  const paint = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === opt(field)));
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setOpt(field, b.dataset.v);
    paint();
    onChange();
  });
  repaints.push(() => { paint(); onChange(); });
}
segmented("beats", "beats", () => (player.beats = Number(opt("beats"))));
segmented("rhythm", "rhythm", () => (player.rhythm = opt("rhythm") === "strum" && !(song && song.arr && song.arr.strum) ? "pulse" : opt("rhythm")));
segmented("sound", "sound", () => { if (sound.kind !== opt("sound")) sound.setKind(opt("sound")); });
function applyOptions() {
  showBpm();
  repaints.forEach((f) => f());
}
applyOptions();

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

let litStroke = -1;
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
      $("now").innerHTML = item ? `${esc(item.name)}${item.chord ? `<small>${esc(numeralOf(item.chord, songKey()))}</small>` : ""}` : "—";
      $("r-now").textContent = item ? item.name : song.title;
      $("status").textContent = item
        ? `${parts[item.si]}${loopPart >= 0 ? " (loop)" : ""} · ${player.bpm} bpm`
        : "Press play, touch a chord for its shape, or loop a part.";
    }
    guitar.show(chartNames.map((n) => ({ name: n, frets: shapes.get(n).frets })), item ? chartNames.indexOf(item.name) : -1);
    // The stroke of the strum pattern playing now.
    let k = -1;
    if (m && m.voicing.pattern && player.rhythm === "strum") {
      const beatsIn = (ctx.currentTime - m.t) * player.bpm / 60 + (m.voicing.at || 0);
      const n = m.voicing.pattern.length;
      k = Math.floor(beatsIn / (m.voicing.barBeats / n) + 1e-6) % n;
    }
    if (k !== litStroke) {
      litStroke = k;
      document.querySelectorAll("#strum-view .stroke").forEach((el) => el.classList.toggle("on", Number(el.dataset.k) === k));
    }
  }
  requestAnimationFrame(frame);
}

// ---- Which view: the address decides ----

function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === "new") openEditor({});
  else if (id === "new-arrangement") openEditor({ arrangement: true });
  else if (id) showSong(id);
  else showList();
}
window.addEventListener("hashchange", route);
loadLibrary().then(route);
requestAnimationFrame(frame);
