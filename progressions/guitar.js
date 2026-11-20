// Guitar: find a playable shape for each chord, and draw chord charts.
//
// A piano voicing often can't be played on a guitar. So for each chord we search:
// - one fret per string, or the string muted (only below or above the strings played);
// - all frets within a window of 4 frets (open strings are free);
// - the lowest string played gives the bass note (the root, or the note after the "/");
// - the important notes are there: root, third, seventh (the fifth can go);
// - at most 4 fingers, a finger lying across several strings (barre) counting as one;
// - close to the previous shape, so the hand doesn't jump around the neck.
// Every possibility is tried and scored; the lowest score wins.

const TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4, low string first

function guitarShape(chord, previous) {
  const pcs = chord.intervals.map((i) => (chord.root + i) % 12);
  const fifth = (chord.root + 7) % 12;
  // Required notes: everything but the fifth (and, if really needed, the tensions).
  const levels = [
    pcs.filter((pc) => pc !== fifth || pcs.length <= 3),
    pcs.filter((pc, k) => (pc !== fifth || pcs.length <= 3) && chord.intervals[k] < 12),
    [chord.root, chord.bass],
  ];
  const allowed = new Set(pcs.concat(chord.bass));
  for (const required of levels) {
    const best = searchShape(chord, allowed, new Set(required), previous);
    if (best) return best;
  }
  return null;
}

function searchShape(chord, allowed, required, previous) {
  let best = null, bestScore = Infinity;
  for (let low = 1; low <= 10; low++) {
    // Options per string: muted (−1), open (0), or a fret in [low, low + 3] giving a chord note.
    // Open strings only near the nut: with the hand high up the neck they sound odd.
    const frets = low <= 2 ? [0, low, low + 1, low + 2, low + 3] : [low, low + 1, low + 2, low + 3];
    const options = TUNING.map((open) => {
      const o = [-1];
      for (const f of frets) {
        if (allowed.has((open + f) % 12) && !o.includes(f)) o.push(f);
      }
      return o;
    });
    const shape = new Array(6);
    const walk = (s) => {
      if (s === 6) {
        const score = scoreShape(shape, chord, required, previous, low);
        if (score < bestScore) { bestScore = score; best = shape.slice(); }
        return;
      }
      for (const f of options[s]) {
        // The strings played follow each other: muted ones only below or above them.
        if (f !== -1 && s > 0 && shape[s - 1] === -1 && shape.slice(0, s).some((x) => x !== -1)) continue;
        shape[s] = f;
        walk(s + 1);
      }
    };
    walk(0);
  }
  return best && { frets: best, pitches: best.map((f, s) => (f < 0 ? null : TUNING[s] + f)).filter((p) => p !== null) };
}

function scoreShape(frets, chord, required, previous, low) {
  const played = frets.map((f, s) => (f < 0 ? null : { s, f, pc: (TUNING[s] + f) % 12 })).filter(Boolean);
  if (played.length < Math.min(4, required.size + 1) && !(chord.intervals.length === 2 && played.length >= 3)) return Infinity;
  if (played[0].pc !== chord.bass) return Infinity; // the bass must be the lowest note
  const have = new Set(played.map((p) => p.pc));
  for (const pc of required) if (!have.has(pc)) return Infinity;

  // Fingers: fretted notes, a barre on the lowest fret counting as one finger.
  const fretted = played.filter((p) => p.f > 0);
  let fingers = 0, span = 0;
  if (fretted.length) {
    const min = Math.min(...fretted.map((p) => p.f));
    span = Math.max(...fretted.map((p) => p.f)) - min;
    const onMin = fretted.filter((p) => p.f === min);
    fingers = fretted.length;
    if (fingers > 4 && onMin.length > 1) {
      // Barre: the first finger lies across the strings from the lowest one at `min`,
      // so none of the strings above it can ring open.
      const from = onMin[0].s;
      if (played.some((p) => p.s > from && p.f < min)) return Infinity;
      fingers -= onMin.length - 1;
    }
    if (fingers > 4) return Infinity;
  }
  const muted = 6 - played.length;
  const opens = played.length - fretted.length;
  let score = low * 0.35 + muted * 0.5 + fingers * 0.3 + span * 0.35 - opens * 0.3;
  if (previous) {
    // Stay near the previous shape (compare the average fret of the fretted notes).
    const avg = (fr) => { const f = fr.filter((x) => x > 0); return f.length ? f.reduce((a, b) => a + b) / f.length : 0; };
    score += Math.abs(avg(frets) - avg(previous)) * 0.25;
  }
  return score;
}

// The shapes for a whole progression, each one near the previous (twice round the loop,
// like the piano voicing, so the last chord also leads back into the first).
function guitarVoicings(chords) {
  let prev = null;
  const out = [];
  for (let round = 0; round < 2; round++) {
    chords.forEach((c, i) => {
      const shape = guitarShape(c, prev);
      if (shape) prev = shape.frets;
      out[i] = shape;
    });
  }
  return out.map((shape, i) => {
    if (!shape) return { ...voiceChord(chords[i], null), frets: null }; // no shape found: piano notes
    const [bass, ...notes] = shape.pitches;
    return { bass, notes, frets: shape.frets, strum: true };
  });
}

// ---- Chord charts ----

class GuitarView {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.state = "";
    this.chords = [];   // { name, frets }
    this.current = -1;
    new ResizeObserver(() => this.draw(true)).observe(canvas);
  }

  show(chords, current) {
    this.chords = chords;
    this.current = current;
    this.draw();
  }

  draw(force = false) {
    const key = JSON.stringify([this.chords, this.current, this.canvas.clientWidth]);
    if (!force && key === this.state) return;
    this.state = key;
    const { canvas, g } = this;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    if (!this.chords.length) return;

    // As many charts per row as fit (at least 76 px each); more rows if needed.
    const n = this.chords.length;
    const perRow = Math.max(1, Math.min(n, Math.floor(W / (76 * dpr))));
    const rows = Math.ceil(n / perRow);
    const rowH = 150;
    if (Math.round(canvas.clientHeight) !== rows * rowH) {
      canvas.style.height = rows * rowH + "px"; // the ResizeObserver will redraw
      return;
    }
    const cellW = Math.min(W / perRow, 150 * dpr);
    const H1 = H / rows;
    this.chords.forEach((c, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const x0 = (W - cellW * inRow) / 2 + col * cellW;
      g.save();
      g.translate(0, row * H1);
      this.drawChart(c, i, x0, cellW, H1, dpr);
      g.restore();
    });
  }

  drawChart(c, i, x0, cellW, H, dpr) {
    const g = this.g;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim();
    const bassColor = css.getPropertyValue("--c-bass").trim();
    const fg = css.getPropertyValue("--fg").trim();
    const muted = css.getPropertyValue("--muted").trim();
    const on = i === this.current;
    // Card behind the chord playing now.
    if (on) {
      g.fillStyle = "#2b2745";
      g.strokeStyle = accent;
      g.lineWidth = dpr;
      g.beginPath();
      g.roundRect ? g.roundRect(x0 + 4 * dpr, 2 * dpr, cellW - 8 * dpr, H - 4 * dpr, 10 * dpr) : g.rect(x0 + 4 * dpr, 2 * dpr, cellW - 8 * dpr, H - 4 * dpr);
      g.fill();
      g.stroke();
    }
    g.fillStyle = on ? fg : muted;
    g.font = `600 ${13 * dpr}px sans-serif`;
    g.textAlign = "center";
    g.fillText(c.name, x0 + cellW / 2, 18 * dpr);
    if (!c.frets) {
      g.font = `${11 * dpr}px sans-serif`;
      g.fillText("no simple shape", x0 + cellW / 2, H / 2);
      return;
    }

    // Grid: 6 strings (vertical, low E on the left), 4 frets (horizontal).
    const gw = Math.min(cellW * 0.62, 84 * dpr);
    const gx = x0 + (cellW - gw) / 2, gy = 38 * dpr, gh = H - gy - 12 * dpr;
    const sx = (s) => gx + (s / 5) * gw;
    const fretted = c.frets.filter((f) => f > 0);
    const top = fretted.length && Math.max(...fretted) > 4 ? Math.min(...fretted) : 1;
    const fy = (k) => gy + (k / 4) * gh; // k-th fret line from the top

    g.strokeStyle = on ? "#8a879c" : "#4a4760";
    g.lineWidth = dpr;
    for (let s = 0; s < 6; s++) { g.beginPath(); g.moveTo(sx(s), gy); g.lineTo(sx(s), gy + gh); g.stroke(); }
    for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(gx, fy(k)); g.lineTo(gx + gw, fy(k)); g.stroke(); }
    if (top === 1) { g.lineWidth = 3 * dpr; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + gw, gy); g.stroke(); }
    else {
      g.fillStyle = muted;
      g.font = `${10 * dpr}px sans-serif`;
      g.textAlign = "right";
      g.fillText(`${top}fr`, gx - 5 * dpr, fy(0.5) + 4 * dpr);
    }

    // Dots, open strings (o), muted strings (×). The bass note is blue.
    const bassString = c.frets.findIndex((f) => f >= 0);
    g.textAlign = "center";
    g.font = `${10 * dpr}px sans-serif`;
    c.frets.forEach((f, s) => {
      const color = s === bassString ? bassColor : accent;
      if (f < 0) { g.fillStyle = muted; g.fillText("×", sx(s), gy - 5 * dpr); return; }
      if (f === 0) {
        g.strokeStyle = color; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.arc(sx(s), gy - 8 * dpr, 3.5 * dpr, 0, Math.PI * 2); g.stroke();
        return;
      }
      g.fillStyle = color;
      g.globalAlpha = on ? 1 : 0.7;
      g.beginPath(); g.arc(sx(s), fy(f - top + 0.5), Math.min(6 * dpr, gw / 12), 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    });
  }
}
