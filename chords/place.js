// Place it: the name of a chord is given, the player puts the fingers on the neck.
// Touch a fret on a string to put a finger there (again to lift it), touch above the nut
// to switch the string between open (○) and not played (×). Then check: ✓ or ✗ under
// each string. Another correct way to play the chord counts too.

function setupPlace() {
  const placeNeck = new Neck($("place-neck"), (s) => {
    const p = placeNeck.pitch(s);
    if (p === null) sound.mute(); else sound.pluck(p);
  });
  placeNeck.rows = 7;      // frets 1 to 7: every hand-written shape fits
  placeNeck.firstFret = 1;

  let target = null, frets = [], checked = false, firstTry = true;
  let right = 0, rounds = 0;

  const draw = (extra = {}) => placeNeck.set(frets, { dots: true, strings: !extra.marks, notes: false, root: null, roles: null, marks: null, ghost: null, ...extra });

  placeNeck.onPlace = (s, f) => {
    if (checked && $("place-next").hidden === false) return; // solved: look, don't touch
    if (f === "nut") frets[s] = frets[s] === -1 ? 0 : -1;
    else frets[s] = frets[s] === f ? 0 : f;
    frets = frets.slice();
    checked = false;
    $("place-feedback").textContent = "";
    draw();
    // Hear the string as it is now.
    const p = placeNeck.pitch(s);
    if (p === null) sound.mute(); else { wake(); sound.pluck(p); }
  };

  // Does this shape play the chord? Only its notes, the bass lowest, every note there
  // (the fifth may be left out of a chord of 4 notes or more).
  function plays(fr, chord) {
    const ps = fr.map((f, s) => (f < 0 ? null : OPEN_PITCHES[s] + f)).filter((p) => p !== null);
    if (ps.length < 3) return false;
    const pcs = new Set(chord.intervals.map((i) => (chord.root + i) % 12));
    const allowed = new Set([...pcs, chord.bass]);
    if (ps.some((p) => !allowed.has(p % 12)) || ps[0] % 12 !== chord.bass) return false;
    const have = new Set(ps.map((p) => p % 12));
    const fifth = (chord.root + 7) % 12;
    return [...pcs].every((pc) => have.has(pc) || (pc === fifth && pcs.size >= 4));
  }

  function check() {
    checked = true;
    const chord = chordOf(target.name);
    const marks = frets.map((f, s) => f === target.frets[s]);
    const exact = marks.every(Boolean);
    const other = !exact && plays(frets, chord);
    if (exact || other) {
      if (firstTry) right++;
      rounds++;
      $("place-feedback").innerHTML = exact
        ? `Yes! That's <b>${target.name}</b>.`
        : `Yes! That's <b>${target.name}</b> too, another way to play it. The usual shape is in rings.`;
      draw({ marks: frets.map(() => true), ghost: exact ? null : target.frets });
      playFrets(frets, placeNeck);
      $("place-next").hidden = false;
      $("place-check").disabled = true;
    } else {
      firstTry = false;
      const n = marks.filter(Boolean).length;
      $("place-feedback").innerHTML = `${n} of 6 strings right. Change the ✗ strings and check again.`;
      draw({ marks });
    }
    updateScore();
  }

  function reveal() {
    firstTry = false;
    const chord = chordOf(target.name);
    draw({ ghost: target.frets, marks: frets.map((f, s) => f === target.frets[s]) });
    $("place-feedback").innerHTML = `<b>${target.name}</b>: the rings show where the fingers go.` +
      `<span class="formula">${formula(chord, pitches(target))}</span>`;
    playFrets(target.frets, placeNeck);
  }

  function updateScore() {
    $("place-right").textContent = right;
    $("place-rounds").textContent = rounds;
  }

  function newRound() {
    const list = pool();
    let next;
    do next = list[Math.floor(Math.random() * list.length)]; while (list.length > 1 && target && next.name === target.name);
    target = next;
    frets = [0, 0, 0, 0, 0, 0];
    checked = false;
    firstTry = true;
    // Shapes higher than fret 7 (some computed ones): show the neck from their first fret.
    const high = Math.max(...target.frets);
    placeNeck.firstFret = high > 7 ? Math.min(...target.frets.filter((f) => f > 0)) : 1;
    $("place-question").innerHTML = `Place <b>${target.name}</b> on the neck.`;
    $("place-feedback").textContent = "";
    $("place-next").hidden = true;
    $("place-check").disabled = false;
    draw();
  }

  $("place-check").addEventListener("click", check);
  $("place-strum").addEventListener("click", () => playFrets(frets, placeNeck));
  $("place-clear").addEventListener("click", () => { frets = [0, 0, 0, 0, 0, 0]; checked = false; $("place-feedback").textContent = ""; draw(); });
  $("place-show").addEventListener("click", reveal);
  $("place-next").addEventListener("click", newRound);
  newRound();
  updateScore();
  return { newRound };
}
