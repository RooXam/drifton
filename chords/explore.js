// Explore: any chord, chosen by its root and its type (or typed: "F#m7b5", "D/F#"), shown
// on the neck (every position: the hand-written shape, then shapes computed along the
// neck, all within 4 frets) and on a keyboard, with the role of each note. Playable.

const CHORD_TYPES = [
  ["", "major"], ["m", "minor"], ["7", "7 (dominant)"], ["m7", "minor 7"], ["maj7", "major 7"],
  ["sus2", "sus2"], ["sus4", "sus4"], ["7sus4", "7sus4"], ["add9", "add9"], ["6", "6"], ["m6", "minor 6"],
  ["9", "9"], ["m9", "minor 9"], ["maj9", "major 9"], ["dim", "diminished"], ["dim7", "diminished 7"],
  ["m7b5", "half-diminished (m7b5)"], ["aug", "augmented"], ["5", "power chord (5)"],
];

function setupExplore() {
  const exNeck = new Neck($("ex-neck"), (s) => {
    const p = exNeck.pitch(s);
    if (p === null) sound.mute(); else sound.pluck(p);
  });
  const exKeys = new Keyboard($("ex-keys"), (p) => playKeys([p]));

  let name = "C", chord = chordOf("C"), positions = [], at = 0;

  // The pickers: 12 roots, the types.
  $("ex-roots").innerHTML = PC_NAMES.map((n) => `<button data-v="${n}">${n}</button>`).join("");
  $("ex-type").innerHTML = CHORD_TYPES.map(([q, label]) => `<option value="${q}">${label}</option>`).join("") +
    `<option value="?" hidden>other</option>`;

  function show() {
    const frets = positions.length ? positions[at].frets : null;
    const ps = frets ? shapePitches(frets) : [];
    const roles = rolesFor(chord, ps.concat(pianoVoicing(chord)));
    $("ex-neck").hidden = !frets;
    const spell = spellingOf(chord);
    if (frets) exNeck.set(frets, { dots: true, strings: false, notes: true, root: chord.root, roles, spell });
    exKeys.set(pianoVoicing(chord), { dots: true, names: true, root: chord.root, roles, spell });
    const from = positions.length ? { given: "the shape from the Songbook", hand: "the usual shape", computed: "computed" }[positions[at].from] : "";
    $("ex-pos").textContent = positions.length ? `Position ${at + 1} of ${positions.length} · ${from}` : "No shape found within 4 frets";
    $("ex-prev").disabled = at <= 0;
    $("ex-next").disabled = at >= positions.length - 1;
    $("ex-guitar-play").hidden = $("ex-guitar-arp").hidden = !frets;
  }

  // Open a chord by name (with a shape to show first, from the Songbook).
  function open(text, given) {
    const c = chordOf(text);
    if (!c) {
      $("ex-name").textContent = text;
      $("ex-kind").textContent = "Not a chord name I can read (try Am7, F#m, Dsus4, G/B).";
      return false;
    }
    name = text.trim();
    chord = c;
    positions = positionsFor(chord, given && given.length === 6 ? given : null);
    at = 0;
    $("ex-name").textContent = name;
    $("ex-kind").textContent = chordKind(name).replace(/^an? /, "").replace(/^./, (x) => x.toUpperCase()) + ".";
    $("ex-notes").innerHTML = formula(chord, pianoVoicing(chord).concat(positions.length ? shapePitches(positions[0].frets) : []));
    $("ex-input").value = name;
    // The pickers follow, when the name is one of theirs.
    const m = /^([A-G][#b]?)(.*?)(\/.*)?$/.exec(name);
    $("ex-roots").querySelectorAll("button").forEach((b) => b.classList.toggle("active", PC_NAMES.indexOf(b.dataset.v) === chord.root));
    const q = m ? m[2] : "?";
    $("ex-type").value = m && !m[3] && CHORD_TYPES.some(([t]) => t === q) ? q : "?";
    show();
    return true;
  }

  const pickers = () => open(PC_NAMES[chord.root] + ($("ex-type").value === "?" ? "" : $("ex-type").value));
  $("ex-roots").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    chord = { ...chord, root: PC_NAMES.indexOf(b.dataset.v) };
    pickers();
    playFrets(positions[0]?.frets || [], exNeck);
  });
  $("ex-type").addEventListener("change", () => { pickers(); if (positions[0]) playFrets(positions[0].frets, exNeck); });
  $("ex-input").addEventListener("change", (e) => { if (open(e.target.value) && positions[0]) playFrets(positions[0].frets, exNeck); });
  $("ex-prev").addEventListener("click", () => { at = Math.max(0, at - 1); show(); playFrets(positions[at].frets, exNeck); });
  $("ex-next").addEventListener("click", () => { at = Math.min(positions.length - 1, at + 1); show(); playFrets(positions[at].frets, exNeck); });
  $("ex-guitar-play").addEventListener("click", () => playFrets(positions[at].frets, exNeck));
  $("ex-guitar-arp").addEventListener("click", () => playFrets(positions[at].frets, exNeck, 0.35));
  $("ex-piano-play").addEventListener("click", () => playKeys(pianoVoicing(chord)));

  open("C");
  return { open };
}
