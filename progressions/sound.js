// Two sounds to hear the progressions:
// - "piano": the light keys of the score player (../score/piano.js), clear for learning;
// - "pad": the synth's Pad and Bass, i.e. the sounds you shaped on the synth page.
// Both play notes scheduled at an exact audio time `t`, for `length` seconds.

class ChordSound {
  constructor(ctx) {
    this.ctx = ctx;
    this.kind = "piano";
    this.volume = 0.8;
    this.piano = new PianoSound(ctx);
    this.synths = null; // created the first time the pad is chosen
  }

  setKind(kind) {
    this.stopAll();
    this.kind = kind;
    if (kind === "pad" && !this.synths) {
      this.master = new MasterBus(this.ctx);
      this.master.input.gain.value = this.volume;
      this.synths = {
        chord: new Synth(this.ctx, { ...currentPatch("Pad"), volume: 0.7 }, this.master.input),
        bass: new Synth(this.ctx, { ...currentPatch("Bass"), volume: 0.6 }, this.master.input),
      };
      this.synths.chord.maxVoices = 24; // the next chord is scheduled before this one ends
      // The synth page is open in another tab and a sound changed: follow it.
      PatchStore.onChange(() => {
        this.synths.chord.loadPatch({ ...currentPatch("Pad"), volume: 0.7 });
        this.synths.bass.loadPatch({ ...currentPatch("Bass"), volume: 0.6 });
      });
    }
  }

  setVolume(v) {
    this.volume = v;
    this.piano.setVolume(v);
    if (this.master) setParam(this.ctx, this.master.input.gain, v, true);
  }

  // role: "chord" or "bass"
  note(pitch, velocity, t, length, role) {
    if (this.kind === "piano") {
      this.piano.play(pitch, velocity * (role === "bass" ? 0.8 : 1), t, length);
    } else {
      const s = this.synths[role];
      s.noteOn(pitch, velocity, t);
      s.noteOff(pitch, t + length);
    }
  }

  // Silence now, including notes already scheduled for the next instants.
  stopAll() {
    this.piano.stopAll();
    if (!this.synths) return;
    const now = this.ctx.currentTime;
    for (const s of Object.values(this.synths)) {
      for (const v of [...s.voices]) v.kill(now);
      s.held.clear();
    }
  }
}
