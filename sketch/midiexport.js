// Clips and scenes → Standard MIDI Files, for Ableton Live (or any DAW).
//
// Uses the byte helpers of ../progressions/midiwrite.js (tempoTrack, noteTrack, PPQ…),
// with one MIDI track per instrument, named after it. Drums go on channel 10 (index 9)
// with General MIDI notes, which Live's Drum Racks map to kick, snare, hats…
// Times are written straight (no swing): Live can add its own groove.

// tracks: [{ name, channel, clip }] → bytes of a format 1 file.
function writeSketchMidi(tracks, bpm, title) {
  const chunks = [tempoTrack(bpm, title)];
  for (const t of tracks) {
    const notes = t.clip.notes.map((n) => ({ pitch: n.p, start: n.s / 4, length: n.l / 4, velocity: n.v }));
    chunks.push(noteTrack(notes, t.name, t.channel));
  }
  const header = [...ascii("MThd"), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)];
  return new Uint8Array(header.concat(...chunks.map((c) => [...ascii("MTrk"), ...u32(c.length), ...c])));
}

const SketchMidi = {
  channelOf(trackIndex) { return TRACK_DEFS[trackIndex].drums ? 9 : trackIndex; },

  clip(project, trackIndex, slot) {
    const track = project.tracks[trackIndex];
    const clip = track.clips[slot];
    const name = clip.name || track.name;
    return writeSketchMidi([{ name, channel: this.channelOf(trackIndex), clip }], project.bpm, name);
  },

  // Every clip of a scene row, one track each (empty slots are left out).
  scene(project, row) {
    const tracks = [];
    project.tracks.forEach((t, i) => {
      if (t.clips[row]) tracks.push({ name: t.name, channel: this.channelOf(i), clip: t.clips[row] });
    });
    const title = project.scenes[row] || `Scene ${row + 1}`;
    return tracks.length ? writeSketchMidi(tracks, project.bpm, title) : null;
  },
};

// Hand a file to the user. On a phone, the share sheet (AirDrop to the Mac, Files,
// Messages…); elsewhere, or if sharing is refused, a normal download.
async function deliverFile(bytes, filename, type) {
  const coarse = matchMedia("(pointer: coarse)").matches;
  try {
    const file = new File([bytes], filename, { type });
    if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled"; // the user closed the share sheet
  }
  downloadFile(bytes, filename, type); // ../progressions/midiwrite.js
  return "downloaded";
}

// "My idea #2" → "my-idea-2", for file names.
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sketch";
}
