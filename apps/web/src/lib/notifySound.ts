/**
 * A short two-note chime for a genuinely new clinic-sourced prescription arriving — audible
 * even when a pharmacist isn't looking at the screen (busy at the counter, a different tab
 * focused). Synthesized with the Web Audio API rather than shipping an audio file: no asset
 * to bundle, license, or go stale, and the whole thing is a dozen lines.
 *
 * Cheap alternative to a real push channel (WebSocket/SSE) — see the "faster new-Rx signal"
 * item this backs. Escalate to push only if polling + this still isn't responsive enough.
 */
let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  // Browsers refuse to start audio before a user gesture — first arrival on a fresh tab
  // load may be silent, which is fine (every one after it, and every reload once the
  // pharmacist has clicked anything, plays normally).
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(context: AudioContext, frequency: number, startAt: number, duration: number) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  // Ramp rather than a hard stop — an abrupt cutoff clicks.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

export function playArrivalChime() {
  const context = audioContext();
  if (!context) return;
  const now = context.currentTime;
  tone(context, 880, now, 0.12);
  tone(context, 1174.66, now + 0.1, 0.16);
}
