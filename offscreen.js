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

function tone(ctx, frequency, start, duration, volume, type = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function pattern(preset, ctx, start, volume) {
  if (preset === "soft") {
    tone(ctx, 620, start, 0.18, volume * 0.7);
    return 0.24;
  }
  if (preset === "bell") {
    tone(ctx, 880, start, 0.22, volume, "sine");
    tone(ctx, 1320, start + 0.02, 0.28, volume * 0.45, "sine");
    return 0.38;
  }
  if (preset === "alert") {
    tone(ctx, 880, start, 0.12, volume, "square");
    tone(ctx, 880, start + 0.17, 0.12, volume, "square");
    tone(ctx, 1040, start + 0.34, 0.16, volume, "square");
    return 0.56;
  }
  // chime (default)
  tone(ctx, 740, start, 0.14, volume, "sine");
  tone(ctx, 980, start + 0.16, 0.16, volume * 0.82, "sine");
  return 0.38;
}

async function playBeep(msg = {}) {
  try {
    const ctx = await getAudioContext();
    const preset = ["soft", "chime", "bell", "alert"].includes(msg.preset) ? msg.preset : "chime";
    const volumePct = Math.max(10, Math.min(100, Number(msg.volume ?? 70)));
    const repeats = Math.max(1, Math.min(3, Number(msg.repeats || 1)));
    const volume = 0.22 * (volumePct / 100);
    let cursor = ctx.currentTime + 0.02;
    for (let i = 0; i < repeats; i++) {
      cursor += pattern(preset, ctx, cursor, volume) + 0.22;
    }
  } catch (err) {
    console.warn("ChatGPT Queue: offscreen beep error", err);
  }
}