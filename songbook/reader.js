// Reading while playing: the page scrolls on its own at a chosen speed (independent of
// the playback), and a full-screen mode shows only the chords, big.
//
// - AutoScroll: moves the page (or the full-screen box) a few pixels per frame. A finger
//   on the screen, the mouse wheel, pauses it; it starts again 1.5 s after.
// - Reading mode: the box of the song becomes a layer over the whole page (CSS, works
//   everywhere, also on iPhone where Safari has no full screen for pages), and the real
//   full screen is asked for where the browser has it (computers, Android, iPad).

class AutoScroll {
  constructor(onEnd) {
    this.on = false;
    this.speed = 4;        // 1..10
    this.box = null;       // the element scrolled; null = the page
    this.touching = false;
    this.pausedUntil = 0;
    this.pos = null;       // where we are, with the fractions of pixels the browser rounds off
    this.onEnd = onEnd;    // reached the bottom: it switches itself off

    const hold = () => { this.touching = true; };
    const release = () => { this.touching = false; this.pausedUntil = performance.now() + 1500; };
    addEventListener("touchstart", hold, { passive: true });
    addEventListener("touchend", release, { passive: true });
    addEventListener("touchcancel", release, { passive: true });
    addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") hold(); });
    addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") release(); });
    addEventListener("wheel", () => { this.pausedUntil = performance.now() + 1500; }, { passive: true });
  }

  get el() { return this.box || document.scrollingElement || document.documentElement; }

  // Pixels per second for the speed chosen: slow steps at the bottom, faster at the top.
  get pxPerSecond() { return 4 * this.speed + this.speed * this.speed; }

  set(on) {
    this.on = on;
    this.pos = null;
    if (on && !this.raf) {
      let last = performance.now();
      const loop = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!this.on) { this.raf = null; return; }
        this.step(dt, now);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }

  step(dt, now) {
    const el = this.el;
    // Paused, or moved by hand (or by "scroll to the chord playing"): start again from there.
    if (this.touching || now < this.pausedUntil) { this.pos = null; return; }
    if (this.pos === null || Math.abs(el.scrollTop - this.pos) > 2) this.pos = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    if (this.pos >= max - 1) { this.set(false); if (this.onEnd) this.onEnd(); return; }
    this.pos = Math.min(max, this.pos + this.pxPerSecond * dt);
    el.scrollTop = this.pos;
  }
}

// Full-screen reading of an element (`box`). `onChange(on)` is told when it opens or closes
// (also when the browser leaves full screen by itself, with Esc).
class ReadingMode {
  constructor(box, onChange) {
    this.box = box;
    this.on = false;
    this.onChange = onChange;
    const fsChange = () => { if (!this.fullscreenElement() && this.on && this.wentFull) this.close(); };
    document.addEventListener("fullscreenchange", fsChange);
    document.addEventListener("webkitfullscreenchange", fsChange);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.on) this.close(); });
  }

  fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

  open() {
    if (this.on) return;
    this.on = true;
    this.wentFull = false;
    this.box.classList.add("reading");
    document.body.classList.add("reading-open"); // the page under it stops scrolling
    // The real full screen, if the browser has it (not on iPhone: the layer is enough there).
    const root = document.documentElement;
    const ask = root.requestFullscreen || root.webkitRequestFullscreen;
    if (ask) {
      try {
        const p = ask.call(root);
        if (p && p.then) p.then(() => (this.wentFull = true)).catch(() => {});
        else this.wentFull = true;
      } catch {}
    }
    this.box.scrollTop = 0;
    this.onChange(true);
  }

  close() {
    if (!this.on) return;
    this.on = false;
    this.box.classList.remove("reading");
    document.body.classList.remove("reading-open");
    if (this.fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); } catch {}
    }
    this.onChange(false);
  }

  toggle() { if (this.on) this.close(); else this.open(); }
}
