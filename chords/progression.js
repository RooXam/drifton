// Progressions: hear 2 to 4 chords strummed one after the other, and find them in order
// among the choices. The progressions are common ones (I–V–vi–IV, ii–V–I…) in a key
// where every chord is in the families chosen; else a few chords of the families.

const PROGRESSIONS = [
  ["I", "V", "vi", "IV"], ["I", "IV", "V"], ["vi", "IV", "I", "V"], ["I", "vi", "IV", "V"],
  ["ii", "V", "I"], ["I", "IV"], ["I", "V"], ["IV", "V", "I"], ["vi", "V", "IV", "V"],
  ["I", "iii", "IV"], ["vi", "ii", "V", "I"], ["I", "V/7", "vi"], ["I", "IVsus2", "I"],
  ["ii7", "V7", "Imaj7"], ["I7", "IV7"], ["vi7", "ii7", "V7"], ["Imaj7", "IVmaj7"],
  ["Isus4", "I"], ["I", "Iadd9"], ["V7", "I"],
];

function setupProgression() {
  let chords = [];   // the progression: pool entries
  let answered = 0;  // how many slots filled
  let mistakes = 0;
  let right = 0, rounds = 0;
  let timers = [];

  // The pool entry for a chord made from a numeral in a key, if it is in the families.
  const find = (list, made) => list.find((s) => { const c = chordOf(s.name); return c && sameChord(c, made); });

  function pick() {
    const list = pool();
    const options = [];
    for (const p of PROGRESSIONS) {
      for (let key = 0; key < 12; key++) {
        const found = p.map((n) => find(list, makeChord(n, key)));
        if (found.every(Boolean)) options.push(found);
      }
    }
    if (options.length) return options[Math.floor(Math.random() * options.length)];
    // None fits: 2 to 4 different chords of the families.
    const n = Math.min(list.length, 2 + Math.floor(Math.random() * 3));
    return shuffle(list).slice(0, n);
  }

  // Each chord strummed twice (down on 1, down-up on 3), at 90 beats per minute; the slot
  // of the chord playing lights up.
  function play() {
    wake();
    timers.forEach(clearTimeout);
    const beat = 60 / 90, start = ctx.currentTime + 0.1;
    chords.forEach((c, i) => {
      const t0 = start + i * 4 * beat;
      const strings = c.frets.map((f, s) => (f < 0 ? null : OPEN_PITCHES[s] + f)).filter((p) => p !== null);
      const strumAt = (t, down, vel) => (down ? strings : [...strings].reverse().slice(0, 4))
        .forEach((p, k) => sound.pluck(p, t + k * 0.014, vel));
      strumAt(t0, true, 0.75);
      strumAt(t0 + 2 * beat, true, 0.6);
      strumAt(t0 + 3 * beat, false, 0.45);
      timers.push(setTimeout(() => light(i), (t0 - ctx.currentTime) * 1000));
    });
    timers.push(setTimeout(() => light(-1), (start + chords.length * 4 * beat - ctx.currentTime) * 1000));
  }
  const light = (i) => document.querySelectorAll("#slots .slot").forEach((el, k) => el.classList.toggle("playing", k === i));

  function newRound() {
    chords = pick();
    answered = 0;
    mistakes = 0;
    $("slots").innerHTML = chords.map((_, i) => `<span class="slot" data-i="${i}"><b>?</b><small>${i + 1}</small></span>`).join("");
    // The choices: the chords of the progression and look-alikes, six in all.
    const names = [...new Set(chords.map((c) => c.name))];
    const extra = lookalikes(chords[0], Math.max(0, 6 - names.length), pool().filter((s) => !names.includes(s.name)));
    $("prog-choices").innerHTML = shuffle([...names, ...extra.filter((n) => !names.includes(n))].slice(0, 6))
      .map((n) => `<button class="choice" data-name="${n}">${n}</button>`).join("");
    $("prog-question").textContent = `Which ${chords.length} chords, in order? Listen, then choose them one by one.`;
    $("prog-next").hidden = true;
    if (ctx.state === "running" && !$("prog-view").hidden) setTimeout(play, 250);
  }

  $("prog-choices").addEventListener("click", (e) => {
    const b = e.target.closest(".choice");
    if (!b || answered >= chords.length) return;
    const slot = document.querySelector(`#slots .slot[data-i="${answered}"]`);
    const want = chords[answered];
    const ok = b.dataset.name === want.name;
    if (!ok) mistakes++;
    slot.classList.add(ok ? "right" : "wrong");
    slot.querySelector("b").innerHTML = ok ? want.name : `<s>${b.dataset.name}</s> ${want.name}`;
    playFrets(want.frets, null);
    answered++;
    if (answered === chords.length) {
      rounds++;
      if (!mistakes) right++;
      $("prog-question").innerHTML = mistakes
        ? `${chords.length - mistakes} of ${chords.length} right: <b>${chords.map((c) => c.name).join(" → ")}</b>.`
        : `Yes! <b>${chords.map((c) => c.name).join(" → ")}</b>.`;
      $("prog-right").textContent = right;
      $("prog-rounds").textContent = rounds;
      $("prog-next").hidden = false;
    }
  });
  // Touch a slot already found to hear that chord again.
  $("slots").addEventListener("click", (e) => {
    const s = e.target.closest(".slot");
    if (s && Number(s.dataset.i) < answered) playFrets(chords[Number(s.dataset.i)].frets, null);
  });
  $("prog-play").addEventListener("click", play);
  $("prog-next").addEventListener("click", newRound);
  newRound();
  return { newRound, play };
}
