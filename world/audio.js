function brownNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

const MASTER = 0.16;
const BED_FAR = 0.08;
const BED_NEAR = 0.26;
const SWELL_START = 0.3;
const WAVE_START = 0.5;
const CLOSE_LOW_M = 800;
const CLOSE_HIGH_M = 6_000;

const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.proximity = 0;
    this.waveLevel = 0;
    this.timer = null;
  }

  get running() { return this.on; }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      this.on = true;
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER;
    this.master.connect(ctx.destination);
    this.noise = brownNoise(ctx, 8);

    const bed = ctx.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 420;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = BED_FAR;
    bed.connect(bedFilter).connect(this.bedGain).connect(this.master);
    bed.start();

    const swell = ctx.createBufferSource();
    swell.buffer = this.noise;
    swell.loop = true;
    swell.playbackRate.value = 0.7;
    const swellFilter = ctx.createBiquadFilter();
    swellFilter.type = 'lowpass';
    swellFilter.frequency.value = 260;
    this.swellGain = ctx.createGain();
    this.swellGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 120;
    lfo.connect(depth).connect(swellFilter.frequency);
    lfo.start();
    swell.connect(swellFilter).connect(this.swellGain).connect(this.master);
    swell.start();

    this.on = true;
    this._scheduleWave();
  }

  stop() {
    this.on = false;
    this.ctx?.suspend();
  }

  _scheduleWave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.on && this.waveLevel > 0.02) this._wave();
      this._scheduleWave();
    }, 5500 + Math.random() * 5000);
  }

  _wave() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const rise = 2.5 + Math.random() * 1.5;
    const fall = 4.5 + Math.random() * 3;
    const peak = 0.55 * this.waveLevel * (0.7 + Math.random() * 0.3);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.4;
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(1400 + Math.random() * 700, t + rise);
    f.frequency.exponentialRampToValueAtTime(300, t + rise + fall);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + rise);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rise + fall);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.8;
    src.connect(f).connect(g).connect(pan).connect(this.master);
    src.start(t);
    src.stop(t + rise + fall + 0.2);
  }

  update({ proximity, altitude }) {
    if (!this.ctx || !this.on) return;
    this.proximity = proximity;
    const t = this.ctx.currentTime;
    const close = 1 - smooth(altitude, CLOSE_LOW_M, CLOSE_HIGH_M);
    const swell = Math.max(0, (proximity - SWELL_START) / (1 - SWELL_START)) * close;
    this.waveLevel = Math.max(0, (proximity - WAVE_START) / (1 - WAVE_START)) * close;
    this.swellGain.gain.setTargetAtTime(0.35 * swell, t, 1.5);
    this.bedGain.gain.setTargetAtTime(BED_FAR + (BED_NEAR - BED_FAR) * proximity, t, 1.5);
  }
}
