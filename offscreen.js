"use strict";

let audioCtx = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "CQ_OFFSCREEN_BEEP") return;
  playBeep();
});

async function getAudioContext() {
  const AudioCtx = self.AudioContext || self.webkitAudioContext;
  if (!AudioCtx) throw new Error("Web Audio unavailable");
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioCtx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}

async function tone(ctx, frequency, start, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

async function playBeep() {
  try {
    const ctx = await getAudioContext();
    const now = ctx.currentTime + 0.01;
    await tone(ctx, 740, now, 0.14, 0.16);
    await tone(ctx, 980, now + 0.16, 0.16, 0.13);
  } catch (err) {
    console.warn("ChatGPT Queue: offscreen beep error", err);
  }
}
