// Effects shared by all the instruments of a page: a little studio after the synths.
//
//   instruments ─┬───────────────────────────────► warmth ─► pulse ─► out
//                ├─ send ─► reverb (a room) ────────►  ▲
//                └─ send ─► echo (ping-pong delay) ───┘
//
// - Reverb: a ConvolverNode "plays" the sound through the recorded echo of a room (its
//   impulse response). We don't record one: we make it, a few seconds of stereo noise
//   that fades out and gets darker, which is what a real room does.
// - Echo: two delays feeding each other, one on the left, one on the right; a low-pass
//   in the loop makes each repeat softer and duller, like tape echo.
// - Warmth: a gentle saturation (rounds off the peaks, adds soft harmonics) then a
//   low-pass that takes the edge off the highs.
// - Pulse: the volume moves up and down a little, several times per second (amplitude
//   modulation). Brain.fm uses this to help focus; subtle, it feels like a shimmer.
// - Tape: the sound of an old cassette (a classic of hazy 90s electronica). The pitch wobbles
//   slowly ("wow") and trembles quickly ("flutter"): a very short delay whose length
//   moves, so the sound is read a bit faster, then a bit slower. Plus tape hiss and
//   duller highs.
//
// Each instrument also has its own effect settings, saved with its sound (params.js,
// "Effects"): how much it sends to the shared reverb and echo (see connect / setSends)
// and a chorus (class Chorus, below), which lives inside the instrument itself.

class FxBus {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.input = ctx.createGain();

    // Warmth
    this.drive = ctx.createWaveShaper();
    this.drive.oversample = "2x";
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.Q.value = 0.4;

    // Pulse: gain = 1 + depth × sine(rate)
    this.pulse = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 12;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth).connect(this.pulse.gain);
    this.lfo.start();

    // Tape wobble: a 15 ms delay moved by two slow sines (wow) and a fast one (flutter).
    // Changing a delay's length changes the pitch while it moves: that's the wobble.
    this.wobble = ctx.createDelay(0.1);
    this.wobble.delayTime.value = 0.015;
    this.wowDepth = ctx.createGain();
    this.flutterDepth = ctx.createGain();
    this.wowDepth.gain.value = 0; // a gain is 1 by default: a 1 s wobble, a huge "rewind"
    this.flutterDepth.gain.value = 0;
    for (const [rate, depth] of [[0.53, this.wowDepth], [0.21, this.wowDepth], [6.3, this.flutterDepth]]) {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      o.connect(depth);
      o.start();
    }
    this.wowDepth.connect(this.wobble.delayTime);
    this.flutterDepth.connect(this.wobble.delayTime);

    // Tape hiss: looped noise, only its highs, very low. Only while music plays
    // (setActive), otherwise it would hiss on its own after Stop.
    this.active = false;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    const noise = ctx.createBufferSource();
    noise.buffer = hissBuffer(ctx);
    noise.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "highpass";
    hissFilter.frequency.value = 3000;
    const hissTop = ctx.createBiquadFilter(); // no fizz above 7 kHz
    hissTop.type = "lowpass";
    hissTop.frequency.value = 7000;
    noise.connect(hissFilter).connect(hissTop).connect(this.hiss).connect(this.tone);
    noise.start();

    // Output level: the saturation no longer boosts the sound (see softClip), so the
    // level is made up here, after it, where it adds no distortion.
    this.out = ctx.createGain();
    this.out.gain.value = 1.8;

    this.input.connect(this.wobble).connect(this.drive).connect(this.tone).connect(this.pulse).connect(this.out).connect(destination);

    // Reverb: a short pre-delay (the first reflection arrives a bit late), then the room.
    this.reverbIn = ctx.createGain();
    const pre = ctx.createDelay(0.2);
    pre.delayTime.value = 0.03;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx, 5.5);
    this.reverbOut = ctx.createGain();
    this.reverbIn.connect(pre).connect(this.reverb).connect(this.reverbOut).connect(this.input);

    // Echo: left and right delays feeding each other (ping-pong).
    this.delayIn = ctx.createGain();
    this.delayL = ctx.createDelay(3);
    this.delayR = ctx.createDelay(3);
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2800;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.38;
    const left = ctx.createStereoPanner(), right = ctx.createStereoPanner();
    left.pan.value = -0.7;
    right.pan.value = 0.7;
    this.delayOut = ctx.createGain();
    this.delayIn.connect(this.delayL);
    this.delayL.connect(left).connect(this.delayOut);
    this.delayL.connect(damp).connect(this.delayR);
    this.delayR.connect(right).connect(this.delayOut);
    this.delayR.connect(this.feedback).connect(this.delayL);
    this.delayOut.connect(this.reverbIn); // echoes fade into the room
    this.delayOut.connect(this.input);

    this.warmth = 0.5;
    this.tape = 0;
    this.setWarmth(0.5);
    this.setReverb(0.35);
    this.setDelay(0.2);
    this.setDelayTime(0.6);
  }

  // An instrument's output sends some of its sound to the reverb and to the echo
  // (and the rest goes straight to `input`, connected by the caller).
  connect(source, reverb = 0.4, delay = 0.2) {
    const reverbSend = this.ctx.createGain(), delaySend = this.ctx.createGain();
    reverbSend.gain.value = reverb;
    delaySend.gain.value = delay;
    source.connect(reverbSend).connect(this.reverbIn);
    source.connect(delaySend).connect(this.delayIn);
    return { reverbSend, delaySend };
  }

  // Change the sends made by connect() (e.g. an instrument's sound was edited).
  setSends(sends, reverb, delay) {
    this.glide(sends.reverbSend.gain, reverb, 0.1);
    this.glide(sends.delaySend.gain, delay, 0.1);
  }

  // Move a setting smoothly while the sound runs (no clicks). While the audio is still
  // asleep (page just opened, Play not pressed yet) set it at once: a glide would
  // otherwise play out over the first notes, the filter opening, the echo sliding.
  glide(param, value, seconds) {
    const t = this.ctx.currentTime;
    if (this.ctx.state === "running") param.setTargetAtTime(value, t, seconds);
    else { param.cancelScheduledValues(0); param.setValueAtTime(value, t); }
  }

  // 0..1 controls.
  setReverb(v) { this.glide(this.reverbOut.gain, v * 1.6, 0.1); }
  setDelay(v) { this.glide(this.delayOut.gain, v * 1.2, 0.1); }
  setDelayTime(seconds) {
    this.glide(this.delayL.delayTime, seconds, 0.2);
    this.glide(this.delayR.delayTime, seconds, 0.2);
  }
  // 0 = bright and clean, 1 = dark and saturated.
  setWarmth(v) {
    this.warmth = v;
    this.updateTone();
  }

  // 0 = clean, 1 = a worn cassette: wobble up to ~15 cents, hiss, dull highs.
  setTape(v) {
    this.tape = v;
    // Pitch change of a moving delay ≈ 2π × rate × depth: 0.0022 s at 0.53 Hz ≈ 0.7 %.
    this.glide(this.wowDepth.gain, v * 0.0022, 0.2);
    this.glide(this.flutterDepth.gain, v * 0.00004, 0.2);
    this.updateHiss(0.2);
    this.updateTone();
  }

  // Music playing or not: the hiss comes in with it and fades out with the reverb tail.
  setActive(on) {
    this.active = on;
    this.updateHiss(on ? 0.2 : 1.5);
  }

  updateHiss(seconds) {
    // Squared: a little tape (Focus, Calm) gives almost no hiss, only a lot of it does.
    const tape = this.tape || 0;
    const level = this.active ? tape * tape * 0.02 : 0;
    this.glide(this.hiss.gain, level, seconds);
  }

  updateTone() {
    const v = Math.max(this.warmth, this.tape * 0.8);
    // A new curve only when it really changes: Focus music nudges the warmth slowly and
    // often (its drift), and swapping the curve for an identical one is wasted work.
    if (this.curveFor === undefined || Math.abs(v - this.curveFor) > 0.02) {
      this.drive.curve = softClip(1 + v * 1.5);
      this.curveFor = v;
    }
    const cutoff = Math.min(14000 - this.warmth * 10000, 12000 - this.tape * 8000);
    this.glide(this.tone.frequency, cutoff, 0.1);
  }

  // depth 0..1 (0.1–0.3 is plenty), rate in Hz.
  setPulse(depth, rate) {
    this.glide(this.lfoDepth.gain, depth * 0.5, 0.2);
    this.glide(this.lfo.frequency, rate, 0.2);
  }
}

// Chorus: the classic way to make one instrument sound like several playing together.
// The sound is copied into two very short delays (around 15 ms), one heard on the left,
// one on the right. A slow sine makes their length swing back and forth, which bends
// the pitch of the copy a tiny bit up, then down: mixed with the original, the copies
// beat against it and the sound gets wide and shimmering. The right side swings the
// other way (inverted sine), so left and right never match: that is the stereo.
//
//   input ─┬───────────────── dry ─────────────┬─► output
//          ├─► delay L ─► pan left ─┐          │
//          └─► delay R ─► pan right ┴─► wet ───┘
//                ▲ +sine   ▲ −sine
//
// Cheap on purpose (one oscillator, two delays, a few gains), so every instrument can
// have one even on a phone; a Synth only builds it when its chorus is above zero.
class Chorus {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0; // fades in from silence: switching it on does not click
    this.input.connect(this.dry).connect(this.output);

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.4; // one swing every 2.5 s: lush, not seasick
    const depthL = ctx.createGain(), depthR = ctx.createGain();
    depthL.gain.value = 0.0025;     // ±2.5 ms of delay ≈ ±0.6 % of pitch at its fastest
    depthR.gain.value = -0.0025;
    this.lfo.connect(depthL);
    this.lfo.connect(depthR);

    this.nodes = [this.lfo, depthL, depthR];
    for (const [side, depth, base] of [[-1, depthL, 0.013], [1, depthR, 0.017]]) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = base; // a gain added to it moves it around this value
      depth.connect(delay.delayTime);
      const pan = ctx.createStereoPanner();
      pan.pan.value = side * 0.9;
      this.input.connect(delay).connect(pan).connect(this.wet);
      this.nodes.push(delay, pan);
    }
    this.wet.connect(this.output);
    this.lfo.start();
  }

  // 0 = off (only the dry sound), 1 = thick. The dry sound dips a little as the copies
  // come in, so turning the chorus up widens the sound more than it makes it louder.
  set(amount) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(amount * 0.6, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - amount * 0.3, t, 0.05);
  }

  // Unplug everything and stop the oscillator (the chorus was turned back to zero).
  dispose() {
    this.lfo.stop();
    for (const n of [this.input, this.dry, this.wet, this.output, ...this.nodes]) n.disconnect();
  }
}

// A soft-clipping curve (tanh): straight in the middle, rounded towards the edges.
// Divided by `amount` so quiet sounds pass at their own level (gain 1) and only the
// peaks get rounded. (Dividing by tanh(amount) instead would boost everything by up
// to 3×, pushing whole chords into distortion: harsh, not warm.)
function softClip(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / amount;
  }
  return curve;
}

// A room's echo, made up: stereo noise that dies away over `seconds` and loses its
// highs as it goes (a one-pole low-pass whose cutoff falls with time).
function roomImpulse(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.round(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const smooth = 0.15 + 0.8 * k;                 // more smoothing later = darker tail
      low += (Math.random() * 2 - 1 - low) * (1 - smooth);
      d[i] = low * Math.pow(1 - k, 2.2);
    }
  }
  return buf;
}

// Two seconds of pink-ish noise for the tape hiss.
function hissBuffer(ctx) {
  const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < n; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 4 + (Math.random() * 2 - 1) * 0.3; }
  return buf;
}
