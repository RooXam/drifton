// One AudioContext per page, set up the way iPhones and iPads need. Every page uses it.
//
// Two traps on iOS:
// 1. The silent switch mutes web audio. Safari 17+ lets a page say "I'm a player"
//    (navigator.audioSession.type = "playback"); older versions are fooled by playing a
//    silent <audio> loop, which switches the page into "media playback" mode too.
// 2. Sound may only start in reaction to a gesture, and for Safari a gesture is the END
//    of a touch (touchend, click), not its start (pointerdown, touchstart). So we resume
//    the audio on those events, and play a tiny silent sound in them (older iOS needs it).
// Coming back to the tab (or after a phone call) the audio may be suspended: resume it.

function createAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  const isApple = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let media = null;

  function unlock() {
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {}
    // Older iOS, no audioSession: the silent <audio> loop gets past the silent switch.
    if (isApple && !navigator.audioSession && !media) {
      media = document.createElement("audio");
      media.setAttribute("playsinline", "");
      media.loop = true;
      media.src = silentWav();
      media.play().catch(() => (media = null));
    }
  }
  for (const ev of ["touchend", "click", "keydown"]) document.addEventListener(ev, unlock, { capture: true, passive: true });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx.state !== "running") ctx.resume().catch(() => {});
  });
  return ctx;
}

// Half a second of silence as a WAV file (44-byte header + zeros), in memory.
function silentWav() {
  const rate = 8000, n = rate / 2;
  const b = new DataView(new ArrayBuffer(44 + n));
  const text = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF"); b.setUint32(4, 36 + n, true); text(8, "WAVE");
  text(12, "fmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
  text(36, "data"); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128); // 8-bit audio: 128 is silence
  return URL.createObjectURL(new Blob([b.buffer], { type: "audio/wav" }));
}
