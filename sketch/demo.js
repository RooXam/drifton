// The starter project: three scenes in A minor, so the page makes music at once.
//   1 Drift   pad chords, a slow piano figure, a whisper of percussion
//   2 Groove  the same chords with a beat, a bass line and offbeat piano stabs
//   3 Float   new chords, half-time drums, long bass notes

function demoProject() {
  const p = newProject("First sketch");
  Object.assign(p, { bpm: 92, swing: 0.25, key: 9, scale: "minor" });
  p.scenes = ["Drift", "Groove", "Float", "", "", "", "", ""];
  const [drums, bass, keys, pad] = p.tracks;

  const a = Progression.voice(["i7", "bVImaj7", "bIIIadd9", "bVII"], 9); // Am7 Fmaj7 Cadd9 G
  const b = Progression.voice(["iv7", "v7", "bVImaj7", "bVII"], 9);      // Dm7 Em7 Fmaj7 G

  // A drum clip from a text pattern per lane: "x" hard, "o" soft, "." nothing.
  function beat(name, bars, lanes) {
    const clip = newClip(bars, name);
    for (const [pitch, pattern] of Object.entries(lanes)) {
      [...pattern.replace(/ /g, "")].forEach((c, s) => {
        if (c !== ".") clip.notes.push({ p: +pitch, s, l: 1, v: c === "x" ? 0.85 : 0.45 });
      });
    }
    return clip;
  }

  // Piano: chord tones an octave up, on a rhythm (steps in the bar), one figure per bar.
  function figure(name, chords, steps, len, pick) {
    const clip = newClip(4, name);
    chords.forEach((c, bar) => {
      const tones = c.notes.map((n) => n + 12);
      steps.forEach((s, i) => {
        for (const p of pick(tones, i)) clip.notes.push({ p, s: bar * 16 + s, l: len, v: 0.5 + (i % 2 ? 0 : 0.15) });
      });
    });
    return clip;
  }

  // Scene 1: Drift
  drums.clips[0] = beat("Whisper", 1, {
    42: "..o. ..o. ..o. ..oo",
    37: ".... ..o. .... ...o",
    36: "x... .... ..o. ....",
  });
  keys.clips[0] = figure("Arp", a, [0, 3, 6, 10, 12], 3, (t, i) => [t[[0, 1, 2, 3, 1][i] % t.length]]);
  pad.clips[0] = Progression.padClip(a, "Chords");

  // Scene 2: Groove
  drums.clips[1] = beat("Groove", 1, {
    46: ".... .... .... ..o.",
    42: "xoxo xoxo xoxo xo.o",
    39: ".... x... .... x...",
    38: ".... x... .... x..o",
    36: "x... ...o ..x. ....",
  });
  bass.clips[1] = (() => {
    const clip = newClip(4, "Line");
    a.forEach((c, bar) => {
      const r = c.bass - 12 < 31 ? c.bass : c.bass - 12; // low, A1 to G2
      [[0, 3, r, 0.85], [3, 2, r, 0.5], [7, 2, r + 12, 0.6], [10, 4, r, 0.75], [14, 2, r + 7, 0.5]]
        .forEach(([s, l, pitch, v]) => clip.notes.push({ p: pitch, s: bar * 16 + s, l, v }));
    });
    return clip;
  })();
  keys.clips[1] = figure("Stabs", a, [2, 6, 11], 1, (t) => t.slice(1));
  pad.clips[1] = Progression.padClip(a, "Chords");

  // Scene 3: Float
  drums.clips[2] = beat("Half time", 2, {
    42: "o.o. o.o. o.o. o.o.  o.o. o.o. o.o. ooo.",
    38: ".... .... x... ....  .... .... x... ....",
    36: "x... .... .... ..o.  x... ..o. .... ....",
  });
  bass.clips[2] = Progression.bassClip(b, "Long");
  keys.clips[2] = figure("Bells", b, [0, 8], 6, (t, i) => [t[t.length - 1 - i]]);
  pad.clips[2] = Progression.padClip(b, "Float");
  for (const c of keys.clips[2].notes) c.v = 0.4;
  return p;
}
