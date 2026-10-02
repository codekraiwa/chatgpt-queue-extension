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
    tone(ctx, destination, 720, start, 0.11, volume * 0.55, "sine");
    return 0.14;
  }
  if (preset === "bell") {
    tone(ctx, destination, 980, start, 0.12, volume, "sine");
    tone(ctx, destination, 1480, start, 0.13, volume * 0.6, "sine");
    return 0.16;
  }
  if (preset === "alert") {
    // Very short, high-presence burst. Layered mids cut through laptop speakers.
    tone(ctx, destination, 880, start, 0.115, volume, "square");
    tone(ctx, destination, 1320, start, 0.115, volume * 0.92, "sawtooth");
    tone(ctx, destination, 1760, start, 0.10, volume * 0.72, "square");
    return 0.14;
  }
  if (preset === "alarm") {
    // Punch: one compact transient, not a long alarm.
    tone(ctx, destination, 740, start, 0.14, volume, "square");
    tone(ctx, destination, 1110, start, 0.14, volume, "sawtooth");
    tone(ctx, destination, 1480, start + 0.015, 0.12, volume * 0.82, "square");
    return 0.17;
  }
  // chime
  tone(ctx, destination, 820, start, 0.10, volume * 0.9, "sine");
  tone(ctx, destination, 1220, start + 0.055, 0.10, volume * 0.82, "sine");
  return 0.16;
}

async function playBeep(msg = {}) {
  try {
    const ctx = await getAudioContext();
    const preset = ["soft", "chime", "bell", "alert", "alarm"].includes(msg.preset) ? msg.preset : "alert";
    const volumePct = Math.max(10, Math.min(400, Number(msg.volume ?? 100)));
    const repeats = Math.max(1, Math.min(5, Number(msg.repeats || 1)));

    // Loud master chain: boost into a compressor/limiter so it is much more
    // noticeable without uncontrolled digital clipping.
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.gain.value = 2.5 * (volumePct / 100);
    compressor.threshold.value = -18;
    compressor.knee.value = 8;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.08;
    master.connect(compressor);
    compressor.connect(ctx.destination);

    const voiceLevel = preset === "soft" ? 0.22 : 1.0;
    let cursor = ctx.currentTime + 0.02;
    for (let i = 0; i < repeats; i++) {
      cursor += pattern(preset, ctx, master, cursor, voiceLevel) + 0.10;
    }
  } catch (err) {
    console.warn("Prompt & Leave, ChatGPT Queue: offscreen beep error", err);
  }
}