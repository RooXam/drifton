// Learn my tastes: a tiny "bandit" that learns, mood by mood, how you like the music.
//
// The vocabulary, for a data person:
// - What we tune: 5 offsets added to the mood's own settings, each between −1 and +1
//   (SCALE turns them into real units: +1 density = 15 % more bells, +1 tempo = 8 bpm…).
//   A point in this 5-D space is a "variant" of the mood.
// - Policy: a Gaussian. For each mood we keep a mean μ (our best guess of what you
//   like, starting at 0 = the mood as designed) and a width σ (how unsure we are).
//   The variant playing is a sample x = μ + σ·ε, with ε ~ N(0, 1) on each axis.
// - Reward: your feedback. Like = +1, Dislike = −1, Skip = −0.4 (a mild "not now").
// - Update: μ ← μ + lr · reward · (x − μ). A liked variant pulls the mean towards it,
//   a disliked one pushes it away. This is the policy-gradient (REINFORCE) step of a
//   Gaussian policy, the gradient of log N(x; μ, σ) being (x − μ) / σ², up to a constant;
//   evolution strategies do the same. Each vote also shrinks σ a little (down to a
//   floor): the more you have told us, the less we wander.
// - Exploration: after Dislike or Skip a new variant is drawn right away, around the
//   updated mean. After Like the variant stays: you like it, it keeps playing.
//
// Everything stays in this browser (localStorage), under its own key.

const TASTE_KEY = "drifton.focus.taste.v1";

// The axes, their size at ±1 and the words that describe them.
const TASTE_AXES = {
  density:  { scale: 0.15, more: "more bells",    less: "fewer bells" },
  movement: { scale: 0.2,  more: "more rhythm",   less: "stiller" },
  bright:   { scale: 0.15, more: "brighter",      less: "darker" },
  tempo:    { scale: 8,    more: "faster",        less: "slower" },
  reverb:   { scale: 0.15, more: "a bigger room", less: "drier" },
};
const TASTE_REWARD = { up: 1, down: -1, skip: -0.4 };
const TASTE_LR = 0.5;                       // learning rate: how far one vote moves μ
const SIGMA_START = 0.35, SIGMA_MIN = 0.12; // exploration width, at first and at least

class Taste {
  constructor() {
    this.moods = {};   // mood id → { mu: {axis: value}, sigma, votes }
    this.variant = {}; // mood id → the x playing now (not saved: a new one each visit)
    try { this.moods = JSON.parse(localStorage.getItem(TASTE_KEY)).moods || {}; } catch {}
  }

  // The learned state of a mood (created on first use).
  state(mood) {
    if (!this.moods[mood]) {
      this.moods[mood] = { mu: Object.fromEntries(Object.keys(TASTE_AXES).map((a) => [a, 0])), sigma: SIGMA_START, votes: 0 };
    }
    return this.moods[mood];
  }

  // Draw a new variant around the mean: x = μ + σ·ε, kept within −1..1.
  sample(mood) {
    const s = this.state(mood);
    const x = {};
    for (const a of Object.keys(TASTE_AXES)) x[a] = clamp1(s.mu[a] + s.sigma * gauss()); // gauss: session.js
    this.variant[mood] = x;
    return x;
  }

  // The offsets to apply now, in real units: { density: +0.03, tempo: −2.4, … }.
  offsets(mood) {
    const x = this.variant[mood] || this.sample(mood);
    return Object.fromEntries(Object.entries(TASTE_AXES).map(([a, axis]) => [a, x[a] * axis.scale]));
  }

  // A vote on what is playing: "up", "down" or "skip".
  vote(mood, kind) {
    const s = this.state(mood);
    const x = this.variant[mood] || this.sample(mood);
    const r = TASTE_REWARD[kind];
    for (const a of Object.keys(TASTE_AXES)) s.mu[a] = clamp1(s.mu[a] + TASTE_LR * r * (x[a] - s.mu[a]));
    s.sigma = Math.max(SIGMA_MIN, s.sigma * 0.9);
    s.votes++;
    if (kind !== "up") this.sample(mood);
    this.save();
  }

  // Forget everything learned, for every mood.
  forget() {
    this.moods = {};
    this.variant = {};
    try { localStorage.removeItem(TASTE_KEY); } catch {}
  }

  save() {
    try { localStorage.setItem(TASTE_KEY, JSON.stringify({ moods: this.moods })); } catch {}
  }

  // What we have learned, in words: "4 votes: fewer bells, darker."
  describe(mood) {
    const s = this.moods[mood];
    if (!s || !s.votes) return "";
    const words = Object.entries(TASTE_AXES)
      .filter(([a]) => Math.abs(s.mu[a]) >= 0.15) // smaller than that: no clear lean yet
      .map(([a, axis]) => (s.mu[a] > 0 ? axis.more : axis.less));
    return `${s.votes} vote${s.votes > 1 ? "s" : ""}: ${words.length ? words.join(", ") : "no clear lean yet"}.`;
  }
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}
