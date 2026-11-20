// The guessing game: a chord shape (or its sound), four names, hints one after another.

const ctx = createAudio(); // ../audio.js: works on iPhone too (silent switch, gestures)
const sound = new PluckSound(ctx);
const $ = (id) => document.getElementById(id);

// Browsers only start audio after a touch: wake it on the first one.
const wake = () => { if (ctx.state !== "running") ctx.resume(); };
document.addEventListener("pointerdown", wake, true);

const neck = new Neck($("neck"), (s) => {
  const p = neck.pitch(s);
  if (p === null) sound.mute(); else sound.pluck(p);
});

// ---- Settings and best score, remembered in the browser ----

const SAVE_KEY = "drifton.chords.v1";
const prefs = { mode: "see", families: ["open"], volume: 80, best: 0 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch {}
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(prefs)); } catch {} };

// ---- One round ----

let shape = null;   // the chord to guess
let hints = 0;      // how many hints given
let wrong = false;  // a wrong answer this round
let solved = false;
let score = 0, streak = 0;

const pitches = (s) => s.frets.map((f, i) => (f < 0 ? null : OPEN_PITCHES[i] + f)).filter((p) => p !== null);
const rootOf = (name) => PC_NAMES.indexOf(name.match(/^[A-G][#b]?/)[0].replace("Db", "C#").replace("A#", "Bb").replace("D#", "Eb").replace("G#", "Ab").replace("Gb", "F#"));

// The hints in order. "By ear" starts by showing the shape.
function hintList() {
  const notes = [...new Set(pitches(shape).map((p) => PC_NAMES[p % 12]))];
  const list = [
    { show: { strings: true }, text: "The strings, from low to high: E A D G B E. A dot on a string raises its note by one semitone per fret." },
    { show: { notes: true }, text: `The notes of the chord: ${notes.join(" · ")}.` },
    { show: { root: rootOf(shape.name) }, text: `The root, the note that names the chord, is in blue: ${PC_NAMES[rootOf(shape.name)]}.` },
    { show: {}, text: `It's ${chordKind(shape.name)}.` },
  ];
  if (prefs.mode === "ear") list.unshift({ show: { dots: true }, text: "Here is the shape." });
  return list;
}

function pool() {
  const list = SHAPES.filter((s) => prefs.families.includes(s.family));
  return list.length ? list : SHAPES.filter((s) => s.family === "open");
}

// Three wrong answers that look like the right one: same root or same kind first.
function choicesFor(target) {
  const all = pool().length >= 4 ? pool() : SHAPES;
  const others = all.filter((s) => s.name !== target.name).map((s) => ({
    name: s.name,
    score: (rootOf(s.name) === rootOf(target.name) ? 2 : 0) + (chordKind(s.name) === chordKind(target.name) ? 1 : 0) + Math.random() * 1.5,
  }));
  others.sort((a, b) => b.score - a.score);
  const names = [target.name, ...others.slice(0, 3).map((o) => o.name)];
  return names.sort(() => Math.random() - 0.5);
}

function newRound() {
  const list = pool();
  let next;
  do next = list[Math.floor(Math.random() * list.length)]; while (list.length > 1 && shape && next.name === shape.name);
  shape = next;
  hints = 0;
  wrong = false;
  solved = false;
  neck.set(shape.frets, { dots: prefs.mode === "see", strings: false, notes: false, root: null });
  $("hints").innerHTML = "";
  $("question").textContent = prefs.mode === "see" ? "Which chord is this?" : "Which chord do you hear? Strum it.";
  $("choices").innerHTML = choicesFor(shape).map((n) => `<button class="choice" data-name="${n}">${n}</button>`).join("");
  $("next").hidden = true;
  $("hint").disabled = false;
  if (prefs.mode === "ear" && ctx.state === "running") setTimeout(() => strum(true), 250);
}

// The strings played by the shape, from low to high.
const played = () => shape.frets.map((f, s) => (f < 0 ? -1 : s)).filter((s) => s >= 0);

// Play the strings one after the other (`gap` seconds apart) and make each one vibrate.
function playStrings(order, gap) {
  wake();
  const t = ctx.currentTime + 0.03;
  order.forEach((s, i) => {
    sound.pluck(OPEN_PITCHES[s] + shape.frets[s], t + i * gap, gap > 0.1 ? 0.8 : 0.72);
    setTimeout(() => { neck.glow[s] = performance.now(); neck.animate(); }, 30 + i * gap * 1000);
  });
}
const strum = (down = true) => playStrings(down ? played() : played().reverse(), 0.03);

// The role of each note: its distance from the root, the way musicians name it.
const ROLE_NAMES = {
  R: "root", b3: "minor third", 3: "major third", 5: "fifth", b5: "flat fifth", "#5": "sharp fifth",
  b7: "minor seventh", 7: "major seventh", 2: "second", 4: "fourth", 9: "ninth", 6: "sixth",
};
function rolesOf(s) {
  const root = rootOf(s.name);
  const roles = {};
  for (const p of pitches(s)) {
    const d = (p % 12 - root + 12) % 12;
    roles[p % 12] = { 0: "R", 2: /sus2/.test(s.name) ? "2" : "9", 3: "b3", 4: "3", 5: "4", 6: "b5", 7: "5", 8: "#5", 9: "6", 10: "b7", 11: "7" }[d] || "?";
  }
  return roles;
}

function giveHint() {
  const list = hintList();
  if (hints >= list.length) return;
  const h = list[hints++];
  // Each hint adds to what is shown: keep the earlier ones.
  const show = {};
  for (const x of list.slice(0, hints)) Object.assign(show, x.show);
  neck.set(shape.frets, show);
  $("hints").insertAdjacentHTML("beforeend", `<li>${h.text}</li>`);
  $("hint").disabled = hints >= list.length;
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
  const roles = rolesOf(shape);
  neck.set(shape.frets, { dots: true, notes: true, root: rootOf(shape.name), roles });
  const notes = [...new Set(pitches(shape).map((p) => p % 12))]
    .sort((a, b) => ((a - rootOf(shape.name) + 12) % 12) - ((b - rootOf(shape.name) + 12) % 12))
    .map((pc) => `${PC_NAMES[pc]} <small>(${ROLE_NAMES[roles[pc]] || roles[pc]})</small>`);
  $("question").innerHTML = `${found && !wrong ? "Yes! " : ""}It's <b>${shape.name}</b>, ${chordKind(shape.name)}.` +
    `<span class="formula">${notes.join(" · ")}</span>`;
  document.querySelectorAll(".choice").forEach((b) => {
    b.disabled = true;
    if (b.dataset.name === shape.name) b.classList.add("right");
  });
  $("next").hidden = false;
  $("hint").disabled = true;
  strum(true);
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

$("strum").addEventListener("click", () => strum(true));
$("arp").addEventListener("click", () => playStrings(played(), 0.35));
$("hint").addEventListener("click", giveHint);
$("answer").addEventListener("click", () => { if (!solved) finish(false); });
$("next").addEventListener("click", newRound);

// ---- Settings ----

const modeEl = $("mode");
const paintMode = () => modeEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === prefs.mode));
modeEl.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  prefs.mode = b.dataset.v;
  save();
  paintMode();
  newRound();
});
paintMode();

$("families").innerHTML = FAMILIES.map((f) =>
  `<label class="fam"><input type="checkbox" value="${f.id}" ${prefs.families.includes(f.id) ? "checked" : ""}> ${f.label}</label>`).join("");
$("families").addEventListener("change", () => {
  prefs.families = [...$("families").querySelectorAll("input:checked")].map((i) => i.value);
  save();
  newRound();
});

$("volume").value = prefs.volume;
sound.setVolume(prefs.volume / 100);
$("volume").addEventListener("input", (e) => {
  prefs.volume = Number(e.target.value);
  sound.setVolume(prefs.volume / 100);
  save();
});

updateScore();
newRound();
