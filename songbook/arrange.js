// My own arrangements: how I play a song, written as text. Unlike a chord sheet from a
// site, an arrangement has real timing (bars and beats), my exact shapes and my strum.
//
//   Hurt — Johnny Cash                                  ← title — artist
//   Tempo 92 · Capo 0 · Time 4/4 · Strum: D  D U  U D U  ← settings, any order
//   Shapes: Am=x02210  C=x32010  Dsus2=xx0230  G=320003  ← my fingerings
//   [Verse]                                             ← a part
//   | Am . C . | Dsus2 . . . | Am . C . | Dsus2 . . . |  ← bars: one word per beat
//
// In a bar each word is a beat: a chord starts there, "." holds the chord before it
// (even across bar lines). A bar with a single chord lasts a whole bar (Time, 4 beats by
// default). "%" repeats the bar before, "N.C." is a silence, "x2" after a line repeats it.
//
// Strum: one stroke per slot, the slots spread evenly over a bar (8 slots in 4/4 = eighth
// notes). D = down, U = up, x = muted hit, "-" or "." = no stroke. Two ways to write it:
// "D  D U  U D U" (one space between strokes, a double space = a slot without stroke) or
// "D DU UDU" (strokes glued together, each space = a slot without stroke).
// Built on chordsym.js (parseSymbol).

const META_RE = /^(tempo|bpm|capo|strum|shapes|time|key)\b\s*:?\s*(.*)$/i;
const HOLD = /^[.\/\-–—_]$/;

// A fret spec → 6 frets, low E first: "x02210", or "x-10-12-12-11-10" for frets above 9.
function parseFrets(spec) {
  const parts = /[-,.]/.test(spec) ? spec.split(/[-,.]/) : [...spec];
  if (parts.length !== 6) return null;
  const frets = parts.map((p) => (/^[xX]$/.test(p) ? -1 : /^\d{1,2}$/.test(p) ? Number(p) : NaN));
  return frets.some((f) => Number.isNaN(f) || f > 24) ? null : frets;
}

// The strum pattern → slots: "D", "U", "x" or null (no stroke). Lower case d / u = softer.
function parseStrum(text) {
  const t = text.trim();
  if (!t) return null;
  const words = t.split(/\s+/);
  let chars;
  if (words.every((w) => w.length === 1)) chars = t.split(" ").map((w) => w || "-"); // "D  D U"
  else chars = [...t].map((c) => (c === " " ? "-" : c));                             // "D DU UDU"
  const slots = chars.map((c) => (/^[DUdux]$/i.test(c) ? (c === "X" ? "x" : c) : null));
  return slots.some(Boolean) ? slots : null;
}

// Is this text an arrangement (rather than a chord sheet)? It has bar lines, and either
// settings (Tempo, Strum, Shapes…) or held beats (".").
function isArrangement(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim());
  const bars = lines.filter((l) => /^\|.*\|(\s*[x×]\s?\d+)?$/.test(l));
  if (!bars.length) return false;
  return lines.some((l) => l.split(/\s*[·•]\s*/).some((f) => META_RE.test(f))) || bars.some((l) => /\s\.(\s|\|)/.test(l));
}

function parseArrangement(raw) {
  const arr = { title: "", artist: "", tempo: 0, capo: null, time: 4, key: "", strum: null, shapes: {}, sections: [], errors: [] };
  let part = null, lastBar = null;
  const lines = String(raw || "").replace(/\r/g, "").replace(/\t/g, "    ").replace(/ /g, " ").split("\n");

  for (const [n, line] of lines.entries()) {
    const t = line.trim();
    if (!t) continue;

    // Settings line: fields separated by "·" (or on lines of their own).
    const fields = t.split(/\s*[·•]\s*/);
    if (fields.every((f) => META_RE.test(f))) {
      for (const f of fields) {
        const [, name, value] = META_RE.exec(f);
        const k = name.toLowerCase();
        if (k === "tempo" || k === "bpm") arr.tempo = Math.max(30, Math.min(260, parseInt(value, 10) || 0)) || 0;
        else if (k === "capo") arr.capo = Math.max(0, Math.min(12, parseInt(value, 10) || 0));
        else if (k === "time") { const m = /^(\d+)/.exec(value); if (m) arr.time = Math.max(1, Math.min(12, Number(m[1]))); }
        else if (k === "key") arr.key = value.trim();
        else if (k === "strum") arr.strum = parseStrum(value);
        else if (k === "shapes") {
          for (const pair of value.trim().split(/\s+/)) {
            const [name, spec] = pair.split("=");
            const frets = spec && parseFrets(spec);
            if (name && frets) arr.shapes[name] = frets;
            else if (pair) arr.errors.push(`Line ${n + 1}: can't read the shape "${pair}" (write it like Am=x02210).`);
          }
        }
      }
      continue;
    }

    // A part: [Verse], [Chorus]…
    const head = /^\[([^\]]+)\]$/.exec(t);
    if (head) { part = { name: head[1].trim(), lines: [] }; arr.sections.push(part); continue; }

    // A line of bars.
    if (t.startsWith("|")) {
      const rep = /[x×]\s?(\d+)\s*$/i.exec(t.slice(t.lastIndexOf("|") + 1));
      const bars = [];
      for (const cell of t.slice(0, t.lastIndexOf("|")).split("|").map((c) => c.trim()).filter(Boolean)) {
        if (cell === "%" && lastBar) { bars.push(lastBar); continue; }
        const beats = [];
        for (const w of cell.split(/\s+/)) {
          if (HOLD.test(w)) beats.push({ hold: true });
          else if (/^n\.?c\.?$/i.test(w)) beats.push({ chord: null });
          else {
            const chord = parseSymbol(w);
            if (chord) beats.push({ chord });
            else { arr.errors.push(`Line ${n + 1}: "${w}" is not a chord.`); beats.push({ hold: true }); }
          }
        }
        // A bar with a single chord lasts the whole bar.
        if (beats.length === 1 && !beats[0].hold) while (beats.length < arr.time) beats.push({ hold: true });
        lastBar = { beats };
        bars.push(lastBar);
      }
      if (!bars.length) continue;
      if (!part) { part = { name: "Song", lines: [] }; arr.sections.push(part); }
      part.lines.push({ bars, repeat: rep ? Math.max(1, Math.min(16, Number(rep[1]))) : 1 });
      continue;
    }

    // Anything else before the first part: the title line ("Title — Artist").
    if (!arr.title && !arr.sections.length) {
      const [title, artist] = t.split(/\s+[—–-]\s+|\s+by\s+/i);
      arr.title = title.trim();
      arr.artist = (artist || "").trim();
    }
  }
  arr.sections = arr.sections.filter((s) => s.lines.length);
  return arr;
}

// The chords of an arrangement in playing order, each with its real length:
// [{ si, li, ci, chord, beats, at }] — si / li: part and line, ci: the chord's number in
// its line, at: the beat of the bar it starts on (to keep the strum in place).
// A "." at the start of a line (or of a repeat) lengthens the chord before it.
function arrangementEvents(arr) {
  const out = [];
  for (const [si, sec] of arr.sections.entries()) {
    for (const [li, line] of sec.lines.entries()) {
      for (let r = 0; r < line.repeat; r++) {
        let ci = 0;
        for (const bar of line.bars) {
          bar.beats.forEach((b, at) => {
            const last = out[out.length - 1];
            if (b.hold) { if (last) last.beats++; return; }
            out.push({ si, li, ci: ci++, chord: b.chord, beats: 1, at, barBeats: bar.beats.length });
          });
        }
      }
    }
  }
  return out;
}
