/**
 * Procedural WebAudio sound effects — no audio assets needed. Each effect is
 * synthesized from filtered noise bursts or simple oscillators. World sounds
 * attenuate with distance from the listener.
 */
export type SoundName =
  | 'break_stone' | 'break_wood' | 'break_dirt' | 'place'
  | 'pickup' | 'eat' | 'hurt' | 'tool_break' | 'mob_hurt' | 'rain_patter';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  volume = 0.5;

  /** Lazily created on first user gesture (browser autoplay policy). */
  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master!.gain.value = this.volume;
    return this.ctx;
  }

  /** Filtered noise burst — the workhorse for break/place/step thuds. */
  private thud(freq: number, duration: number, gain: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuffer || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  /** Simple oscillator blip (pickup, hurt). */
  private blip(type: OscillatorType, from: number, to: number, duration: number, gain: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), ctx.currentTime + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(env).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  /** Play a named effect; `distance` (blocks) attenuates world sounds. */
  play(name: SoundName, distance = 0): void {
    const att = Math.max(0.05, 1 - distance / 24);
    switch (name) {
      case 'break_stone': this.thud(700, 0.22, 0.5 * att); break;
      case 'break_wood': this.thud(380, 0.25, 0.5 * att); break;
      case 'break_dirt': this.thud(250, 0.22, 0.45 * att); break;
      case 'place': this.thud(500, 0.12, 0.35 * att); break;
      case 'pickup': this.blip('sine', 500, 1000, 0.12, 0.25); break;
      case 'eat': this.thud(900, 0.08, 0.3); break;
      case 'hurt': this.blip('square', 320, 140, 0.2, 0.22); break;
      case 'mob_hurt': this.blip('square', 220, 110, 0.18, 0.18 * att); break;
      case 'tool_break': this.thud(1400, 0.3, 0.5); break;
      // Soft high-frequency tick, played repeatedly while raining — approximates
      // a patter without needing a true looping audio source.
      case 'rain_patter': this.thud(2200, 0.08, 0.06); break;
    }
  }
}
