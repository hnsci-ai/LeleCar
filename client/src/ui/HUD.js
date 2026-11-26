export function formatTime(ms) {
  if (!ms || ms <= 0) return '--:--.--';
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function ordinalSuffix(n) {
  if (n === 1) return 'ST';
  if (n === 2) return 'ND';
  if (n === 3) return 'RD';
  return 'TH';
}

export class HUD {
  constructor() {
    this.elRaceHud = document.getElementById('race-hud');
    this.elPos = document.getElementById('hud-pos');
    this.elPosSuffix = document.getElementById('hud-pos-suffix');
    this.elTotalRacers = document.getElementById('hud-total-racers');
    this.elLap = document.getElementById('hud-lap');
    this.elLapsTotal = document.getElementById('hud-laps-total');
    this.elTime = document.getElementById('hud-time');
    this.elBest = document.getElementById('hud-best');
    this.elStandings = document.getElementById('hud-standings');
    this.elCountdown = document.getElementById('countdown-banner');
    this.elLaunchHint = document.getElementById('launch-hint');
    this.elSlipstream = document.getElementById('slipstream-badge');
    this.elEventToast = document.getElementById('event-toast');
    this.elWrongWay = document.getElementById('wrong-way-banner');
    this.toastTimer = null;
    this.elDriftBanner = document.getElementById('drift-banner');
    this.elDriftPoints = document.getElementById('drift-points');

    // Powertrain & handling telemetry elements
    this.elGear = document.getElementById('hud-gear');
    this.elTransTag = document.getElementById('hud-trans-tag');
    this.elSpeed = document.getElementById('hud-speed');
    this.elRpm = document.getElementById('hud-rpm');
    this.elTachoArc = document.getElementById('tacho-arc');
    this.elShiftLeds = Array.from(document.querySelectorAll('#hud-shift-lights .shift-led'));
    this.elThrottleFill = document.getElementById('hud-throttle-fill');
    this.elBrakeFill = document.getElementById('hud-brake-fill');
    this.elIndTcs = document.getElementById('ind-tcs');
    this.elIndAbs = document.getElementById('ind-abs');
    this.elIndSlip = document.getElementById('ind-slip');
    this.elGDot = document.getElementById('hud-g-dot');
    this.elNitroFill = document.getElementById('hud-nitro-fill');
    this.elVignette = document.getElementById('speed-vignette');

    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.minimapBounds = null;
  }

  setVisible(visible) {
    this.elRaceHud.classList.toggle('hidden', !visible);
  }

  setCountdown(text, showLaunchHint = false) {
    if (!text) {
      this.elCountdown.classList.add('hidden');
      this.elLaunchHint.classList.add('hidden');
    } else {
      this.elCountdown.textContent = text;
      this.elCountdown.classList.remove('hidden');
      this.elLaunchHint.classList.toggle('hidden', !showLaunchHint);
    }
  }

  showToast(text, durationMs = 1700) {
    if (!this.elEventToast) return;
    this.elEventToast.textContent = text;
    this.elEventToast.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.elEventToast.classList.add('hidden');
    }, durationMs);
  }

  prepareTrackMinimap(track) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      if (s.pos.x < minX) minX = s.pos.x;
      if (s.pos.x > maxX) maxX = s.pos.x;
      if (s.pos.z < minZ) minZ = s.pos.z;
      if (s.pos.z > maxZ) maxZ = s.pos.z;
    }
    const pad = 30;
    this.minimapBounds = {
      minX: minX - pad,
      maxX: maxX + pad,
      minZ: minZ - pad,
      maxZ: maxZ + pad
    };
  }

  updateTelemetry({ car, raceTimeMs, totalLaps, standings, myId, track, racers }) {
    // True realistic supercar km/h readout
    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    this.elSpeed.textContent = kmh;
    this.elGear.textContent = car.gear === 0 ? 'R' : String(car.gear);

    const nearRedline = car.shiftLightLevel > 0.82 || car.revLimiterActive;
    this.elGear.classList.toggle('redline', nearRedline);

    if (this.elTransTag) {
      this.elTransTag.textContent = car.transmissionMode || 'AT';
      this.elTransTag.classList.toggle('mt', car.transmissionMode === 'MT');
    }
    if (this.elRpm) {
      this.elRpm.textContent = Math.round(car.engineRpm || 1100);
    }

    // RPM arc (stroke-dasharray = 365)
    const arcLen = 365;
    const offset = arcLen * (1 - Math.min(1, Math.max(0, car.rpm)));
    this.elTachoArc.style.strokeDashoffset = offset.toFixed(1);
    this.elTachoArc.style.stroke = nearRedline ? '#ff1e6b' : (car.nitroActive ? '#ffb800' : '#00e5ff');

    // 8-LED F1/GT3 Progressive Shift Light Bar
    if (this.elShiftLeds.length > 0) {
      const level = car.shiftLightLevel || 0;
      const flashRed = (level >= 0.94 || car.revLimiterActive) && (Math.floor(performance.now() / 75) % 2 === 0);
      const litCount = Math.round(level * this.elShiftLeds.length);
      this.elShiftLeds.forEach((led, idx) => {
        led.className = 'shift-led';
        if (flashRed) {
          led.classList.add('on-red');
        } else if (idx < litCount) {
          if (idx < 3) led.classList.add('on-green');
          else if (idx < 6) led.classList.add('on-amber');
          else led.classList.add('on-red');
        }
      });
    }

    // Throttle / Brake pedal bars
    if (this.elThrottleFill) {
      this.elThrottleFill.style.width = `${Math.round((car.throttleInput || 0) * 100)}%`;
    }
    if (this.elBrakeFill) {
      this.elBrakeFill.style.width = `${Math.round((car.brakeInput || 0) * 100)}%`;
    }

    // TCS / ABS / Tire Slip warning pills
    if (this.elIndTcs) {
      this.elIndTcs.className = 'assist-pill';
      if (!car.tcsEnabled) this.elIndTcs.classList.add('off-dim');
      else if (car.tcsActive) this.elIndTcs.classList.add('active-amber');
    }
    if (this.elIndAbs) {
      this.elIndAbs.className = 'assist-pill';
      if (car.absActive) this.elIndAbs.classList.add('active-amber');
    }
    if (this.elIndSlip) {
      this.elIndSlip.className = 'assist-pill';
      const maxSlip = Math.max(car.rearSlip || 0, car.frontSlip || 0);
      if (maxSlip > 0.62 || car.drifting) this.elIndSlip.classList.add('active-red');
      else if (maxSlip > 0.40) this.elIndSlip.classList.add('active-amber');
    }

    // Mini G-Force Meter Dot (latG right/left, longG brake/accel)
    if (this.elGDot) {
      // Right turn => latG < 0 => inertia throws ball LEFT (-x); Left turn => latG > 0 => ball RIGHT (+x)
      const gx = Math.max(-1, Math.min(1, (car.latG || 0) / 1.9));
      // Braking => longG < 0 => ball UP (-y); Accel => longG > 0 => ball DOWN (+y)
      const gy = Math.max(-1, Math.min(1, (car.longG || 0) / 1.6));
      this.elGDot.style.left = `${50 + gx * 36}%`;
      this.elGDot.style.top = `${50 + gy * 36}%`;
    }

    // Nitro bar & speed vignette
    const nitroPct = (car.nitro / car.phys.nitroCapacity) * 100;
    this.elNitroFill.style.width = `${Math.min(100, Math.max(0, nitroPct))}%`;
    this.elVignette.style.opacity = car.nitroActive ? '0.92' : String(Math.max(0, (kmh - 235) / 190));

    // Lap & timers
    this.elLap.textContent = Math.min(car.lap, totalLaps);
    this.elLapsTotal.textContent = totalLaps;
    this.elTime.textContent = formatTime(raceTimeMs);
    this.elBest.textContent = formatTime(car.bestLap);

    // Warnings, Slipstream & Drift combo
    this.elWrongWay.classList.toggle('hidden', !car.wrongWay);
    this.elSlipstream.classList.toggle('hidden', !car.slipstreamActive);
    if (car.driftScore > 25) {
      this.elDriftBanner.classList.remove('hidden');
      this.elDriftPoints.textContent = `+${car.driftScore}`;
    } else {
      this.elDriftBanner.classList.add('hidden');
    }

    // Position & Standings
    const myRank = standings.findIndex((r) => r.id === myId) + 1;
    this.elPos.textContent = myRank || 1;
    this.elPosSuffix.textContent = ordinalSuffix(myRank || 1);
    this.elTotalRacers.textContent = standings.length;

    let html = '';
    standings.slice(0, 6).forEach((r, idx) => {
      html += `<div class="standing-row ${r.id === myId ? 'me' : ''}">
        <span>#${idx + 1} ${r.name}</span>
        <span>L${Math.min(r.lap, totalLaps)}</span>
      </div>`;
    });
    this.elStandings.innerHTML = html;

    // Minimap
    this._drawMinimap(track, racers, myId);
  }

  _drawMinimap(track, racers, myId) {
    if (!track || !this.minimapBounds) return;
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const b = this.minimapBounds;
    const scale = Math.min((w - 16) / (b.maxX - b.minX), (h - 16) / (b.maxZ - b.minZ));
    const offsetX = (w - (b.maxX - b.minX) * scale) / 2;
    const offsetY = (h - (b.maxZ - b.minZ) * scale) / 2;

    const toX = (x) => offsetX + (x - b.minX) * scale;
    const toY = (z) => offsetY + (z - b.minZ) * scale;

    ctx.clearRect(0, 0, w, h);

    // Track spline
    ctx.beginPath();
    track.samples.forEach((s, i) => {
      const px = toX(s.pos.x);
      const py = toY(s.pos.z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Start line dot
    const s0 = track.samples[0];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(toX(s0.pos.x) - 3, toY(s0.pos.z) - 3, 6, 6);

    // Racers
    for (const r of racers) {
      const px = toX(r.x);
      const py = toY(r.z);
      ctx.beginPath();
      ctx.arc(px, py, r.id === myId ? 5.2 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = r.id === myId ? '#00e5ff' : (r.isBot ? '#ffb800' : '#ff1e6b');
      ctx.fill();
      if (r.id === myId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}
