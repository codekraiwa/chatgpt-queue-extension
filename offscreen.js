"use strict";

let audioCtx = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "CQ_OFFSCREEN_BEEP") return;
  playBeep(msg);
});

async function getAudioContext() {
  const AudioCtx = self.AudioContext || self.webkitAudioContext;
  if (!AudioCtx) throw new Error("Web Audio unavailable");
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioCtx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}

function tone(ctx, destination, frequency, start, duration, volume, type = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function pattern(preset, ctx, destination, start, volume) {
  if (preset === "soft") {
    tone(ctx, destination, 620, start, 0.18, volume * 0.7);
    return 0.24;
  }
  if (preset === "bell") {
    tone(ctx, destination, 880, start, 0.22, volume, "sine");
    tone(ctx, destination, 1320, start + 0.02, 0.28, volume * 0.45, "sine");
    return 0.38;
  }
  if (preset === "alert") {
    tone(ctx, destination, 760, start, 0.15, volume, "square");
    tone(ctx, destination, 1140, start, 0.15, volume * 0.8, "sawtooth");
    tone(ctx, destination, 760, start + 0.18, 0.15, volume, "square");
    tone(ctx, destination, 1140, start + 0.18, 0.15, volume * 0.8, "sawtooth");
    tone(ctx, destination, 980, start + 0.36, 0.20, volume, "square");
    tone(ctx, destination, 1470, start + 0.36, 0.20, volume * 0.72, "sawtooth");
    return 0.56;
  }
  if (preset === "alarm") {
    tone(ctx, destination, 700, start, 0.18, volume, "square");
    tone(ctx, destination, 1050, start, 0.18, volume * 0.85, "sawtooth");
    tone(ctx, destination, 700, start + 0.22, 0.18, volume, "square");
    tone(ctx, destination, 1050, start + 0.22, 0.18, volume * 0.85, "sawtooth");
    tone(ctx, destination, 840, start + 0.44, 0.24, volume, "square");
    tone(ctx, destination, 1260, start + 0.44, 0.24, volume * 0.85, "sawtooth");
    return 0.78;
  }
  // chime (default)
  tone(ctx, destination, 740, start, 0.14, volume, "sine");
  tone(ctx, destination, 980, start + 0.16, 0.16, volume * 0.82, "sine");
  return 0.38;
}

async function playBeep(msg = {}) {
  try {
    const ctx = await getAudioContext();
    const preset = ["soft", "chime", "bell", "alert", "alarm"].includes(msg.preset) ? msg.preset : "alarm";
    const volumePct = Math.max(10, Math.min(200, Number(msg.volume ?? 150)));
    const repeats = Math.max(1, Math.min(5, Number(msg.repeats || 2)));

    // Loud master chain: boost into a compressor/limiter so it is much more
    // noticeable without uncontrolled digital clipping.
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.gain.value = 1.35 * (volumePct / 100);
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    master.connect(compressor);
    compressor.connect(ctx.destination);

    const voiceLevel = preset === "soft" ? 0.18 : 0.72;
    let cursor = ctx.currentTime + 0.02;
    for (let i = 0; i < repeats; i++) {
      cursor += pattern(preset, ctx, master, cursor, voiceLevel) + 0.18;
    }
  } catch (err) {
    console.warn("ChatGPT Queue: offscreen beep error", err);
  }
}