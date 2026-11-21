// Reads a Standard MIDI File (.mid) and turns it into a "song": a list of notes with their
// times in seconds, grouped in parts (one per track / channel), plus the bar lines.
//
// A MIDI file is binary: a header chunk ("MThd"), then one chunk per track ("MTrk").
// A track is a list of events (note on, note off, tempo, pedal…), each preceded by the
// time since the previous event, in "ticks". The header says how many ticks make a beat,
// and tempo events say how long a beat lasts: that's how ticks become seconds.

const DRUM_CHANNEL = 9; // "channel 10" in MIDI speak: drums, not useful on a piano

function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer);
  let pos = findChunk(bytes, "MThd");
  if (pos < 0) throw new Error("This is not a MIDI file.");

  // Small readers that move `pos` forward. MIDI numbers are big-endian (high byte first).
  const u8 = () => bytes[pos++];
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8();
  // Variable-length number: 7 bits per byte, the top bit says "another byte follows".
  const vlq = () => {
    let v = 0, b;
    do { b = u8(); v = v * 128 + (b & 0x7f); } while (b & 0x80 && pos < bytes.length);
    return v;
  };
  const text = (n) => String.fromCharCode(...bytes.subarray(pos, pos + n));

  // Header
  pos += 4;
  const headerLength = u32();
  const headerEnd = pos + headerLength;
  u16(); // format (0: one track, 1: several tracks played together): read the same way
  u16(); // number of tracks: we simply read every track chunk we find
  const division = u16();
  pos = headerEnd;

  // What we collect from all the tracks, times still in ticks
  const tempos = [];  // { tick, mpq }  mpq = microseconds per quarter note
  const meters = [];  // { tick, num, den }  time signatures (4/4, 3/4…)
  const pedals = [];  // { tick, channel, down }  sustain pedal
  const raw = [];     // { on, off, pitch, velocity, channel, track }
  const names = [];   // track names
  let flats = null;   // from the first key signature: show B♭ rather than A♯
  let lastTick = 0;

  function readTrack(track, end) {
    const open = new Map(); // channel*128+pitch → notes started and not yet released
    let tick = 0, status = 0;
    while (pos < end) {
      tick += vlq();
      let b = u8();

      if (b === 0xff) { // meta event: tempo, time signature, name, end of track…
        const type = u8(), length = vlq(), start = pos;
        if (type === 0x51 && length >= 3) {
          tempos.push({ tick, mpq: (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2] });
        } else if (type === 0x58 && length >= 2) {
          meters.push({ tick, num: bytes[pos], den: 2 ** bytes[pos + 1] });
        } else if (type === 0x59 && flats === null) {
          flats = ((bytes[pos] << 24) >> 24) < 0; // signed byte: number of sharps (+) or flats (−)
        } else if (type === 0x03 && names[track] === undefined) {
          names[track] = decodeText(bytes.subarray(pos, pos + length)).trim();
        }
        pos = start + length;
        if (type === 0x2f) break; // end of track
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { pos += vlq(); continue; } // system exclusive: skip

      // "Running status": an event can omit its first byte when it's the same as before.
      if (b < 0x80) {
        if (!status) continue; // corrupt data, skip the byte
        pos--;
        b = status;
      } else if (b >= 0xf0) {
        break; // unexpected system message: stop reading this track
      } else {
        status = b;
      }

      const kind = b >> 4, channel = b & 0x0f;
      const d1 = u8(), d2 = kind === 0xc || kind === 0xd ? 0 : u8();
      const key = channel * 128 + d1;

      if (kind === 0x9 && d2 > 0) { // note on
        if (channel === DRUM_CHANNEL) continue;
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ on: tick, pitch: d1, velocity: d2 / 127, channel, track });
      } else if (kind === 0x8 || kind === 0x9) { // note off (or note on with velocity 0)
        const waiting = open.get(key);
        if (waiting && waiting.length) {
          const note = waiting.shift();
          note.off = tick;
          raw.push(note);
        }
      } else if (kind === 0xb && d1 === 64) { // controller 64 = sustain pedal
        pedals.push({ tick, channel, down: d2 >= 64 });
      }
    }
    // Notes never released: end them with the track.
    for (const waiting of open.values()) {
      for (const note of waiting) { note.off = tick; raw.push(note); }
    }
    lastTick = Math.max(lastTick, tick);
  }

  // Read every track chunk.
  for (let track = 0; pos + 8 <= bytes.length; ) {
    const id = text(4);
    pos += 4;
    const length = u32(); // read first: it moves `pos`
    const end = Math.min(pos + length, bytes.length);
    if (id === "MTrk") readTrack(track++, end);
    pos = end;
  }

  const toSeconds = tickConverter(division, tempos);

  // Parts: one per (track, channel) pair that has notes.
  const partOf = new Map();
  const parts = [];
  raw.sort((a, b) => a.track - b.track || a.channel - b.channel);
  for (const n of raw) {
    const k = n.track * 16 + n.channel;
    if (!partOf.has(k)) {
      partOf.set(k, parts.length);
      parts.push({ track: n.track, channel: n.channel });
    }
  }
  for (const p of parts) {
    const shared = parts.filter((q) => q.track === p.track).length > 1;
    p.name = (names[p.track] || `Track ${p.track + 1}`) + (shared ? ` · ch ${p.channel + 1}` : "");
  }

  // Pedal: a note keeps sounding after its key is released while the pedal is down.
  const pedalSpans = pedalIntervals(pedals, toSeconds);

  const notes = raw.map((n) => {
    const start = toSeconds(n.on);
    const end = Math.max(toSeconds(n.off), start + 0.05);
    return {
      pitch: n.pitch,
      velocity: n.velocity,
      start,
      end,
      soundEnd: pedalRelease(pedalSpans[n.channel], end),
      part: partOf.get(n.track * 16 + n.channel),
    };
  });

  const beats = []; // filled by barLines: every beat (metronome, chord analysis)
  const bars = division & 0x8000 ? [] : barLines(division, meters, lastTick, toSeconds, beats);
  const firstTempo = tempos.find((t) => t.tick === 0);
  const firstMeter = meters.find((m) => m.tick === 0);
  return makeSong(notes, parts, bars, {
    bpm: firstTempo ? 60e6 / firstTempo.mpq : 120,
    meter: firstMeter ? `${firstMeter.num}/${firstMeter.den}` : "4/4",
    flats: !!flats,
    beats: beats.length ? beats : null,
  });
}

// Returns a function tick → seconds, following the tempo changes.
function tickConverter(division, tempos) {
  if (division & 0x8000) {
    // Rare "SMPTE" timing: ticks are fractions of video frames, no tempo involved.
    const fps = 256 - (division >> 8); // stored as a negative number: −24, −25, −29, −30
    const perTick = 1 / ((fps === 29 ? 29.97 : fps) * (division & 0xff));
    return (tick) => tick * perTick;
  }
  const ppq = division; // ticks per quarter note
  if (!ppq) throw new Error("Invalid MIDI timing.");
  // Segments of constant tempo: from `tick` on, each tick lasts `spt` seconds.
  const segments = [{ tick: 0, sec: 0, spt: 0.5 / ppq }]; // default tempo: 120 bpm
  for (const t of tempos.sort((a, b) => a.tick - b.tick)) {
    const last = segments[segments.length - 1];
    const spt = t.mpq / 1e6 / ppq;
    if (t.tick === last.tick) last.spt = spt;
    else segments.push({ tick: t.tick, sec: last.sec + (t.tick - last.tick) * last.spt, spt });
  }
  return (tick) => {
    // Binary search for the last segment starting at or before `tick`.
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    const s = segments[lo];
    return s.sec + (tick - s.tick) * s.spt;
  };
}

// Bar start times in seconds, following the time signature changes. Also pushes every
// beat into `beats` (a beat = one note of the signature's lower number: a quarter in 4/4).
function barLines(ppq, meters, lastTick, toSeconds, beats = []) {
  meters.sort((a, b) => a.tick - b.tick);
  const bars = [];
  let num = 4, den = 4, m = 0, tick = 0;
  while (tick <= lastTick && bars.length < 10000) {
    while (m < meters.length && meters[m].tick <= tick) ({ num, den } = meters[m++]);
    bars.push(toSeconds(tick));
    let next = tick + Math.max(1, (ppq * 4 * num) / den);
    if (m < meters.length && meters[m].tick < next) next = meters[m].tick; // change mid-bar
    for (let b = tick; b < next - 1e-6; b += (ppq * 4) / den) beats.push(toSeconds(b));
    tick = next;
  }
  return bars;
}

// Per channel, the [down, up] times of the sustain pedal, in seconds.
function pedalIntervals(pedals, toSeconds) {
  const spans = {};
  const downAt = {};
  for (const p of pedals.sort((a, b) => a.tick - b.tick)) {
    if (p.down && downAt[p.channel] === undefined) downAt[p.channel] = toSeconds(p.tick);
    if (!p.down && downAt[p.channel] !== undefined) {
      (spans[p.channel] = spans[p.channel] || []).push([downAt[p.channel], toSeconds(p.tick)]);
      delete downAt[p.channel];
    }
  }
  for (const ch in downAt) (spans[ch] = spans[ch] || []).push([downAt[ch], Infinity]);
  return spans;
}

// When does a note released at `end` really stop, given the pedal?
function pedalRelease(spans, end) {
  if (!spans) return end;
  for (const [down, up] of spans) {
    if (down > end) break;
    if (end < up) return Math.min(up, end + 8); // a pedal held forever shouldn't ring forever
  }
  return end;
}

// The song object shared by the MIDI reader and the demo.
function makeSong(notes, parts, bars, info = {}) {
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  let duration = 0, maxLength = 0, low = 127, high = 0;
  for (const n of notes) {
    duration = Math.max(duration, n.end);
    maxLength = Math.max(maxLength, n.end - n.start);
    low = Math.min(low, n.pitch);
    high = Math.max(high, n.pitch);
  }
  parts.forEach((p, i) => {
    p.count = notes.filter((n) => n.part === i).length;
    p.visible = true; // drawn on the roll
    p.audible = true; // heard
  });
  return {
    notes, parts, duration, maxLength, low, high,
    bars: bars.filter((t) => t < duration),
    beats: (info.beats || evenBeats(bars, duration, info.meter)).filter((t) => t < duration),
    bpm: info.bpm || 120,
    meter: info.meter || "4/4",
    flats: !!info.flats,
  };
}

// No beats given (the demo): split each bar evenly by the signature's upper number.
function evenBeats(bars, duration, meter = "4/4") {
  const n = Number(meter.split("/")[0]) || 4;
  const beats = [];
  bars.forEach((t, i) => {
    const end = i + 1 < bars.length ? bars[i + 1] : t + (i ? t - bars[i - 1] : duration - t);
    for (let k = 0; k < n; k++) beats.push(t + ((end - t) * k) / n);
  });
  return beats;
}

function findChunk(bytes, id) {
  // Usually at 0; some files are wrapped in a "RIFF" container with the MIDI data inside.
  for (let i = 0; i + 4 <= Math.min(bytes.length, 4096); i++) {
    if (String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]) === id) return i;
  }
  return -1;
}

function decodeText(b) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("windows-1252").decode(b);
  }
}
