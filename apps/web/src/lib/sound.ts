/**
 * A short synthesized confirmation tone for a successful barcode scan. Synthesized
 * via the Web Audio API rather than an audio file — no asset to bundle or fetch, and
 * it fires instantly rather than waiting on a network round trip the first time it
 * plays. Reused across calls via one lazily-created AudioContext, matching how
 * browsers expect this API to be used (creating one per beep works but is wasteful
 * and some browsers cap how many can exist at once).
 */
let ctx: AudioContext | null = null;

export function playScanBeep() {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    ctx ??= new AudioCtor();

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1000;
    // Quick attack, exponential decay — a "blip", not a tone that lingers over the
    // next keystroke. exponentialRamp can't target exactly 0, hence 0.0001.
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Best-effort — a missing beep (blocked autoplay, no Web Audio support) is a
    // minor inconvenience, not worth interrupting a scan-heavy billing flow over.
  }
}
