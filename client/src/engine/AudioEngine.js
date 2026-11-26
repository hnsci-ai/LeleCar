const ENGINE_PROFILES = {
  // Ferrari 458 Italia — 4.5L Flat-Plane NA V8 (high-pitched singing scream, crisp harmonics)
  v8_na: {
    baseHz: 46,
    spanHz: 185,
    harmonics: [1.0, 1.50, 2.004, 2.50],
    waves: ['sawtooth', 'sawtooth', 'sawtooth', 'triangle'],
    filterBase: 340,
    filterSpan: 2400,
    filterQ: 3.1,
    hasTurbo: false,
    shiftPopPitch: 175,
    shiftPopGain: 0.24
  },
  // Lamborghini Aventador — 6.5L NA V12 (soaring V12 choir + deep bass + heavy ISR shift bang)
  v12_na: {
    baseHz: 44,
    spanHz: 196,
    harmonics: [1.0, 1.50, 2.002, 3.005],
    waves: ['sawtooth', 'sawtooth', 'triangle', 'sawtooth'],
    filterBase: 310,
    filterSpan: 2550,
    filterQ: 3.4,
    hasTurbo: false,
    shiftPopPitch: 135,
    shiftPopGain: 0.30
  },
  // Porsche 911 GT3 RS — 4.0L NA Flat-6 (raw raspy mechanical boxer growl + razor-sharp PDK snap)
  flat6_na: {
    baseHz: 48,
    spanHz: 178,
    harmonics: [1.0, 1.334, 2.005, 2.668],
    waves: ['sawtooth', 'sawtooth', 'sawtooth', 'square'],
    filterBase: 380,
    filterSpan: 2350,
    filterQ: 2.6,
    hasTurbo: false,
    shiftPopPitch: 210,
    shiftPopGain: 0.22
  },
  // McLaren Senna — 4.0L Twin-Turbo V8 (muscular V8 growl + loud turbo spool + BOV flutter)
  v8_tt: {
    baseHz: 38,
    spanHz: 146,
    harmonics: [1.0, 1.252, 1.50, 2.004],
    waves: ['sawtooth', 'sawtooth', 'triangle', 'sawtooth'],
    filterBase: 270,
    filterSpan: 1950,
    filterQ: 2.3,
    hasTurbo: true,
    shiftPopPitch: 150,
    shiftPopGain: 0.26
  }
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.bgmEnabled = true;
    this.initialized = false;
    this.profile = ENGINE_PROFILES.v8_na;
    this.lastGear = 1;
    this.lastThrottle = 0;
    this.lastBoost = 0;
    this.bgmStep = 0;
    this.bgmTimer = null;
    this._limiterClock = 0;
  }

  setCarProfile(carConfig) {
    const key = carConfig?.physics?.engine?.soundProfile || 'v8_na';
    this.profile = ENGINE_PROFILES[key] || ENGINE_PROFILES.v8_na;
    this.lastGear = 1;
    this.lastThrottle = 0;
    this.lastBoost = 0;
    if (this.initialized && this.osc1) {
      this.osc1.type = this.profile.waves[0];
      this.osc2.type = this.profile.waves[1];
      this.osc3.type = this.profile.waves[2];
      this.osc4.type = this.profile.waves[3];
      this.engineFilter.Q.value = this.profile.filterQ;
    }
  }

  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.44;

    // Gentle dynamics compressor so engine + turbo + BGM + collisions punch cleanly without clipping
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 4;
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // 1. Multi-Harmonic Supercar Engine Synth (character shaped by active car profile)
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = this.profile.filterQ;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.osc1 = this.ctx.createOscillator();
    this.osc2 = this.ctx.createOscillator();
    this.osc3 = this.ctx.createOscillator();
    this.osc4 = this.ctx.createOscillator();
    this.subOsc = this.ctx.createOscillator();

    this.osc1.type = this.profile.waves[0];
    this.osc2.type = this.profile.waves[1];
    this.osc3.type = this.profile.waves[2];
    this.osc4.type = this.profile.waves[3];
    this.subOsc.type = 'triangle';

    // Harmonic mix weights so the 4th upper harmonic adds brilliance without harshness
    const g1 = this.ctx.createGain(); g1.gain.value = 0.34;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.28;
    const g3 = this.ctx.createGain(); g3.gain.value = 0.22;
    const g4 = this.ctx.createGain(); g4.gain.value = 0.14;
    const gSub = this.ctx.createGain(); gSub.gain.value = 0.36;

    this.osc1.connect(g1).connect(this.engineFilter);
    this.osc2.connect(g2).connect(this.engineFilter);
    this.osc3.connect(g3).connect(this.engineFilter);
    this.osc4.connect(g4).connect(this.engineFilter);
    this.subOsc.connect(gSub).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.osc1.start();
    this.osc2.start();
    this.osc3.start();
    this.osc4.start();
    this.subOsc.start();

    // 2. Twin-Turbo Spool Whine (only active on turbocharged cars like McLaren Senna, or Nitro)
    this.turboOsc = this.ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 1500;
    this.turboGain = this.ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.masterGain);
    this.turboOsc.start();

    // 3. Shared Noise Buffer for Tire Scrub/Squeal, Nitro Afterburner, Wind Rush & Kerbs
    const bufSize = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    // Progressive Tire Scrub & Drift Howl bandpass
    this.screechSrc = this.ctx.createBufferSource();
    this.screechSrc.buffer = this.noiseBuffer;
    this.screechSrc.loop = true;
    this.screechFilter = this.ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1350;
    this.screechFilter.Q.value = 5.4;
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    this.screechSrc.connect(this.screechFilter);
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.masterGain);
    this.screechSrc.start();

    // Apex Kerb Rumble channel (rhythmic low thrum when clipping painted kerbs!)
    this.kerbOsc = this.ctx.createOscillator();
    this.kerbOsc.type = 'triangle';
    this.kerbOsc.frequency.value = 38;
    this.kerbGain = this.ctx.createGain();
    this.kerbGain.gain.value = 0;
    this.kerbOsc.connect(this.kerbGain);
    this.kerbGain.connect(this.masterGain);
    this.kerbOsc.start();

    // Nitro roar bandpass
    this.nitroSrc = this.ctx.createBufferSource();
    this.nitroSrc.buffer = this.noiseBuffer;
    this.nitroSrc.loop = true;
    this.nitroFilter = this.ctx.createBiquadFilter();
    this.nitroFilter.type = 'bandpass';
    this.nitroFilter.frequency.value = 460;
    this.nitroFilter.Q.value = 1.2;
    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 0;
    this.nitroSrc.connect(this.nitroFilter);
    this.nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.masterGain);
    this.nitroSrc.start();

    // Aerodynamic Wind Rush & Road Hum at high speed (>130 km/h)
    this.windSrc = this.ctx.createBufferSource();
    this.windSrc.buffer = this.noiseBuffer;
    this.windSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 260;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.windSrc.start();

    this.initialized = true;
    this._startRacingBgm();
  }

  _startRacingBgm() {
    if (this.bgmTimer) clearInterval(this.bgmTimer);
    // 132 BPM Gran Turismo / Wangan Midnight electronic bassline + crisp hi-hat groove
    const bassNotes = [55, 55, 65.41, 55, 73.42, 55, 65.41, 49, 43.65, 43.65, 55, 49, 65.41, 55, 49, 55];
    this.bgmTimer = setInterval(() => {
      if (!this.initialized || this.muted || !this.bgmEnabled || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const step = this.bgmStep++;
      const freq = bassNotes[step % bassNotes.length];

      // Driving synth bass
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filt = this.ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(step % 4 === 0 ? 520 : 340, now);
      filt.frequency.exponentialRampToValueAtTime(95, now + 0.18);
      gain.gain.setValueAtTime(0.052, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.21);

      // Subtle off-beat crisp hi-hat tick
      if (step % 2 === 1 && this.noiseBuffer) {
        const hat = this.ctx.createBufferSource();
        hat.buffer = this.noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7200;
        const hg = this.ctx.createGain();
        hg.gain.setValueAtTime(0.016, now);
        hg.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        hat.connect(hp);
        hp.connect(hg);
        hg.connect(this.masterGain);
        hat.start(now);
        hat.stop(now + 0.05);
      }
    }, 227);
  }

  updateEngine({
    active,
    rpm = 0,
    speed = 0,
    gear = 1,
    drifting = false,
    nitro = false,
    slipstream = false,
    throttle = 0,
    slipIntensity = 0,
    turboBoost = 0,
    kerbRumble = 0,
    shiftCut = false,
    revLimiter = false,
    justUpshifted = false,
    justDownshifted = false
  }) {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (!active || this.muted) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.turboGain.gain.setTargetAtTime(0, now, 0.06);
      this.screechGain.gain.setTargetAtTime(0, now, 0.06);
      this.kerbGain.gain.setTargetAtTime(0, now, 0.05);
      this.nitroGain.gain.setTargetAtTime(0, now, 0.06);
      this.windGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    const prof = this.profile;
    const absSpd = Math.abs(speed);

    // Upshift exhaust crack + turbo BOV (for turbo cars); Downshift rev-match bark!
    if ((justUpshifted || (gear > this.lastGear && this.lastGear >= 1)) && absSpd > 10) {
      this.playShiftPop();
      if (prof.hasTurbo) this.playTurboBOV(1.0);
    } else if ((justDownshifted || (gear < this.lastGear && gear >= 1)) && absSpd > 12) {
      this.playDownshiftBlip();
    } else if (prof.hasTurbo && this.lastThrottle > 0.55 && throttle < 0.12 && this.lastBoost > 0.35) {
      // Lift-off wastegate / BOV flutter on twin-turbo cars!
      this.playTurboBOV(0.72);
    }
    this.lastGear = gear;
    this.lastThrottle = throttle;
    this.lastBoost = turboBoost;

    // Authentic RPM-only frequency (NO fake gear pitch offset — real RPM drops on shift!)
    const baseFreq = prof.baseHz + rpm * prof.spanHz + (nitro ? 14 : 0);
    const tc = shiftCut ? 0.022 : 0.032;
    this.osc1.frequency.setTargetAtTime(baseFreq * prof.harmonics[0], now, tc);
    this.osc2.frequency.setTargetAtTime(baseFreq * prof.harmonics[1], now, tc);
    this.osc3.frequency.setTargetAtTime(baseFreq * prof.harmonics[2], now, tc);
    this.osc4.frequency.setTargetAtTime(baseFreq * prof.harmonics[3], now, tc);
    this.subOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, tc);

    // Load-dependent intake/exhaust brightness + crisp torque-cut dip during DCT shifts
    const loadMult = 0.62 + throttle * 0.52;
    const filterCutoff = (prof.filterBase + rpm * prof.filterSpan) * loadMult + (nitro ? 650 : 0);
    this.engineFilter.frequency.setTargetAtTime(shiftCut ? filterCutoff * 0.55 : filterCutoff, now, 0.035);

    // Rapid fuel-cut pulse on rev limiter bounce
    let limiterDip = 1.0;
    if (revLimiter) {
      this._limiterClock += 1;
      limiterDip = (this._limiterClock % 4 < 2) ? 0.35 : 1.12;
    }

    const rawEngineVol = (0.12 + rpm * 0.12 + throttle * 0.045) * (shiftCut ? 0.58 : 1.0) * limiterDip;
    this.engineGain.gain.setTargetAtTime(rawEngineVol, now, 0.03);

    // Turbo spool whine (prominent on McLaren Senna, subtle whine on Nitro boost)
    const spool = prof.hasTurbo ? turboBoost : (nitro ? 0.45 : 0);
    this.turboOsc.frequency.setTargetAtTime(1600 + spool * 3200 + rpm * 950, now, 0.05);
    this.turboGain.gain.setTargetAtTime(spool > 0.08 ? (0.008 + spool * 0.028) : 0, now, 0.06);

    // Continuous progressive tire scrub / drift howl proportional to real slip intensity!
    const effSlip = Math.max(slipIntensity, drifting ? 0.72 : 0);
    const speedFactor = Math.min(1, Math.max(0, (absSpd - 6) / 24));
    const screechAmt = effSlip > 0.28 ? ((effSlip - 0.28) / 0.72) * speedFactor : 0;
    this.screechFilter.frequency.setTargetAtTime(1120 + screechAmt * 780 + Math.min(320, absSpd * 4.5), now, 0.05);
    this.screechFilter.Q.setTargetAtTime(3.6 + screechAmt * 3.8, now, 0.05);
    this.screechGain.gain.setTargetAtTime(screechAmt * 0.135, now, 0.045);

    // Apex Kerb tactile rhythmic rumble
    const kerbAmt = kerbRumble > 0.05 && absSpd > 5 ? kerbRumble : 0;
    this.kerbOsc.frequency.setTargetAtTime(28 + Math.min(55, absSpd * 0.72), now, 0.04);
    this.kerbGain.gain.setTargetAtTime(kerbAmt * 0.11, now, 0.035);

    // Nitro afterburner
    const targetNitro = nitro ? 0.18 : 0;
    this.nitroGain.gain.setTargetAtTime(targetNitro, now, 0.05);

    // Aerodynamic wind rush scales smoothly with speed & slipstream
    const windAmt = Math.max(0, (absSpd - 34) / 76) * (slipstream ? 0.16 : 0.105);
    this.windFilter.frequency.setTargetAtTime(220 + absSpd * 8.5 + (slipstream ? 380 : 0), now, 0.08);
    this.windGain.gain.setTargetAtTime(Math.min(0.18, windAmt), now, 0.08);
  }

  playShiftPop() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(this.profile.shiftPopPitch, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.075);
    gain.gain.setValueAtTime(this.profile.shiftPopGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.088);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.095);

    // Subtle crisp exhaust snap transient
    if (this.noiseBuffer) {
      const snap = this.ctx.createBufferSource();
      snap.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 950;
      bp.Q.value = 1.6;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.08, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      snap.connect(bp).connect(ng).connect(this.masterGain);
      snap.start(now);
      snap.stop(now + 0.06);
    }
  }

  playDownshiftBlip() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    // Crisp rev-match exhaust bark + tiny overrun crackle pop
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(195, now + 0.045);
    osc.frequency.exponentialRampToValueAtTime(88, now + 0.13);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 680;
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);

    if (this.noiseBuffer) {
      const pop = this.ctx.createBufferSource();
      pop.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 740;
      bp.Q.value = 2.0;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.07, now + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      pop.connect(bp).connect(ng).connect(this.masterGain);
      pop.start(now + 0.03);
      pop.stop(now + 0.10);
    }
  }

  playTurboBOV(scale = 1.0) {
    if (!this.initialized || this.muted || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3600, now);
    bp.frequency.exponentialRampToValueAtTime(1150, now + 0.17);
    bp.Q.value = 3.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.095 * scale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.19);
  }

  playBoostSurge() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.24);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.29);
  }

  playOvertakeChime() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    [587.33, 880].forEach((f, idx) => {
      const t = now + idx * 0.06;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  playCollision(intensity = 0.5) {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.19);
    gain.gain.setValueAtTime(Math.min(0.45, 0.18 + intensity * 0.35), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  playCountdownBeep(isGo = false) {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.45 : 0.22));
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.46 : 0.24));
  }

  playLapChime() {
    if (!this.initialized || this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, idx) => {
      const now = this.ctx.currentTime + idx * 0.075;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.27);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.44, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  toggleBgm() {
    this.bgmEnabled = !this.bgmEnabled;
    return this.bgmEnabled;
  }
}
