"use strict";

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "CQ_OFFSCREEN_BEEP") return;
  playBeep();
});

async function playBeep() {
  try {
    const AudioCtx = self.AudioContext || self.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") await ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(720, ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
  } catch (err) {
    console.warn("ChatGPT Queue: offscreen beep error", err);
  }
}
