// Guitar view: the notes sounding now, on a guitar neck (standard tuning, 15 frets).
//
// A note can be played on several strings. We pick, for the whole group of notes heard
// together, one hand position (a window of 5 frets, open strings free) and one string per
// note: as many notes as possible, the lowest position first, and not far from the
// previous position so the hand doesn't jump. Notes too low or too high for a guitar
// are moved by octaves and drawn hollow.

const NECK_TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4, low string first
const NECK_FRETS = 15;
const NECK_LOW = NECK_TUNING[0], NECK_HIGH = NECK_TUNING[5] + NECK_FRETS;

// Pitches (with their part) → { spots: [{ pitch, part, string, fret, moved }], missing, pos }
function placeOnNeck(notes, previousPos = 0) {
  // Into the guitar's range; one note per pitch; at most 6 (keep the lowest and the top).
  let list = notes.map((n) => {
    let p = n.pitch;
    while (p < NECK_LOW) p += 12;
    while (p > NECK_HIGH) p -= 12;
    return { pitch: p, part: n.part, moved: p !== n.pitch };
  });
  list = [...new Map(list.sort((a, b) => a.pitch - b.pitch).map((n) => [n.pitch, n])).values()];
  const dropped = Math.max(0, list.length - 6);
  if (dropped) list = [list[0], ...list.slice(-5)];

  let best = null, bestScore = Infinity;
  for (let pos = 0; pos <= NECK_FRETS - 4; pos++) {
    // Strings each note can use at this position.
    const options = list.map((n) => {
      const o = [];
      NECK_TUNING.forEach((open, s) => {
        const f = n.pitch - open;
        if (f === 0 || (f >= Math.max(1, pos) && f <= pos + 4)) o.push({ s, f });
      });
      return o;
    });
    const used = new Array(6).fill(false);
    const chosen = [];
    const walk = (i, placed) => {
      if (i === list.length) {
        const score = (list.length - placed) * 10 + pos + 0.4 * Math.abs(pos - previousPos);
        if (score < bestScore) { bestScore = score; best = { pos, spots: chosen.filter(Boolean).map((x) => ({ ...x })) }; }
        return;
      }
      for (const o of options[i]) {
        if (used[o.s]) continue;
        used[o.s] = true;
        chosen[i] = { ...list[i], string: o.s, fret: o.f };
        walk(i + 1, placed + 1);
        used[o.s] = false;
      }
      chosen[i] = null; // or leave this note out
      walk(i + 1, placed);
    };
    walk(0, 0);
  }
  if (!best) return { spots: [], missing: notes.length, pos: previousPos };
  return { spots: best.spots, missing: list.length - best.spots.length + dropped, pos: best.pos };
}

class NeckView {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.key = "";
    this.placed = { spots: [], missing: 0, pos: 0 };
    this.showNames = false;
    new ResizeObserver(() => { this.key = ""; }).observe(canvas);
  }

  // The notes of `song` sounding at `pos` (visible parts only).
  update(song, pos, nameOf) {
    if (this.canvas.hidden) return;
    const sounding = [];
    if (song) {
      const notes = song.notes;
      for (let i = lowerBound(notes, pos - song.maxLength); i < notes.length && notes[i].start <= pos; i++) {
        const n = notes[i];
        if (n.end > pos && song.parts[n.part].visible) sounding.push(n);
      }
    }
    const key = sounding.map((n) => n.pitch + ":" + n.part).sort().join(",") + "|" + this.canvas.clientWidth + "|" + this.showNames;
    if (key === this.key) return;
    this.key = key;
    this.placed = placeOnNeck(sounding, this.placed.pos);
    this.draw(nameOf);
  }

  draw(nameOf) {
    const { canvas, g } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // Geometry: the nut on the left, frets to the right; high E string on top, like tabs.
    const left = 26, right = w - 10, top = 20, bottom = h - 22;
    const fretX = (f) => left + ((right - left) * f) / NECK_FRETS;
    const stringY = (s) => bottom - ((bottom - top) * s) / 5;
    const midX = (f) => (f === 0 ? left - 12 : (fretX(f - 1) + fretX(f)) / 2);

    // The hand position: a soft band over its 5 frets.
    const { pos, spots, missing } = this.placed;
    if (spots.some((x) => x.fret > 0)) {
      g.fillStyle = "rgba(138, 127, 255, 0.07)";
      g.fillRect(fretX(Math.max(0, pos - 1)), top - 6, fretX(pos + 4) - fretX(Math.max(0, pos - 1)), bottom - top + 12);
    }
    // Inlays, fret numbers
    g.fillStyle = "#2a2640";
    for (const f of [3, 5, 7, 9, 12, 15]) {
      const x = midX(f);
      if (f === 12) { for (const y of [top + (bottom - top) * 0.3, top + (bottom - top) * 0.7]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); } }
      else { g.beginPath(); g.arc(x, (top + bottom) / 2, 4, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = "#5d5a73";
    g.font = "10px -apple-system, sans-serif";
    g.textAlign = "center";
    for (const f of [3, 5, 7, 9, 12, 15]) g.fillText(String(f), midX(f), h - 6);
    // Frets, nut, strings (thicker for the low ones)
    g.fillStyle = "#3a3650";
    for (let f = 1; f <= NECK_FRETS; f++) g.fillRect(Math.round(fretX(f)), top, 1, bottom - top);
    g.fillStyle = "#8a879c";
    g.fillRect(left - 2, top - 1, 3, bottom - top + 2);
    for (let s = 0; s < 6; s++) {
      g.fillStyle = "#6b6880";
      g.fillRect(left, stringY(s) - (2.2 - s * 0.3) / 2, right - left, 2.2 - s * 0.3);
    }

    // The notes: a dot in the part's colour; hollow when moved by an octave.
    for (const x of spots) {
      const c = partColors(x.part);
      const cx = midX(x.fret), cy = stringY(x.string);
      const r = Math.min(10, (bottom - top) / 12);
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      if (x.moved) { g.strokeStyle = c.base; g.lineWidth = 2; g.stroke(); }
      else { g.fillStyle = c.base; g.shadowColor = c.base; g.shadowBlur = 12; g.fill(); g.shadowBlur = 0; }
      if (this.showNames && nameOf) {
        g.fillStyle = x.moved ? c.base : c.text;
        g.font = `600 ${Math.round(r)}px -apple-system, sans-serif`;
        g.fillText(nameOf(x.pitch), cx, cy + r * 0.35);
      }
    }
    if (missing) {
      g.fillStyle = "#8a879c";
      g.font = "11px -apple-system, sans-serif";
      g.textAlign = "right";
      g.fillText(`+${missing} not on the neck`, right, 11);
    }
  }
}
