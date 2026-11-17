/**
 * Procedural 8-Bit Web Audio Synthesizer for Liar's Bar 2D (Online Web Version)
 * Includes SFX for:
 * - Deck Shuffle (xào bài)
 * - Key Card Flip Reveal (lật lá bài Key đầu ván)
 * - Card Deal Whoosh (tiếng phóng bài tới từng người chơi)
 * - Card Zoom & Drop (đánh bài)
 * - Single Card Flip (lật từng lá khi bắt bài)
 * - Cylinder Spin & Dry Tick (xoay ổ đạn & tiếng tích khi không có đạn)
 * - Gunshot & Avatar Shatter (bắn vỡ avatar)
 * - Miracle Dodge Jump ("Hú hồn, né được nhé!")
 */

export class PixelSoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensureContext() {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playTone(freq = 440, duration = 0.08, type = 'square', gainVal = 0.08, delay = 0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(gainVal, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  }

  playSweep(startFreq, endFreq, duration = 0.14, type = 'triangle', gainVal = 0.08, delay = 0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
    gain.gain.setValueAtTime(gainVal, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  }

  playNoise(duration = 0.15, gainVal = 0.15, filterFreq = 1200, delay = 0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(start);
    noise.stop(start + duration);
  }

  deckShuffle() {
    // Rapid riffle shuffle clicks
    for (let i = 0; i < 8; i += 1) {
      this.playNoise(0.04, 0.08, 2200, i * 0.09);
      this.playTone(260 + (i % 3) * 70, 0.035, 'triangle', 0.05, i * 0.09);
    }
  }

  keyCardReveal() {
    // Dramatic chord when the Key Card of the round flips up
    this.playTone(440, 0.12, 'square', 0.08, 0);
    this.playTone(554.37, 0.12, 'square', 0.08, 0.1);
    this.playTone(659.25, 0.24, 'square', 0.1, 0.2);
  }

  cardDealWhoosh(index = 0) {
    // Crisp whoosh sound as a card flies from deck to a player
    const base = 620 + (index % 4) * 55;
    this.playSweep(base, 220, 0.11, 'sine', 0.07, 0);
    this.playNoise(0.05, 0.06, 2600, 0.02);
  }

  cardSelect() {
    this.playTone(587.33, 0.05, 'square', 0.06, 0);
    this.playTone(880, 0.06, 'square', 0.05, 0.03);
  }

  cardPlay(count = 1) {
    for (let i = 0; i < count; i += 1) {
      this.playSweep(480, 210, 0.13, 'triangle', 0.08, i * 0.12);
      this.playNoise(0.06, 0.09, 1800, i * 0.12);
    }
  }

  cardFlip(isTruth = true) {
    this.playNoise(0.05, 0.08, 2400, 0);
    this.playTone(isTruth ? 783.99 : 233.08, 0.16, 'square', 0.09, 0.04);
  }

  callLiarSiren() {
    this.playTone(523.25, 0.14, 'sawtooth', 0.11, 0);
    this.playTone(392.0, 0.14, 'sawtooth', 0.11, 0.14);
    this.playTone(659.25, 0.22, 'square', 0.12, 0.28);
  }

  cylinderSpin() {
    for (let i = 0; i < 7; i += 1) {
      this.playTone(950 - i * 65, 0.035, 'square', 0.06, i * 0.075);
    }
  }

  revolverClick() {
    // Metallic dry tick ("TÍCH / CẠCH!") when chamber is empty
    this.playTone(1450, 0.022, 'square', 0.14, 0);
    this.playTone(620, 0.035, 'triangle', 0.1, 0.022);
  }

  revolverBang() {
    // Explosive 8-bit gunshot + shatter ("ĐOÀNG!")
    this.playNoise(0.48, 0.3, 950, 0);
    this.playTone(110, 0.38, 'sawtooth', 0.24, 0);
    this.playTone(65, 0.45, 'square', 0.22, 0.05);
    // Shatter glass/pixel fragments
    for (let i = 0; i < 4; i += 1) {
      this.playTone(1200 - i * 210, 0.06, 'square', 0.07, 0.18 + i * 0.06);
    }
  }

  dodgeJump() {
    // Gunshot + Mario/retro jump whoosh ("Hú hồn, né được nhé!")
    this.playNoise(0.22, 0.2, 1200, 0);
    this.playSweep(280, 920, 0.22, 'square', 0.11, 0.05);
    this.playTone(1046.5, 0.18, 'square', 0.1, 0.28);
  }

  victoryFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, 0.18, 'square', 0.09, idx * 0.13);
    });
  }
}
