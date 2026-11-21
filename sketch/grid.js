// The session grid: one column per track, one row per scene, a clip (or nothing) in each
// slot. The column on the right launches a whole row; the last row stops a track.
//
// The grid is rebuilt from the project when it changes (render), and only its lights
// (playing, waiting, progress) are updated on every animation frame (frame).

class SessionGrid {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener("click", (e) => this.click(e));
  }

  render() {
    const { project, sel } = this.app;
    let html = "";
    // Header: track names.
    project.tracks.forEach((t, i) => {
      html += `<button class="th${sel.track === i ? " sel" : ""}" data-track="${i}" style="--c:var(--c-${t.id})">${t.name}</button>`;
    });
    html += `<span class="th scene-th">Scene</span>`;
    // Slots, row by row.
    for (let s = 0; s < SLOTS; s++) {
      project.tracks.forEach((t, i) => {
        const clip = t.clips[s];
        const selected = sel.track === i && sel.slot === s ? " sel" : "";
        if (!clip) {
          html += `<button class="cell empty${selected}" data-t="${i}" data-s="${s}" aria-label="${t.name}, slot ${s + 1}, empty"></button>`;
        } else {
          const label = escapeHtml(clip.name || `${clip.bars} bar${clip.bars > 1 ? "s" : ""}`);
          html += `<button class="cell clip${selected}" data-t="${i}" data-s="${s}" style="--c:var(--c-${t.id})" aria-label="${t.name}: ${label}">` +
            `<span class="cname">${label}</span><span class="bars">${clip.bars}</span><i class="prog"></i></button>`;
        }
      });
      const name = escapeHtml(project.scenes[s] || "");
      html += `<button class="scene" data-scene="${s}" aria-label="Launch scene ${s + 1}">` +
        `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span class="sname">${name || s + 1}</span><span class="snum">${s + 1}</span></button>`;
    }
    // Footer: stop buttons.
    project.tracks.forEach((t, i) => {
      html += `<button class="stop" data-stop="${i}" aria-label="Stop ${t.name}"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg></button>`;
    });
    html += `<button class="stop all" data-stop="all">Stop all</button>`;
    this.el.innerHTML = html;
    this.cells = [...this.el.querySelectorAll(".cell")];
    this.frame();
  }

  click(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const { app } = this;
    const tr = app.transport;
    if (b.dataset.track) app.select(+b.dataset.track, app.sel.slot);
    else if (b.dataset.scene) {
      const row = +b.dataset.scene;
      tr.launchScene(row);
      app.select(app.sel.track, row);
    } else if (b.dataset.stop) {
      if (b.dataset.stop === "all") tr.stopAll();
      else tr.stopTrack(+b.dataset.stop);
    } else if (b.dataset.t) {
      const t = +b.dataset.t, s = +b.dataset.s;
      if (app.project.tracks[t].clips[s] && app.tapMode === "launch") tr.launch(t, s);
      app.select(t, s);
    }
    app.refreshTransport();
    this.frame();
  }

  // Lights: what plays (with its progress), what waits for the next bar.
  frame() {
    const { transport: tr, ctx } = this.app;
    const heard = ctx.currentTime - (ctx.outputLatency || 0);
    for (const c of this.cells || []) {
      const t = +c.dataset.t, s = +c.dataset.s;
      const st = tr.tracks[t];
      const playing = tr.running && st.playing === s;
      c.classList.toggle("playing", playing);
      c.classList.toggle("queued", st.queued === s || (playing && st.queued !== null));
      c.classList.toggle("armed", this.app.recording && this.app.sel.track === t && this.app.sel.slot === s);
      if (playing) {
        const pos = tr.clipPos(t, heard);
        c.style.setProperty("--p", pos ? (pos.pos / pos.len).toFixed(3) : 0);
      }
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
