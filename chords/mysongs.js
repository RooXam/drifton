// "From my songs": the chords of the Songbook's songs as a family of the game. Built-in
// songs (../songbook/songs.js) and the songs I pasted or arranged, read from the library
// on this device (../library.js, read only). Each chord gets a shape: my own (an
// arrangement's "Shapes:"), else the hand-written one, else one computed.

async function songChordShapes() {
  const found = []; // { name, chord, frets }
  const add = (name, frets) => {
    const chord = chordOf(name);
    if (!chord || found.some((f) => sameChord(f.chord, chord))) return;
    found.push({ name, chord, frets: frets || null });
  };

  for (const s of SONGS) for (const sec of s.sections) for (const [chords] of sec.lines) chords.forEach((n) => add(n));

  let items = [];
  try { items = await Library.list("song"); } catch {}
  for (const item of items) {
    if (item.builtin) continue; // lyrics of a built-in song: same chords as above
    if (isArrangement(item.text)) {
      const arr = parseArrangement(item.text);
      for (const e of arrangementEvents(arr)) if (e.chord) add(e.chord.text, arr.shapes[e.chord.text]);
    } else {
      for (const part of parseSheet(item.text || "")) for (const line of part.lines) {
        for (const seg of line.segments) if (seg.chord) add(seg.chord.text);
      }
    }
  }

  return found.map((f) => {
    const frets = f.frets || handShape(f.chord)?.frets || guitarShape(f.chord, null)?.frets;
    return frets ? { name: f.name, family: "songs", frets } : null;
  }).filter(Boolean);
}
