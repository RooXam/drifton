// Touching a chord of the song opens a small card next to it: its chart (touch it to
// hear the chord), "Play from here", and a link to the chord's page in Chords.

// Frets as written in Chords' address: "x02210", or "x-10-12-12-11-10" above fret 9.
const fretText = (frets) => {
  const t = frets.map((f) => (f < 0 ? "x" : String(f)));
  return frets.some((f) => f > 9) ? t.join("-") : t.join("");
};

class ChordPopover {
  // actions: { hear(name), playFrom(chipElement) }
  constructor(actions) {
    this.actions = actions;
    this.el = document.createElement("div");
    this.el.className = "chord-pop";
    this.el.hidden = true;
    this.el.innerHTML = `<canvas title="Touch to hear it"></canvas>
      <div class="pop-side">
        <button class="pop-play">▶ Play from here</button>
        <a class="pop-open">Open in Chords →</a>
      </div>`;
    document.body.append(this.el);
    this.chart = new GuitarView(this.el.querySelector("canvas"));
    this.el.querySelector("canvas").addEventListener("click", () => this.actions.hear(this.name));
    this.el.querySelector(".pop-play").addEventListener("click", () => { const c = this.chip; this.close(); this.actions.playFrom(c); });
    // Close it: touch elsewhere, Esc.
    document.addEventListener("pointerdown", (e) => {
      if (!this.el.hidden && !this.el.contains(e.target) && e.target !== this.chip && !this.chip?.contains(e.target)) this.close();
    }, true);
    // The page scrolls (by hand or on its own): the card follows its chord.
    addEventListener("scroll", () => { if (!this.el.hidden) this.place(); }, true);
    addEventListener("resize", () => this.close());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
  }

  // chip: the element touched; name: the chord as shown; frets: the shape shown (or null).
  show(chip, name, frets) {
    if (this.chip === chip && !this.el.hidden) return this.close();
    this.chip = chip;
    this.name = name;
    // The link gives the chord as written on the sheet. With a capo the sheet is written
    // relative to the capo, i.e. the shape the guitarist actually fingers: that's what is
    // useful to look up (the sounding chord is only a different name for the same hand).
    // The frets go too, so Chords shows the very shape seen here.
    this.el.querySelector(".pop-open").href = `../chords/index.html?chord=${encodeURIComponent(name)}` +
      (frets ? `&frets=${encodeURIComponent(fretText(frets))}` : "");
    this.el.hidden = false;
    this.chart.show([{ name, frets }], 0);
    this.place();
  }

  // Under the chord, kept inside the screen (or above it near the bottom).
  place() {
    const r = this.chip.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return this.close();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    this.el.style.left = x + "px";
    this.el.style.top = y + "px";
  }

  close() {
    this.el.hidden = true;
    this.chip = null;
  }
}
