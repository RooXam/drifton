// Writes a Standard MIDI File (.mid): the mirror of ../score/midi.js, which reads them.
//
// Format 1 = several tracks played together. Track 0 holds the tempo; then one track for
// the chords and one for the bass, so Ableton (or any DAW) puts them on two tracks.
// Times are in "ticks": PPQ ticks per beat (quarter note).

const PPQ = 480;

// notes: [{ pitch, start, length, velocity (0..1), role }] with start / length in beats.
function writeMidi(notes, bpm, name) {
  const tracks = [
    tempoTrack(bpm, name),
    noteTrack(notes.filter((n) => n.role === "chord"), "Chords", 0),
    noteTrack(notes.filter((n) => n.role === "bass"), "Bass", 1),
  ];
  const header = [...ascii("MThd"), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  const bytes = header.concat(...tracks.map((t) => [...ascii("MTrk"), ...u32(t.length), ...t]));
  return new Uint8Array(bytes);
}

function tempoTrack(bpm, name) {
  const mpq = Math.round(60e6 / bpm); // microseconds per quarter note
  return [
    ...meta(0x03, ascii(name)),                                    // track name
    ...meta(0x51, [(mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff]), // tempo
    ...meta(0x58, [4, 2, 24, 8]),                                  // time signature 4/4
    ...meta(0x2f, []),                                             // end of track
  ];
}

function noteTrack(notes, name, channel) {
  // Every note becomes a "note on" and a "note off" event, sorted by time.
  const events = [];
  for (const n of notes) {
    const on = Math.round(n.start * PPQ);
    const off = Math.round((n.start + n.length) * PPQ);
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    events.push({ tick: on, bytes: [0x90 | channel, n.pitch, vel] });
    events.push({ tick: off, bytes: [0x80 | channel, n.pitch, 0], off: true });
  }
  // At the same tick, note offs first: a repeated note must end before it starts again.
  events.sort((a, b) => a.tick - b.tick || (b.off ? 1 : 0) - (a.off ? 1 : 0));

  const out = [...meta(0x03, ascii(name))];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last), ...e.bytes); // each event: time since the previous one
    last = e.tick;
  }
  out.push(...meta(0x2f, []));
  return out;
}

// Meta event at delta 0: FF type length data.
function meta(type, data) {
  return [0, 0xff, type, ...vlq(data.length), ...data];
}

// Variable-length number: 7 bits per byte, the top bit says "another byte follows".
function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

// Make the browser save the bytes as a file (works from file:// too).
function downloadFile(bytes, filename, type = "audio/midi") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
