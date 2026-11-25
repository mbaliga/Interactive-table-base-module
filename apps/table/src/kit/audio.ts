/* Tiny synthesised UI sounds: no audio files to ship. The kiosk starts Chrome with autoplay allowed; in a normal browser the
   first touch unlocks audio. */
let ctx: AudioContext | null = null;
export const sound = { on: true };

export function unlockAudio(): void {
  if (!ctx) { try { ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { /* no audio */ } }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function beep(freq = 880, seconds = 0.08, volume = 0.03): void {
  if (!sound.on || !ctx) return;
  try {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + seconds + 0.02);
  } catch { /* ignore */ }
}
