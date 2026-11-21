// The Chords page: four ways to learn guitar chords, one tab each.
// - Guess: a chord shape (or its sound), four names, hints one after another; the shape
//   can also be shown on a piano keyboard instead of the neck.
// - Place it (place.js): the name is given, put the fingers on the neck, check.
// - Progressions (progression.js): hear 2 to 4 chords, find them in order.
// - Explore (explore.js): any chord, on the neck and on the keyboard, each note's role.
//   ?chord=Am7 in the address opens it on that chord (the Songbook links here).
// This file: the sounds, the settings, the chords to practise, the Guess game, the tabs.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const sound = new PluckSound(ctx);  // the guitar
const piano = new PianoSound(ctx);  // ../score/piano.js, for the keyboard
const $ = (id) => document.getElementById(id);

// Browsers only start audio after a touch: wake it on the first one.
const wake = () => { if (ctx.state !== "running") ctx.resume(); };
document.addEventListener("pointerdown", wake, true);

// ---- Settings and best score, remembered in the browser ----

const SAVE_KEY = "drifton.chords.v1";
const prefs = { mode: "see", families: ["open"], volume: 80, best: 0, view: "guess", instrument: "guitar" };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch {}
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(prefs)); } catch {} };

// ---- Sounds ----

// Strum a shape on the guitar (`gap` seconds between strings), making the strings glow.
function playFrets(frets, onNeck, gap = 0.03, down = true) {
  wake();
  const strings = frets.map((f, s) => (f < 0 ? -1 : s)).filter((s) => s >= 0);
  if (!down) strings.reverse();
  const t = ctx.currentTime + 0.03;
  strings.forEach((s, i) => {
    sound.pluck(OPEN_PITCHES[s] + frets[s], t + i * gap, gap > 0.1 ? 0.8 : 0.72);
    if (onNeck) setTimeout(() => { onNeck.glow[s] = performance.now(); onNeck.animate(); }, 30 + i * gap * 1000);
  });
}
// The same notes on the piano: together, or one by one (`gap` seconds apart).
function playKeys(pitches, gap = 0) {
  wake();
  const t = ctx.currentTime + 0.03;
  pitches.forEach((p, i) => piano.play(p, 0.65, t + i * gap, gap ? 1.2 : 2));
}

// ---- The chords to practise: the families chosen ----

let songShapes = []; // "From my songs" (mysongs.js), loaded at start

function pool() {
  const all = SHAPES.concat(songShapes);
  const list = all.filter((s) => prefs.families.includes(s.family));
  return list.length ? list : SHAPES.filter((s) => s.family === "open");
}

const pitches = (s) => s.frets.map((f, i) => (f < 0 ? null : OPEN_PITCHES[i] + f)).filter((p) => p !== null);
const rootOf = (name) => (chordOf(name) || { root: 0 }).root;

// Three wrong answers that look like the right one: same root or same kind first.
function lookalikes(target, n, list) {
  const all = list.length >= n + 1 ? list : SHAPES.concat(list);
  const seen = new Set([target.name]);
  const others = all.filter((s) => !seen.has(s.name) && seen.add(s.name)).map((s) => ({
    name: s.name,
    score: (rootOf(s.name) === rootOf(target.name) ? 2 : 0) + (chordKind(s.name) === chordKind(target.name) ? 1 : 0) + Math.random() * 1.5,
  }));
  others.sort((a, b) => b.score - a.score);
  return others.slice(0, n).map((o) => o.name);
}
const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

// ---- Guess: one round ----

const neck = new Neck($("neck"), (s) => {
  const p = neck.pitch(s);
  if (p === null) sound.mute(); else sound.pluck(p);
});
const keys = new Keyboard($("keys"), (p) => playKeys([p]));

let shape = null;   // the chord to guess
let hints = 0;      // how many hints given
let wrong = false;  // a wrong answer this round
let solved = false;
let score = 0, streak = 0;

const onPiano = () => prefs.instrument === "piano";
const keyNotes = () => pianoVoicing(chordOf(shape.name));
const shown = () => (onPiano() ? keyNotes() : pitches(shape)); // the notes the player sees

// Show the chord with what the hints reveal so far, on the neck or the keyboard.
function display(show) {
  const spell = spellingOf(chordOf(shape.name)); // note names as written in this chord
  if (onPiano()) keys.set(keyNotes(), { dots: !!show.dots, names: !!show.notes, root: show.root ?? null, roles: show.roles || null, spell });
  else neck.set(shape.frets, { ...show, spell });
}

// The hints in order. "By ear" starts by showing the shape (or the keys).
function hintList() {
  const spell = spellingOf(chordOf(shape.name));
  const notes = [...new Set(shown().map((p) => spell[p % 12]))];
  const root = rootOf(shape.name);
  const list = onPiano() ? [
    { show: { notes: true }, text: `The notes of the chord: ${notes.join(" · ")}. The lowest key is the bass.` },
    { show: { root }, text: `The root, the note that names the chord, is in blue: ${spell[root]}.` },
    { show: {}, text: `It's ${chordKind(shape.name)}.` },
  ] : [
    { show: { strings: true }, text: "The strings, from low to high: E A D G B E. A dot on a string raises its note by one semitone per fret." },
    { show: { notes: true }, text: `The notes of the chord: ${notes.join(" · ")}.` },
    { show: { root }, text: `The root, the note that names the chord, is in blue: ${spell[root]}.` },
    { show: {}, text: `It's ${chordKind(shape.name)}.` },
  ];
  if (prefs.mode === "ear") list.unshift({ show: { dots: true }, text: onPiano() ? "Here are the keys." : "Here is the shape." });
  else list.forEach((h) => (h.show.dots = true));
  return list;
}

function newRound() {
  const list = pool();
  let next;
  do next = list[Math.floor(Math.random() * list.length)]; while (list.length > 1 && shape && next.name === shape.name);
  shape = next;
  hints = 0;
  wrong = false;
  solved = false;
  $("neck").hidden = onPiano();
  $("keys").hidden = !onPiano();
  $("strum").textContent = onPiano() ? "Play" : "Strum ↓";
  display({ dots: prefs.mode === "see", strings: false, notes: false, root: null, roles: null });
  $("hints").innerHTML = "";
  $("question").textContent = prefs.mode === "see" ? "Which chord is this?" : `Which chord do you hear? ${onPiano() ? "Play" : "Strum"} it.`;
  $("choices").innerHTML = shuffle([shape.name, ...lookalikes(shape, 3, pool())]).map((n) => `<button class="choice" data-name="${n}">${n}</button>`).join("");
  $("next").hidden = true;
  $("hint").disabled = false;
  if (prefs.mode === "ear" && ctx.state === "running") setTimeout(() => strum(), 250);
}

const strum = () => (onPiano() ? playKeys(keyNotes()) : playFrets(shape.frets, neck));
const oneByOne = () => (onPiano() ? playKeys(keyNotes(), 0.35) : playFrets(shape.frets, neck, 0.35));

function giveHint() {
  const list = hintList();
  if (hints >= list.length) return;
  const h = list[hints++];
  // Each hint adds to what is shown: keep the earlier ones.
  const show = {};
  for (const x of list.slice(0, hints)) Object.assign(show, x.show);
  display(show);
  $("hints").insertAdjacentHTML("beforeend", `<li>${h.text}</li>`);
  $("hint").disabled = hints >= list.length;
}

// The notes of a chord with their roles, root first: "A <small>(root)</small> · C …".
function formula(chord, notes) {
  const spell = spellingOf(chord);
  return [...new Set(notes.map((p) => p % 12))]
    .sort((a, b) => ((a - chord.root + 12) % 12) - ((b - chord.root + 12) % 12))
    .map((pc) => { const r = roleOf(chord, pc); return `${spell[pc]} <small>(${ROLE_WORDS[r] || r})</small>`; })
    .join(" · ");
}

function finish(found) {
  solved = true;
  if (found && !wrong) {
    score += Math.max(1, 3 - Math.max(0, hints - (prefs.mode === "ear" ? 1 : 0)));
    streak++;
    if (streak > prefs.best) { prefs.best = streak; save(); }
  } else {
    streak = 0;
  }
  // Reveal everything: each note, and its role in the chord. Then play it.
  const chord = chordOf(shape.name);
  display({ dots: true, notes: true, root: chord.root, roles: rolesFor(chord, shown()) });
  $("question").innerHTML = `${found && !wrong ? "Yes! " : ""}It's <b>${shape.name}</b>, ${chordKind(shape.name)}.` +
    `<span class="formula">${formula(chord, shown())}</span>`;
  document.querySelectorAll("#choices .choice").forEach((b) => {
    b.disabled = true;
    if (b.dataset.name === shape.name) b.classList.add("right");
  });
  $("next").hidden = false;
  $("hint").disabled = true;
  strum();
  updateScore();
}

function updateScore() {
  $("score").textContent = score;
  $("streak").textContent = streak;
  $("best").textContent = prefs.best;
}

$("choices").addEventListener("click", (e) => {
  const b = e.target.closest(".choice");
  if (!b || solved) return;
  if (b.dataset.name === shape.name) return finish(true);
  wrong = true;
  streak = 0;
  b.classList.add("wrong");
  b.disabled = true;
  updateScore();
});

$("strum").addEventListener("click", strum);
$("arp").addEventListener("click", oneByOne);
$("hint").addEventListener("click", giveHint);
$("answer").addEventListener("click", () => { if (!solved) finish(false); });
$("next").addEventListener("click", newRound);

// ---- Settings ----

function segmented(id, field, onChange) {
  const el = $(id);
  const paint = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === prefs[field]));
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    prefs[field] = b.dataset.v;
    save();
    paint();
    onChange();
  });
  paint();
}
segmented("mode", "mode", newRound);
segmented("instrument", "instrument", newRound);

// The families changed: every game starts a new round with the new chords.
const familyListeners = [newRound];
$("families").innerHTML = FAMILIES.map((f) =>
  `<label class="fam"><input type="checkbox" value="${f.id}" ${prefs.families.includes(f.id) ? "checked" : ""}> ${f.label}</label>`).join("");
$("families").addEventListener("change", () => {
  prefs.families = [...$("families").querySelectorAll("input:checked")].map((i) => i.value);
  save();
  familyListeners.forEach((f) => f());
});

$("volume").value = prefs.volume;
const setVolume = () => { sound.setVolume(prefs.volume / 100); piano.setVolume(prefs.volume / 100); };
setVolume();
$("volume").addEventListener("input", (e) => {
  prefs.volume = Number(e.target.value);
  setVolume();
  save();
});

// ---- The tabs ----

const VIEWS = ["guess", "place", "prog", "explore"];
const place = setupPlace();
const progression = setupProgression();
const explore = setupExplore();
familyListeners.push(() => place.newRound(), () => progression.newRound());

function showView(v) {
  prefs.view = v;
  save();
  for (const x of VIEWS) $(`${x}-view`).hidden = x !== v;
  $("views").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
  // Settings that only matter for some games.
  $("mode-row").hidden = $("instrument-row").hidden = v !== "guess";
  $("families-row").hidden = v === "explore";
}
$("views").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) showView(b.dataset.v);
});

// ?chord=Am7 (&frets=x02010): open Explore on that chord.
const asked = new URLSearchParams(location.search);
if (asked.get("chord")) {
  explore.open(asked.get("chord"), asked.get("frets") ? parseFrets(asked.get("frets")) : null);
  prefs.view = "explore";
}
showView(VIEWS.includes(prefs.view) ? prefs.view : "guess");
updateScore();
newRound();

// The chords of my songs arrive a moment later (the library is read asynchronously).
songChordShapes().then((list) => {
  songShapes = list;
  const n = $("families").querySelector('input[value="songs"]');
  if (n) n.parentElement.title = `${list.length} chords from the Songbook and your songs`;
  if (prefs.families.includes("songs")) familyListeners.forEach((f) => f());
});
