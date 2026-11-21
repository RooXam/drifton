// Metronome clicks: a short, dry tick on every beat, higher on the first beat of a bar.
// The player (player.js) tells it when, at exact audio-clock times, like the notes.

class Click {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.6;
    this.out.connect(ctx.destination);
    this.pending = []; // clicks scheduled and not yet heard: cancelled on pause / seek
  }

  setVolume(v) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // A click at audio time t. accent: the first beat of a bar.
  play(t, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = accent ? 1760 : 1175; // A6, D6
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.06);
    osc.onended = () => g.disconnect();
    this.pending = this.pending.filter((p) => p.t > ctx.currentTime);
    this.pending.push({ t, osc });
  }

  // Silence the clicks still to come.
  stopAll() {
    const now = this.ctx.currentTime;
    for (const p of this.pending) try { p.osc.stop(now); } catch {}
    this.pending = [];
  }
}
