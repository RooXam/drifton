// Reads a chord sheet pasted as text, the way chord sites show songs:
//
//   [Verse 1]                  ← a part
//   Am        C        D       ← a line of chords…
//   some words of the song     ← …placed above the words they go with
//
// or with the chords inside the words ("ChordPro" style): "[Am]some [C]words".
// The result: parts → lines → segments { chord, text }, a chord sitting at the start of
// its piece of text. That's what lets the page show each chord above the right syllable.

const PART_WORDS = /^(intro|verse|chorus|pre-?chorus|bridge|outro|solo|interlude|hook|refrain|instrumental|break|coda|ending|riff|tag)\b/i;
const FILLER = /^(\|+|-+|\/|%|\.+|n\.?c\.?|\(|\)|[x×]\d+|\(?[x×]\s?\d+\)?|\d+[x×])$/i;
const REPEAT = /[x×]\s?(\d+)|(\d+)\s?[x×]/i;

// Is every word of the line a chord (or a bar line, "x2"…)? Then it's a chord line.
function isChordLine(line) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  let chords = 0;
  for (const w of words) {
    const clean = w.replace(/[()]/g, "");
    if (parseSymbol(clean)) chords++;
    else if (!FILLER.test(w)) return false;
  }
  return chords > 0;
}

function partName(line) {
  const t = line.trim();
  const bracket = /^\[([^\]]+)\]$/.exec(t);
  if (bracket && !parseSymbol(bracket[1])) return bracket[1].trim();
  if (t.length < 30 && PART_WORDS.test(t) && !isChordLine(t)) return t.replace(/:$/, "").trim();
  return null;
}

// Chords of a chord line with their column: [{ col, chord }]
function chordsAt(line) {
  const out = [];
  for (const m of line.matchAll(/\S+/g)) {
    const chord = parseSymbol(m[0].replace(/[()]/g, ""));
    if (chord) out.push({ col: m.index, chord });
  }
  return out;
}

// Cut the words under a chord line into segments, one per chord.
function segmentsOf(chords, words) {
  const segs = [];
  const width = Math.max(words.length, chords.length ? chords[chords.length - 1].col + 1 : 0);
  const text = words.padEnd(width);
  if (!chords.length || chords[0].col > 0) segs.push({ chord: null, text: text.slice(0, chords.length ? chords[0].col : width) });
  chords.forEach((c, i) => {
    const end = i + 1 < chords.length ? chords[i + 1].col : width;
    segs.push({ chord: c.chord, text: text.slice(c.col, end) });
  });
  return segs.filter((s) => s.chord || s.text.trim());
}

// "[Am]some [C]words" → segments
function inlineSegments(line) {
  const segs = [];
  let chord = null, last = 0;
  for (const m of line.matchAll(/\[([^\]]+)\]/g)) {
    const c = parseSymbol(m[1]);
    if (!c) continue;
    const text = line.slice(last, m.index);
    if (chord || text) segs.push({ chord, text });
    chord = c;
    last = m.index + m[0].length;
  }
  segs.push({ chord, text: line.slice(last) });
  return segs.filter((s) => s.chord || s.text.trim());
}

function parseSheet(raw) {
  const lines = raw.replace(/\r/g, "").replace(/\t/g, "    ").replace(/ /g, " ").split("\n");
  const parts = [];
  let part = null;
  const add = (line) => {
    if (!part) { part = { name: "Song", lines: [] }; parts.push(part); }
    part.lines.push(line);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const name = partName(line);
    if (name) { part = { name, lines: [] }; parts.push(part); continue; }
    if (isChordLine(line)) {
      const chords = chordsAt(line);
      const next = lines[i + 1];
      // Words right under the chords: put them together.
      if (next !== undefined && next.trim() && !isChordLine(next) && !partName(next)) {
        add({ segments: segmentsOf(chords, next) });
        i++;
      } else {
        const rep = REPEAT.exec(line.replace(/\S+/g, (w) => (parseSymbol(w.replace(/[()]/g, "")) ? "" : w)));
        add({ segments: chords.map((c) => ({ chord: c.chord, text: "" })), chordsOnly: true, repeat: rep ? Number(rep[1] || rep[2]) : 1 });
      }
      continue;
    }
    if (/\[[^\]]+\]/.test(line) && inlineSegments(line).some((s) => s.chord)) {
      add({ segments: inlineSegments(line) });
      continue;
    }
    add({ segments: [{ chord: null, text: line }] }); // words without chords
  }
  return parts.filter((p) => p.lines.length);
}
