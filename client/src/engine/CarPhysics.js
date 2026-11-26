import * as THREE from 'three';

const GRAVITY = 9.81;
const PHYSICS_SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 6;
const RAD_TO_RPM = 60 / (Math.PI * 2);

/**
 * Simplified Pacejka Magic Formula normalized curve.
 * Peaked around u = 1.0, smoothly saturating to slideGripRatio at high slip angles
 * so breakaway is progressive, tactile, and catchable.
 */
function pacejkaNormalized(u, slideGripRatio = 0.86) {
  const absU = Math.abs(u);
  if (absU < 1e-4) return 0;
  const sign = u >= 0 ? 1 : -1;
  // Crisp initial build-up, peak at |u| ~= 1.0, smooth decay toward slideGripRatio
  const B = 1.52;
  const C = 1.36;
  const E = -0.35;
  const x = B * absU;
  const raw = Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
  if (absU <= 1.15) {
    return sign * raw;
  }
  // Smooth asymptotic plateau so huge drift angles remain controllable rather than collapsing
  const excess = absU - 1.15;
  const blend = Math.exp(-excess * 1.4);
  const val = slideGripRatio + (raw - slideGripRatio) * blend;
  return sign * Math.max(slideGripRatio * 0.92, val);
}

function sampleCurve(points, t) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  if (clamped <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (clamped <= x1) {
      const [x0, y0] = points[i - 1];
      const alpha = (clamped - x0) / Math.max(1e-5, x1 - x0);
      return y0 + (y1 - y0) * alpha;
    }
  }
  return points[points.length - 1][1];
}

export class CarController {
  constructor(carConfig, track, startTransform, isBot = false, botSkill = 0.92) {
    this.config = carConfig;
    this.phys = carConfig.physics;
    this.track = track;
    this.isBot = isBot;
    this.botSkill = botSkill;

    // Spatial kinematics
    this.position = startTransform.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = startTransform.yaw;
    this.yawRate = 0; // rad/s (+ = turning left)
    this.pitch = 0;

    // Core speed & driver state
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0; // velocity along car LEFT axis
    this.steer = 0;        // smoothed player steering input [-1..1] (+ = left)
    this.steerAngle = 0;   // physical front wheel angle (rad)
    this.visualSteer = 0;  // visual front wheel steer [-1..1] (includes counter-steer)
    this.throttleInput = 0;
    this.brakeInput = 0;

    // Slip, grip & chassis dynamics telemetry
    this.slipAngle = 0;     // actual angle between chassis heading & velocity (rad)
    this.driftAngle = 0;    // smoothed slip angle for HUD/network/visuals
    this.frontSlip = 0;     // 0..1 normalized front tire saturation
    this.rearSlip = 0;      // 0..1 normalized rear tire saturation
    this.wheelSpin = 0;     // 0..1 driven tire longitudinal wheelspin
    this.rearWheelSpeed = 0; // m/s equivalent tangential rear wheel spin speed
    this.frontWheelSpeed = 0;
    this.longG = 0;         // longitudinal G-force (+ accel, - brake)
    this.latG = 0;          // lateral G-force (+ left, - right)
    this._longAccelFilt = 0;
    this._latAccelFilt = 0;

    // Surface & suspension feedback
    this.surface = 'asphalt'; // 'asphalt' | 'kerb' | 'runoff'
    this.kerbRumble = 0;
    this.shiftKickPulse = 0;  // brief chassis pitch nod impulse on gear shifts

    // Drift & boost state
    this.drifting = false;
    this.driftDuration = 0;
    this.driftExitBoostTimer = 0;
    this.braking = false;
    this.handbraking = false;
    this.nitroActive = false;
    this.nitro = this.phys.nitroCapacity * 0.65;

    // Assist & Transmission settings
    this.transmissionMode = 'AT'; // 'AT' (Sport Auto) | 'MT' (Manual)
    this.tcsEnabled = true;       // Sport Traction Control (true = Sport TCS, false = OFF / Pro)
    this.tcsActive = false;
    this.absActive = false;

    // Authentic 7-Speed Powertrain State
    const eng = this.phys.engine;
    this.gear = 1; // 0 = R, 1..7 = forward
    this.engineRpm = eng.idleRpm;
    this.redlineRpm = eng.redlineRpm;
    this.rpm = 0.12; // normalized 0..1 (idle..redline)
    this.turboBoost = 0;
    this.shiftTimer = 0;          // remaining torque-cut duration on upshift
    this.downshiftBlipTimer = 0;  // rev-match throttle blip duration on downshift
    this.shiftCooldown = 0;
    this.manualHoldTimer = 0;     // temporary paddle override timer in AT mode
    this._reverseHoldTimer = 0;   // brief stop-hold before engaging Reverse in AT mode
    this.revLimiterActive = false;
    this._revBouncePhase = 0;
    this.shiftLightLevel = 0;     // 0..1 (0.75+ green/amber, 0.94+ red flash)

    // Event flags (reset every frame)
    this.slipstreamActive = false;
    this.justTriggeredDriftBoost = false;
    this.justUpshifted = false;
    this.justDownshifted = false;
    this.justSetBestLap = false;

    // Lap & progress tracking
    this.splineIndex = -1;
    this.trackT = startTransform.t;
    this.lap = 1;
    this.maxCheckpoint = 0;
    this.totalProgress = 0;
    this.wrongWay = false;
    this.finished = false;
    this.finishTime = 0;
    this.lapStartTime = 0;
    this.bestLap = 0;

    // Drift score feedback
    this.driftScore = 0;
    this.driftComboTimer = 0;

    // Collision feedback
    this.wallHitIntensity = 0;
    this.carHitIntensity = 0;

    // AI racing line & recovery state
    this.aiLaneOffset = (Math.random() - 0.5) * (track.halfWidth * 0.62);
    this.aiLaneTimer = 2.5 + Math.random() * 4.5;
    this._aiStuckTimer = 0;
  }

  toggleTransmissionMode() {
    this.transmissionMode = this.transmissionMode === 'AT' ? 'MT' : 'AT';
    this.manualHoldTimer = 0;
    return this.transmissionMode;
  }

  toggleTcs() {
    this.tcsEnabled = !this.tcsEnabled;
    return this.tcsEnabled;
  }

  shiftUp() {
    const maxGear = this.phys.transmission.gears.length;
    if (this.gear === 0) {
      if (this.forwardSpeed > -2.5) {
        this._engageGear(1, true);
      }
      return true;
    }
    if (this.gear < maxGear) {
      this._engageGear(this.gear + 1, true);
      if (this.transmissionMode === 'AT') this.manualHoldTimer = 1.8;
      return true;
    }
    return false;
  }

  shiftDown() {
    if (this.gear > 1) {
      const targetGear = this.gear - 1;
      const projectedRpm = this._computeGearRpm(Math.max(0, this.forwardSpeed), targetGear);
      // Over-rev protection (don't money-shift past 106% redline)
      if (projectedRpm <= this.phys.engine.redlineRpm * 1.06) {
        this._engageGear(targetGear, false);
        if (this.transmissionMode === 'AT') this.manualHoldTimer = 1.8;
        return true;
      }
      return false;
    }
    if (this.gear === 1 && this.forwardSpeed < 2.2) {
      this._engageGear(0, false);
      if (this.transmissionMode === 'AT') this.manualHoldTimer = 1.8;
      return true;
    }
    return false;
  }

  _engageGear(newGear, isUpshift) {
    if (newGear === this.gear) return;
    const prevGear = this.gear;
    this.gear = newGear;
    this.shiftCooldown = 0.24;

    if (isUpshift && newGear > prevGear && prevGear >= 1) {
      this.shiftTimer = this.phys.transmission.shiftTime;
      this.shiftKickPulse = this.phys.transmission.shiftKick;
      if (Math.abs(this.forwardSpeed) > 10) {
        this.justUpshifted = true;
      }
    } else if (!isUpshift && newGear >= 1 && newGear < prevGear) {
      // Crisp rev-match throttle blip on downshift!
      this.downshiftBlipTimer = 0.13;
      this.shiftTimer = this.phys.transmission.shiftTime * 0.55;
      if (Math.abs(this.forwardSpeed) > 12) {
        this.justDownshifted = true;
      }
    }
  }

  _computeGearRpm(wheelLinearSpeed, gear) {
    const trans = this.phys.transmission;
    const eng = this.phys.engine;
    const ratio = gear === 0
      ? trans.reverseRatio
      : trans.gears[Math.max(0, Math.min(trans.gears.length - 1, gear - 1))];
    const wheelRpm = (Math.abs(wheelLinearSpeed) / trans.wheelRadius) * RAD_TO_RPM;
    return Math.max(eng.idleRpm, wheelRpm * ratio * trans.finalDrive);
  }

  resetToTrack() {
    const proj = this.track.projectPoint(this.position, this.splineIndex);
    this.position.copy(proj.sample.pos);
    this.position.y += 0.45;
    this.yaw = Math.atan2(proj.sample.tangent.x, proj.sample.tangent.z);
    this.yawRate = 0;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAngle = 0;
    this.driftAngle = 0;
    this.frontSlip = 0;
    this.rearSlip = 0;
    this.wheelSpin = 0;
    this.gear = 1;
    this.engineRpm = this.phys.engine.idleRpm;
    this.rpm = 0.12;
  }

  /**
   * Called on GO! — if player held RPM in the launch sweet spot (55% - 86% of rev range)
   * during countdown, fires an authentic Launch Control burst with controlled wheelspin!
   */
  triggerPerfectLaunch() {
    if (this.rpm >= 0.54 && this.rpm <= 0.88) {
      const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const launchVel = this.phys.drivetrain === 'AWD' ? 21 : 18.5;
      this.velocity.addScaledVector(forward, launchVel);
      this.forwardSpeed = launchVel;
      this.wheelSpin = this.phys.drivetrain === 'AWD' ? 0.35 : 0.65;
      this.driftExitBoostTimer = 0.95;
      this.nitro = Math.min(this.phys.nitroCapacity, this.nitro + 18);
      return true;
    }
    return false;
  }

  applyExternalImpulse(ix, iz) {
    this.velocity.x += ix;
    this.velocity.z += iz;
    const hitMag = Math.hypot(ix, iz);
    this.carHitIntensity = Math.min(1, hitMag / 16);
    // Small realistic yaw perturbation from off-center contact
    const leftX = Math.cos(this.yaw);
    const leftZ = -Math.sin(this.yaw);
    const latImp = ix * leftX + iz * leftZ;
    this.yawRate += THREE.MathUtils.clamp(latImp * 0.04, -1.2, 1.2);
  }

  /**
   * Curvature-predictive racing AI tuned for the realistic bicycle/tire physics model.
   */
  _computeBotInput(dt, leadHumanProgress = null) {
    this.aiLaneTimer -= dt;
    if (this.aiLaneTimer <= 0) {
      this.aiLaneOffset = (Math.random() - 0.5) * (this.track.halfWidth * 0.66);
      this.aiLaneTimer = 2.4 + Math.random() * 4.2;
    }

    const absSpeed = Math.max(0, this.forwardSpeed);

    // Dynamic lookahead distance scales with speed for smooth, oscillation-free steering
    const lookAheadDist = THREE.MathUtils.clamp(14 + absSpeed * 0.44, 14, 52);
    const lookAheadT = (this.trackT + lookAheadDist / this.track.totalLength) % 1;
    const targetSample = this.track.getSampleAtProgress(lookAheadT);

    // Scan upcoming track curvature over 20m..155m to determine exact braking & corner entry speed!
    const totalLen = this.track.totalLength;
    const baseGrip = Math.min(this.phys.tires.frontGrip, this.phys.tires.rearGrip);
    const aeroFactor = (this.phys.aero.downforceFront + this.phys.aero.downforceRear) / this.phys.mass;

    // Gentle pack-battle pacing so races stay close and exciting
    let paceMod = 0.96;
    if (leadHumanProgress !== null) {
      const gap = this.totalProgress - leadHumanProgress;
      if (gap > 0.05) paceMod = 0.85;
      else if (gap < -0.055) paceMod = 1.05;
    }
    const effectiveSkill = THREE.MathUtils.clamp(this.botSkill * paceMod, 0.76, 1.03);
    const maxBrakeDecel = (this.phys.brakes.maxBrakeForce / this.phys.mass) * 0.78;

    let minTargetSpeed = this.phys.maxSpeed * effectiveSkill;
    let apexShift = 0;

    const scanDistances = [14, 28, 46, 70, 100, 136, 170];
    for (const d of scanDistances) {
      const tA = (this.trackT + (d - 6) / totalLen) % 1;
      const tB = (this.trackT + (d + 6) / totalLen) % 1;
      const tanA = this.track.getSampleAtProgress(tA).tangent;
      const tanB = this.track.getSampleAtProgress(tB).tangent;

      const dot = THREE.MathUtils.clamp(tanA.x * tanB.x + tanA.z * tanB.z, -1, 1);
      const dYaw = Math.acos(dot);
      const curvature = dYaw / 12; // tighter 12m chord catches sharp 22m hairpins accurately!
      if (curvature > 0.0022) {
        const radius = 1 / curvature;
        // Solve lateral accel balance: v^2/R = grip * (g + aero * v^2)
        const safetyGrip = baseGrip * 0.84 * effectiveSkill;
        const denom = Math.max(0.003, (1 / radius) - safetyGrip * aeroFactor);
        const cornerSpeed = Math.sqrt((safetyGrip * GRAVITY) / denom);

        // Required entry speed at current distance d given braking distance
        const vEntry = Math.sqrt(cornerSpeed * cornerSpeed + 2 * maxBrakeDecel * Math.max(0, d - 12));
        if (vEntry < minTargetSpeed) {
          minTargetSpeed = vEntry;
        }
        if (d <= 68 && apexShift === 0) {
          // Hug inside apex slightly on tighter turns!
          const crossY = tanA.x * tanB.z - tanA.z * tanB.x; // > 0 means turning right
          apexShift = (crossY > 0 ? 1 : -1) * Math.min(this.track.halfWidth * 0.44, curvature * 280);
        }
      }
    }

    const desiredLane = THREE.MathUtils.clamp(
      this.aiLaneOffset * 0.5 + apexShift,
      -(this.track.halfWidth - 3.2),
      this.track.halfWidth - 3.2
    );

    const targetPos = targetSample.pos.clone().addScaledVector(targetSample.right, desiredLane);
    const toTarget = targetPos.sub(this.position);
    const desiredYaw = Math.atan2(toTarget.x, toTarget.z);

    let angleDiff = desiredYaw - this.yaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Velocity-heading damped steering so AI enters and exits corners without fishtailing
    const steerGain = THREE.MathUtils.lerp(2.6, 4.2, Math.min(1, absSpeed / 70));
    const steer = THREE.MathUtils.clamp(angleDiff * steerGain - this.yawRate * 0.28, -1, 1);

    let throttle = 1.0;
    let brake = 0.0;

    if (absSpeed > minTargetSpeed + 2.5) {
      const overspeed = absSpeed - minTargetSpeed;
      brake = THREE.MathUtils.clamp(overspeed / 16, 0.2, 1.0);
      throttle = 0.0;
    } else if (absSpeed > minTargetSpeed - 3.0) {
      throttle = 0.55;
      brake = 0.0;
    } else {
      // Ease throttle slightly during heavy steering at high slip so AI doesn't wash out
      throttle = Math.abs(angleDiff) > 0.35 ? 0.72 : 1.0;
    }

    // Recovery if bot ever gets bumped sideways or slowed into wall
    if (absSpeed < 3.0 && this.totalProgress > 0.005) {
      this._aiStuckTimer += dt;
      if (this._aiStuckTimer > 2.2) {
        this.resetToTrack();
        this._aiStuckTimer = 0;
      }
    } else {
      this._aiStuckTimer = Math.max(0, this._aiStuckTimer - dt * 2);
    }

    const handbrake = false;
    const nitro = brake === 0 &&
      Math.abs(angleDiff) < 0.11 &&
      minTargetSpeed > 64 &&
      this.nitro > 42 &&
      absSpeed > 32;

    return { throttle, brake, steer, handbrake, nitro };
  }

  update(dt, input, canMove, raceTimeMs, totalLaps, extra = {}) {
    // Reset per-frame event pulses
    this.wallHitIntensity = 0;
    this.carHitIntensity = 0;
    this.justTriggeredDriftBoost = false;
    this.justUpshifted = false;
    this.justDownshifted = false;
    this.justSetBestLap = false;

    const eng = this.phys.engine;
    const trans = this.phys.transmission;
    const slipstream = Boolean(extra.slipstream && canMove && !this.finished);
    this.slipstreamActive = slipstream;

    // Countdown launch revving (authentic throttle response + redline bounce!)
    if (!canMove && !this.isBot && !this.finished && input) {
      const th = THREE.MathUtils.clamp(input.throttle || 0, 0, 1);
      this.throttleInput = th;
      this.brakeInput = input.brake || 0;
      this.gear = 1;

      const revAccel = th > 0.05 ? (11500 * th) : -6800;
      this.engineRpm = THREE.MathUtils.clamp(
        this.engineRpm + revAccel * dt,
        eng.idleRpm,
        eng.redlineRpm
      );
      if (this.engineRpm >= eng.redlineRpm - 40 && th > 0.1) {
        this._revBouncePhase += dt * 42;
        this.revLimiterActive = true;
        this.engineRpm = eng.redlineRpm - 180 + Math.sin(this._revBouncePhase) * 160;
      } else {
        this.revLimiterActive = false;
      }
      this.rpm = THREE.MathUtils.clamp((this.engineRpm - eng.idleRpm) / (eng.redlineRpm - eng.idleRpm), 0, 1);
      this.turboBoost = THREE.MathUtils.lerp(this.turboBoost, eng.hasTurbo ? th * 0.45 : 0, Math.min(1, dt * 6));
      this.shiftLightLevel = THREE.MathUtils.clamp((this.rpm - 0.55) / 0.42, 0, 1);
      return;
    }

    const ctrl = this.isBot && canMove && !this.finished
      ? this._computeBotInput(dt, extra.leadHumanProgress ?? null)
      : (canMove && !this.finished
        ? input
        : { throttle: 0, brake: 0.75, steer: 0, handbrake: false, nitro: false });

    this.throttleInput = THREE.MathUtils.clamp(ctrl.throttle || 0, 0, 1);
    this.brakeInput = THREE.MathUtils.clamp(ctrl.brake || 0, 0, 1);
    this.handbraking = Boolean(ctrl.handbrake);

    // Drift-exit boost timer
    if (this.driftExitBoostTimer > 0) {
      this.driftExitBoostTimer = Math.max(0, this.driftExitBoostTimer - dt);
    }

    // Nitro logic (Slipstream & clean drifting recharge nitro!)
    const manualNitro = Boolean(ctrl.nitro && this.nitro > 1.5 && this.throttleInput > 0.1 && this.gear >= 1);
    this.nitroActive = manualNitro || (this.driftExitBoostTimer > 0 && this.throttleInput > 0.1);
    if (manualNitro) {
      this.nitro = Math.max(0, this.nitro - 23 * dt);
    } else {
      const rechargeRate = slipstream ? 11.5 : 4.0;
      this.nitro = Math.min(this.phys.nitroCapacity, this.nitro + rechargeRate * dt);
    }

    // Project once before substeps to know current track slope & surface
    let proj = this.track.projectPoint(this.position, this.splineIndex);
    this.splineIndex = proj.index;

    // Fixed physics substep loop for rock-solid high-speed & tire slip accuracy
    const substeps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(dt / PHYSICS_SUBSTEP)));
    const subDt = dt / substeps;

    const wasDrifting = this.drifting;
    let peakWallHit = 0;

    for (let s = 0; s < substeps; s++) {
      this._physicsSubstep(subDt, ctrl, proj, slipstream);
      proj = this.track.projectPoint(this.position, this.splineIndex);
      this.splineIndex = proj.index;

      // Guardrail collision handling per substep
      const wallHit = this._resolveGuardrail(proj);
      if (wallHit > peakWallHit) peakWallHit = wallHit;
    }

    this.wallHitIntensity = peakWallHit;

    // Height & road pitch alignment
    const targetY = proj.height + 0.04;
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, Math.min(1, dt * 20));

    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flatTan = new THREE.Vector3(proj.sample.tangent.x, 0, proj.sample.tangent.z).normalize();
    const alignDot = fwd.dot(flatTan);
    const slope = proj.sample.tangent.y;
    this.pitch = THREE.MathUtils.lerp(this.pitch, -slope * alignDot * 0.9, Math.min(1, dt * 11));
    this.wrongWay = alignDot < -0.35 && this.forwardSpeed > 6;

    // Decay shift-kick pulse smoothly
    this.shiftKickPulse = Math.max(0, this.shiftKickPulse - dt * 6.5);

    // Drift state, scoring & drift-exit boost
    const absSlipDeg = Math.abs(this.slipAngle) * (180 / Math.PI);
    const slidingHard = (absSlipDeg > 7.5 && Math.abs(this.forwardSpeed) > 14 && this.rearSlip > 0.55)
      || (this.handbraking && Math.abs(this.forwardSpeed) > 13 && absSlipDeg > 4.5);
    this.drifting = slidingHard;

    if (this.drifting) {
      const driftIntensity = THREE.MathUtils.clamp((absSlipDeg - 5) / 22, 0.2, 1.8);
      this.nitro = Math.min(this.phys.nitroCapacity, this.nitro + (14 + 10 * driftIntensity) * dt);
      this.driftScore += Math.round(Math.abs(this.forwardSpeed) * driftIntensity * 4.2 * dt);
      this.driftComboTimer = 1.65;
      this.driftDuration += dt;
    } else {
      if (wasDrifting && this.driftDuration >= 0.75 && this.forwardSpeed > 22 && this.throttleInput > 0.2) {
        this.driftExitBoostTimer = 0.72;
        this.justTriggeredDriftBoost = true;
      }
      this.driftDuration = 0;
      if (this.driftComboTimer > 0) {
        this.driftComboTimer -= dt;
        if (this.driftComboTimer <= 0) this.driftScore = 0;
      }
    }

    // Lap & checkpoint tracking
    const prevT = this.trackT;
    this.trackT = proj.t;

    if (canMove && !this.finished) {
      if (this.trackT > 0.20 && this.trackT < 0.45 && this.maxCheckpoint === 0) this.maxCheckpoint = 1;
      if (this.trackT > 0.45 && this.trackT < 0.72 && this.maxCheckpoint === 1) this.maxCheckpoint = 2;
      if (this.trackT > 0.72 && this.trackT < 0.96 && this.maxCheckpoint === 2) this.maxCheckpoint = 3;

      if (prevT > 0.82 && this.trackT < 0.18 && this.maxCheckpoint === 3) {
        const lapDuration = raceTimeMs - this.lapStartTime;
        if (lapDuration > 4000 && (this.bestLap === 0 || lapDuration < this.bestLap)) {
          this.bestLap = lapDuration;
          this.justSetBestLap = true;
        }
        this.lapStartTime = raceTimeMs;
        this.maxCheckpoint = 0;

        if (this.lap >= totalLaps) {
          this.finished = true;
          this.finishTime = raceTimeMs;
          this.lap = totalLaps;
        } else {
          this.lap += 1;
        }
      }
    }

    const lapBase = this.finished ? totalLaps + 1 : this.lap - 1;
    const effectiveT = (this.lap === 1 && this.maxCheckpoint === 0 && this.trackT > 0.8)
      ? this.trackT - 1.0
      : this.trackT;
    this.totalProgress = lapBase + effectiveT;

    // Final telemetry update
    this.speed = this.velocity.length() * (this.forwardSpeed >= -0.4 ? 1 : -1);
    this.rpm = THREE.MathUtils.clamp((this.engineRpm - eng.idleRpm) / (eng.redlineRpm - eng.idleRpm), 0, 1);
    this.shiftLightLevel = THREE.MathUtils.clamp((this.engineRpm - eng.redlineRpm * 0.74) / (eng.redlineRpm * 0.23), 0, 1);
    this.longG = this._longAccelFilt / GRAVITY;
    this.latG = this._latAccelFilt / GRAVITY;

    // Smooth visual driftAngle (consistent sign: positive when tail steps right on a left turn)
    const targetDriftAngle = THREE.MathUtils.clamp(this.slipAngle, -0.68, 0.68);
    this.driftAngle = THREE.MathUtils.lerp(this.driftAngle, targetDriftAngle, Math.min(1, dt * 12));
  }

  _physicsSubstep(dt, ctrl, proj, slipstream) {
    const p = this.phys;
    const eng = p.engine;
    const trans = p.transmission;
    const aero = p.aero;
    const tires = p.tires;
    const brakes = p.brakes;

    const mass = p.mass;
    const L = p.wheelbase;
    const Lf = L * (1 - p.weightFront); // distance CG -> front axle
    const Lr = L * p.weightFront;       // distance CG -> rear axle
    const Iz = mass * L * L * p.yawInertiaScale;

    // Car local horizontal orthonormal frame (right-handed Three.js: up x forward = left)
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwdX = sinY;
    const fwdZ = cosY;
    const leftX = cosY;
    const leftZ = -sinY;

    let vLong = this.velocity.x * fwdX + this.velocity.z * fwdZ;
    let vLat = this.velocity.x * leftX + this.velocity.z * leftZ;
    const absVLong = Math.abs(vLong);

    // 1. Track Surface & Kerb Detection
    const absLatOffset = Math.abs(proj.lateralOffset);
    let surfGrip = 1.0;
    let surfRollResist = 0.015;
    if (absLatOffset > this.track.halfWidth + 1.65) {
      this.surface = 'runoff';
      surfGrip = 0.82;
      surfRollResist = 0.045;
      this.kerbRumble = Math.min(1, absVLong / 45) * 0.35;
    } else if (absLatOffset > this.track.halfWidth - 0.35) {
      this.surface = 'kerb';
      surfGrip = 0.90;
      surfRollResist = 0.022;
      this.kerbRumble = Math.min(1, absVLong / 28);
    } else {
      this.surface = 'asphalt';
      this.kerbRumble = 0;
    }

    // 2. Steering Input + Speed-Sensitive Lock + Self-Aligning Counter-Steer Assist
    const rawSteer = THREE.MathUtils.clamp(ctrl.steer || 0, -1, 1);
    const steerInRate = THREE.MathUtils.lerp(8.8, 5.2, Math.min(1, absVLong / 85));
    const steerOutRate = 11.5;
    const changingDir = rawSteer !== 0 && Math.sign(rawSteer) !== Math.sign(this.steer);
    const steerRate = Math.abs(rawSteer) < 0.05 ? steerOutRate : (changingDir ? steerInRate * 1.45 : steerInRate);
    this.steer = THREE.MathUtils.lerp(this.steer, rawSteer, Math.min(1, dt * steerRate));

    // Speed-sensitive max wheel angle: full 33 deg at parking speed -> ~5.5 deg at 310 km/h
    const maxWheelAngle = 0.57 / (1 + Math.pow(absVLong / 27, 1.42));

    // Chassis slip angle beta: positive when tail kicks right on a left turn (vLat < 0)
    const speedForSlip = Math.max(3.5, absVLong);
    const chassisSlip = vLong >= -0.5 ? Math.atan2(-vLat, speedForSlip) : 0;
    this.slipAngle = chassisSlip;

    // Natural front-wheel caster self-alignment (pneumatic trail wants wheels to point along velocity!)
    // When tail steps right (chassisSlip > 0), counter-steer points RIGHT (negative wheel angle).
    // When driver straightens steering to exit a drift, caster alignment hooks the car up smoothly!
    const straighteningOut = Math.abs(this.steer) < 0.14 && !ctrl.handbrake;
    const baseCsGain = this.isBot
      ? 0.28
      : (this.tcsEnabled ? (straighteningOut ? 0.82 : 0.56) : (straighteningOut ? 0.54 : 0.34));
    const casterAssist = absVLong > 6
      ? THREE.MathUtils.clamp(-chassisSlip * baseCsGain * (ctrl.handbrake ? 0.62 : 1.0), -0.46, 0.46)
      : 0;

    // Blend player steer + natural caster self-alignment
    const targetWheelAngle = THREE.MathUtils.clamp(
      this.steer * maxWheelAngle + casterAssist,
      -0.60,
      0.60
    );
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, targetWheelAngle, Math.min(1, dt * 18));
    this.visualSteer = THREE.MathUtils.clamp(this.steerAngle / 0.46, -1, 1);

    // 3. Transmission & Engine Powertrain
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.downshiftBlipTimer > 0) this.downshiftBlipTimer = Math.max(0, this.downshiftBlipTimer - dt);
    if (this.shiftCooldown > 0) this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.manualHoldTimer > 0) this.manualHoldTimer = Math.max(0, this.manualHoldTimer - dt);

    // Determine effective throttle/brake pedals (AT auto-reverse vs MT explicit reverse)
    let throttle = THREE.MathUtils.clamp(ctrl.throttle || 0, 0, 1);
    let brake = THREE.MathUtils.clamp(ctrl.brake || 0, 0, 1);

    if (this.transmissionMode === 'AT' && this.manualHoldTimer <= 0) {
      if (this.gear === 0) {
        // Currently in Reverse: S accelerates backward, W brakes & returns to 1st
        if (throttle > 0.05) {
          if (vLong > -1.8) {
            this._engageGear(1, true);
          } else {
            brake = throttle;
            throttle = 0;
          }
        } else if (brake > 0.05) {
          throttle = brake;
          brake = 0;
        }
      } else {
        // Currently in Forward gear: require a brief 0.28s stopped hold on S before engaging Reverse
        // so hard braking into a hairpin never accidentally jumps into R!
        if (brake > 0.2 && vLong < 0.6 && throttle < 0.05) {
          this._reverseHoldTimer += dt;
          if (this._reverseHoldTimer >= 0.28) {
            this._engageGear(0, false);
            throttle = brake;
            brake = 0;
            this._reverseHoldTimer = 0;
          }
        } else {
          this._reverseHoldTimer = 0;
        }
      }
    } else if (this.gear === 0) {
      // In MT mode while in Reverse, throttle drives backward, brake slows down
      // (standard MT convention)
    }

    this.braking = brake > 0.08 && absVLong > 1.2;

    // Turbo spool dynamics (McLaren Senna twin-turbo V8)
    if (eng.hasTurbo) {
      const targetBoost = (throttle > 0.15 && this.shiftTimer <= 0)
        ? THREE.MathUtils.clamp((this.engineRpm - eng.idleRpm) / (eng.redlineRpm * 0.52), 0.15, 1.0) * throttle
        : 0;
      const spoolRate = targetBoost > this.turboBoost ? 4.4 : 7.5;
      this.turboBoost = THREE.MathUtils.lerp(this.turboBoost, targetBoost, Math.min(1, dt * spoolRate));
    } else {
      this.turboBoost = 0;
    }

    // Current gear ratio
    const isReverse = this.gear === 0;
    const gearRatio = isReverse
      ? trans.reverseRatio
      : trans.gears[Math.max(0, Math.min(trans.gears.length - 1, this.gear - 1))];
    const totalRatio = gearRatio * trans.finalDrive;

    // Compute engine RPM coupled to driven wheels + clutch launch slip + wheelspin flare
    const drivenWheelLinearSpeed = Math.abs(vLong) + this.wheelSpin * 9.5;
    const coupledRpm = this._computeGearRpm(drivenWheelLinearSpeed, this.gear);

    // Smooth launch clutch slip below ~7 m/s in 1st / R so engine revs eagerly off the line
    const clutchEngage = THREE.MathUtils.clamp((absVLong - 0.6) / 6.5, 0, 1);
    const freeRevTarget = eng.idleRpm + throttle * (eng.redlineRpm * 0.56 - eng.idleRpm);
    let targetRpm = THREE.MathUtils.lerp(Math.max(freeRevTarget, coupledRpm), coupledRpm, clutchEngage);

    // Auto rev-match blip on downshift!
    if (this.downshiftBlipTimer > 0) {
      targetRpm = Math.max(targetRpm, coupledRpm * 1.05);
    }

    const rpmFollowRate = this.shiftTimer > 0 ? 18 : (this.downshiftBlipTimer > 0 ? 24 : 20);
    this.engineRpm = THREE.MathUtils.lerp(this.engineRpm, targetRpm, Math.min(1, dt * rpmFollowRate));

    // Rev-limiter bounce at redline
    let limiterCut = 1.0;
    if (this.engineRpm >= eng.redlineRpm - 30) {
      this._revBouncePhase += dt * 48;
      this.revLimiterActive = true;
      this.engineRpm = eng.redlineRpm - 140 + Math.sin(this._revBouncePhase) * 140;
      limiterCut = 0.08;
    } else {
      this.revLimiterActive = false;
    }

    // Automatic Sport Shifting (AT mode, respecting temporary manual paddle hold)
    if ((this.transmissionMode === 'AT' || this.isBot) && this.manualHoldTimer <= 0 && this.shiftCooldown <= 0 && !isReverse) {
      const maxGear = trans.gears.length;
      // Dynamic shift-up threshold: full throttle holds near redline; cruising shifts slightly earlier
      const dynamicUpRpm = THREE.MathUtils.lerp(eng.redlineRpm * 0.78, eng.shiftUpRpm, Math.min(1, throttle * 1.4));
      const trueRoadRpm = this._computeGearRpm(Math.max(0, vLong), this.gear);

      // Sport DCT Corner/Drift Gear-Hold: hold gear during active slide/handbrake unless right at redline!
      const holdGearForSlide = (ctrl.handbrake || Math.abs(chassisSlip) > 0.14 || this.wheelSpin > 0.35)
        && trueRoadRpm < eng.redlineRpm * 0.99;

      if (this.gear < maxGear && trueRoadRpm >= dynamicUpRpm && throttle > 0.15 && !holdGearForSlide) {
        this._engageGear(this.gear + 1, true);
      } else if (this.gear > 1) {
        const lowerGearRpm = this._computeGearRpm(Math.max(0, vLong), this.gear - 1);
        // Under hard braking, Sport DCT/PDK eagerly downshifts to keep engine in powerband!
        const brakeDownshift = brake > 0.25 && lowerGearRpm < eng.redlineRpm * 0.85;
        const normalDownshift = trueRoadRpm < eng.shiftDownRpm && lowerGearRpm < eng.redlineRpm * 0.82;
        if (brakeDownshift || normalDownshift) {
          this._engageGear(this.gear - 1, false);
        }
      }
    }

    // Engine Torque Output
    const rpmNorm = THREE.MathUtils.clamp((this.engineRpm - eng.idleRpm) / (eng.redlineRpm - eng.idleRpm), 0, 1);
    const curveMult = sampleCurve(eng.torqueCurve, rpmNorm);
    const turboMult = eng.hasTurbo ? (0.82 + 0.24 * this.turboBoost) : 1.0;
    const shiftCutMult = this.shiftTimer > 0 ? 0.14 : 1.0;
    const botPowerScale = this.isBot ? THREE.MathUtils.clamp(this.botSkill, 0.84, 1.02) : 1.0;

    let engineTorque = 0;
    if (throttle > 0.02) {
      engineTorque = eng.peakTorque * curveMult * turboMult * throttle * shiftCutMult * limiterCut * botPowerScale;
    } else if (this.downshiftBlipTimer <= 0 && absVLong > 2.5) {
      // Realistic engine braking (stronger at high RPM and in lower gears!)
      engineTorque = -eng.engineBrake * (0.25 + 0.75 * rpmNorm);
    }

    const driveDir = isReverse ? -1 : 1;
    // Wheel force from gearbox (with 0.90 mechanical transmission efficiency)
    let fDriveTotal = (engineTorque * totalRatio * 0.90) / trans.wheelRadius * driveDir;

    // Limit reverse speed smoothly around 75 km/h (~21 m/s)
    if (isReverse && vLong < -21) {
      fDriveTotal = Math.max(0, fDriveTotal);
    }

    // Nitro adds punchy mid-range thrust while staying realistic at extreme Vmax (~+30-35 km/h top speed)
    if (this.nitroActive && !isReverse) {
      const highSpeedTaper = Math.max(0.32, 1 - absVLong / 130);
      const nitroThrust = mass * 3.8 * ((p.nitroPower - 1.0) / 0.32) * highSpeedTaper;
      fDriveTotal += nitroThrust;
    }

    // 4. Aerodynamic Forces (Quadratic Drag + Quadratic Downforce + Slipstream!)
    const slipDragMult = slipstream ? 0.84 : 1.0;
    const nitroDragMult = this.nitroActive ? 0.96 : 1.0;
    const fAeroDrag = aero.dragCoeff * slipDragMult * nitroDragMult * vLong * absVLong;
    const fRoll = surfRollResist * mass * GRAVITY * (absVLong > 0.15 ? Math.sign(vLong) : 0);

    // Track elevation slope gravity force along heading
    const slopeAlongCar = proj.sample.tangent.y * (fwdX * proj.sample.tangent.x + fwdZ * proj.sample.tangent.z);
    const fGrade = -mass * GRAVITY * slopeAlongCar;

    // Speed-squared aerodynamic downforce plants the tires at high speed!
    const vSq = vLong * vLong;
    const fDownF = aero.downforceFront * vSq;
    const fDownR = aero.downforceRear * vSq;

    // 5. Dynamic Longitudinal Weight Transfer (with supercar anti-dive / anti-squat suspension geometry)
    const weightTransfer = THREE.MathUtils.clamp(
      mass * this._longAccelFilt * (p.cgHeight / L) * 0.78,
      -mass * GRAVITY * 0.18,
      mass * GRAVITY * 0.20
    );
    const fzF = Math.max(mass * GRAVITY * 0.24, mass * GRAVITY * p.weightFront - weightTransfer + fDownF);
    const fzR = Math.max(mass * GRAVITY * 0.28, mass * GRAVITY * (1 - p.weightFront) + weightTransfer + fDownR);

    // Real rubber load sensitivity + staggered supercar rear tire width advantage (~+10% wider rear rubber)
    const latLoadFrac = Math.min(1, Math.abs(this._latAccelFilt) / (GRAVITY * 1.65));
    const loadSensF = 1 - latLoadFrac * 0.08;
    const loadSensR = 1 - latLoadFrac * (0.10 * tires.driftBalance);

    // 6. Axle Peak Friction Budgets
    const muF = tires.frontGrip * surfGrip * loadSensF;
    const muR = tires.rearGrip * 1.10 * surfGrip * loadSensR * (ctrl.handbrake ? tires.handbrakeRearGrip : 1.0);
    const fMaxF = muF * fzF;
    const fMaxR = muR * fzR;

    // Split Drive & Brake forces per axle
    const frontDriveShare = p.drivetrain === 'AWD' ? p.awdFrontBias : 0.0;
    let fLongF = fDriveTotal * frontDriveShare;
    let fLongR = fDriveTotal * (1 - frontDriveShare);

    // Braking forces (with realistic front brake bias, ABS & EBD Electronic Brakeforce Distribution)
    this.absActive = false;
    if (brake > 0.01 && absVLong > 0.15) {
      const brakeDir = -Math.sign(vLong);
      let reqBrakeF = brakes.maxBrakeForce * brakes.brakeBiasFront * brake;
      let reqBrakeR = brakes.maxBrakeForce * (1 - brakes.brakeBiasFront) * brake;

      // ABS keeps front tires near peak longitudinal grip (~90%), while EBD limits rear braking (~62% of rear grip)
      // so rear tires always retain strong lateral stability for crisp, non-spinning trail-braking!
      const absLimitF = fMaxF * 0.90;
      const ebdLimitR = fMaxR * 0.62;
      if (reqBrakeF > absLimitF) {
        reqBrakeF = absLimitF;
        this.absActive = true;
      }
      if (reqBrakeR > ebdLimitR) {
        reqBrakeR = ebdLimitR;
        this.absActive = true;
      }
      fLongF += brakeDir * reqBrakeF;
      fLongR += brakeDir * reqBrakeR;
    }

    // Handbrake locks rear axle strongly while dropping rear lateral grip!
    if (ctrl.handbrake && absVLong > 0.5) {
      fLongR += -Math.sign(vLong) * Math.min(fMaxR * 0.92, mass * 8.5);
    }

    // 7. Compute Tire Slip Angles (Dynamic Bicycle Model)
    let fyF = 0;
    let fyR = 0;
    let rawFrontSlip = 0;
    let rawRearSlip = 0;
    this.tcsActive = false;

    const vyF = vLat + Lf * this.yawRate;
    const vyR = vLat - Lr * this.yawRate;

    if (absVLong > 1.8) {
      const forwardSign = vLong >= 0 ? 1 : -1;
      const vxEff = Math.max(2.2, absVLong);

      // Slip angles (rad): alpha = wheelHeading - velocityAngle
      const alphaF = this.steerAngle * forwardSign - Math.atan2(vyF, vxEff);
      const alphaR = -Math.atan2(vyR, vxEff);

      const uF = alphaF / tires.peakSlipAngle;
      const uR = alphaR / tires.peakSlipAngle;

      // Longitudinal grip usage -> Combined-Slip Traction Circle!
      // When cornering hard + applying heavy throttle on RWD, lateral demand shrinks available
      // longitudinal rear grip -> authentic progressive power oversteer & wheelspin!
      const latDemandFracR = Math.min(0.96, Math.abs(uR) * 0.92 + latLoadFrac * 0.42);
      const availLongR = fMaxR * Math.sqrt(Math.max(0.14, 1 - latDemandFracR * latDemandFracR * 0.85));

      let spinAmount = 0;
      if (!isReverse && fLongR > availLongR && throttle > 0.22 && !ctrl.handbrake) {
        const excess = (fLongR - availLongR) / Math.max(1, fMaxR * 0.58);
        if (this.tcsEnabled && !this.isBot) {
          // Sport TCS: allows lively controllable tail-out while keeping spinout at bay
          fLongR = availLongR + (fLongR - availLongR) * 0.44;
          spinAmount = THREE.MathUtils.clamp(excess * 0.55, 0, 0.55);
          if (excess > 0.05) this.tcsActive = true;
        } else if (this.isBot) {
          fLongR = availLongR * 0.98;
          spinAmount = THREE.MathUtils.clamp(excess * 0.18, 0, 0.28);
        } else {
          // TCS OFF (Pro mode): full unfiltered wheelspin & smoky RWD power slides!
          fLongR = Math.min(fLongR, fMaxR * 0.96);
          spinAmount = THREE.MathUtils.clamp(excess * 1.35, 0, 1.0);
        }
      }
      this.wheelSpin = THREE.MathUtils.lerp(this.wheelSpin, spinAmount, Math.min(1, dt * 14));

      // Clamp longitudinal forces within tire friction limits
      fLongF = THREE.MathUtils.clamp(fLongF, -fMaxF, fMaxF);
      fLongR = THREE.MathUtils.clamp(fLongR, -fMaxR, fMaxR);

      // Symmetric combined-slip friction circle!
      // Heavy front braking eats front lateral grip (preventing violent brake-spinouts!),
      // while rear wheelspin under power eats rear lateral grip (authentic power oversteer!).
      const longFracF = Math.min(0.94, Math.abs(fLongF) / Math.max(1, fMaxF));
      const spinLatPenalty = straighteningOut ? 0.22 : (this.tcsEnabled ? 0.46 : 0.64);
      const longFracR = Math.min(
        0.96,
        (Math.abs(fLongR) / Math.max(1, fMaxR)) * (straighteningOut ? 0.78 : 1.0) + this.wheelSpin * spinLatPenalty
      );

      const latCapF = fMaxF * Math.sqrt(Math.max(0.20, 1 - longFracF * longFracF * 0.88));
      const latCapR = fMaxR * Math.sqrt(Math.max(0.16, 1 - longFracR * longFracR * 0.86));

      // Nonlinear Pacejka lateral tire forces
      const pacejkaF = pacejkaNormalized(uF * (tires.corneringStiffnessF / 10.0), tires.slideGripRatio);
      const pacejkaR = pacejkaNormalized(uR * (tires.corneringStiffnessR / 10.0), tires.slideGripRatio);

      fyF = latCapF * pacejkaF;
      fyR = latCapR * pacejkaR;

      // Subtle braking ESC stability + progressive high-angle drift limiter:
      // Allows playful 8°-14° trail-brake rotation & 20°-38° handbrake drifts, never backward spinouts!
      const absBeta = Math.abs(chassisSlip);
      const brakeEscThreshold = 0.22;
      if (brake > 0.2 && !ctrl.handbrake && absBeta > brakeEscThreshold) {
        const escCorr = Math.min(0.65, (absBeta - brakeEscThreshold) * 2.2);
        fyR += Math.sign(chassisSlip) * fMaxR * escCorr;
      } else if (absBeta > 0.56) {
        const recovery = (absBeta - 0.56) * (this.tcsEnabled ? 2.6 : 1.25);
        fyR += Math.sign(chassisSlip) * fMaxR * Math.min(0.55, recovery);
      }

      rawFrontSlip = THREE.MathUtils.clamp(
        Math.max(Math.abs(uF) * 0.72, this.absActive ? 0.65 : 0),
        0,
        1
      );
      rawRearSlip = THREE.MathUtils.clamp(
        Math.max(
          Math.abs(uR) * 0.80,
          this.wheelSpin * 0.95,
          ctrl.handbrake && absVLong > 6 ? 0.95 : 0
        ),
        0,
        1
      );
    } else {
      // Low-speed kinematic smooth regime (zero numerical chatter at standstill / crawl!)
      this.wheelSpin = THREE.MathUtils.lerp(
        this.wheelSpin,
        (throttle > 0.6 && !this.tcsEnabled && p.drivetrain === 'RWD' && this.gear === 1) ? 0.55 : 0,
        Math.min(1, dt * 10)
      );
      fLongF = THREE.MathUtils.clamp(fLongF, -fMaxF, fMaxF);
      fLongR = THREE.MathUtils.clamp(fLongR, -fMaxR, fMaxR);

      // Smooth kinematic bicycle yaw rate
      const targetYawRate = (vLong / L) * Math.tan(this.steerAngle);
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, targetYawRate, Math.min(1, dt * 14));
      vLat = THREE.MathUtils.lerp(vLat, 0, Math.min(1, dt * 16));
    }

    // 8. Integrate Newton-Euler Planar Vehicle Body Equations
    const cosDelta = Math.cos(this.steerAngle);
    const sinDelta = Math.sin(this.steerAngle);

    // Front lateral force projected slightly against forward motion when steering sharply (scrub drag!)
    const fSteerScrub = -fyF * sinDelta * 0.35;
    const totalLongForce = fLongF * cosDelta + fLongR + fSteerScrub - fAeroDrag - fRoll + fGrade;
    const totalLatForce = fyF * cosDelta + fyR + fLongF * sinDelta;

    const aLong = totalLongForce / mass;
    const aLat = totalLatForce / mass;

    // Smooth acceleration telemetry for suspension & weight transfer
    this._longAccelFilt = THREE.MathUtils.lerp(this._longAccelFilt, aLong, Math.min(1, dt * 10));
    this._latAccelFilt = THREE.MathUtils.lerp(this._latAccelFilt, aLat, Math.min(1, dt * 11));

    vLong += (aLong + vLat * this.yawRate) * dt;

    if (absVLong > 1.8) {
      vLat += (aLat - vLong * this.yawRate) * dt;

      // Rotational yaw moment + aerodynamic & tire yaw damping
      const yawDamping = (1850 + absVLong * 55) * (this.tcsEnabled ? 1.15 : 0.85);
      const yawTorque = (Lf * (fyF * cosDelta + fLongF * sinDelta)) - (Lr * fyR) - yawDamping * this.yawRate;
      this.yawRate += (yawTorque / Iz) * dt;
      this.yawRate = THREE.MathUtils.clamp(this.yawRate, -3.4, 3.4);
    }

    // Clean standstill stop when coasting/braking to 0
    if (Math.abs(vLong) < 0.14 && throttle < 0.02 && (brake > 0.05 || Math.abs(fGrade) < mass * 0.5)) {
      vLong = 0;
      vLat = 0;
      this.yawRate = 0;
    }

    // Integrate heading & reconstruct world velocity
    this.yaw += this.yawRate * dt;
    const nSin = Math.sin(this.yaw);
    const nCos = Math.cos(this.yaw);
    this.velocity.set(
      nSin * vLong + nCos * vLat,
      0,
      nCos * vLong - nSin * vLat
    );
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    this.forwardSpeed = vLong;
    this.lateralSpeed = vLat;
    this.frontSlip = THREE.MathUtils.lerp(this.frontSlip, rawFrontSlip, Math.min(1, dt * 14));
    this.rearSlip = THREE.MathUtils.lerp(this.rearSlip, rawRearSlip, Math.min(1, dt * 14));

    // Wheel visual rotational speeds (front rolls with ground; rear spins faster during burnout or locks on handbrake!)
    this.frontWheelSpeed = this.absActive ? vLong * 0.72 : vLong;
    this.rearWheelSpeed = ctrl.handbrake
      ? 0
      : vLong + Math.sign(vLong || 1) * this.wheelSpin * 16;
  }

  _resolveGuardrail(proj) {
    const maxLat = this.track.halfWidth + 1.85;
    if (Math.abs(proj.lateralOffset) <= maxLat) return 0;

    const sign = Math.sign(proj.lateralOffset);
    const excess = Math.abs(proj.lateralOffset) - maxLat;
    this.position.addScaledVector(proj.sample.right, -sign * excess);

    const wallNormalX = -proj.sample.right.x * sign;
    const wallNormalZ = -proj.sample.right.z * sign;
    const vn = this.velocity.x * wallNormalX + this.velocity.z * wallNormalZ;

    if (vn < 0) {
      // Realistic glancing guardrail scrape: bounce gently back inside, scrape off slight tangential speed
      const restitution = 0.28;
      this.velocity.x -= wallNormalX * vn * (1 + restitution);
      this.velocity.z -= wallNormalZ * vn * (1 + restitution);

      // Tangential friction proportional to impact severity
      const impactNorm = Math.min(1, Math.abs(vn) / 22);
      const speedRetention = 1 - impactNorm * 0.14;
      this.velocity.x *= speedRetention;
      this.velocity.z *= speedRetention;
      this.yawRate *= 0.45;

      // Gently nudge heading away from digging deeper into the guardrail
      const trackYaw = Math.atan2(proj.sample.tangent.x, proj.sample.tangent.z);
      let diff = trackYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < Math.PI * 0.45) {
        this.yaw += diff * 0.12;
      }

      return impactNorm;
    }
    return 0;
  }

  getNetworkState() {
    return {
      x: Number(this.position.x.toFixed(2)),
      y: Number(this.position.y.toFixed(2)),
      z: Number(this.position.z.toFixed(2)),
      vx: Number(this.velocity.x.toFixed(2)),
      vz: Number(this.velocity.z.toFixed(2)),
      yaw: Number(this.yaw.toFixed(3)),
      pitch: Number(this.pitch.toFixed(3)),
      speed: Number(this.speed.toFixed(1)),
      steer: Number(this.visualSteer.toFixed(2)),
      drift: Number(this.driftAngle.toFixed(2)),
      latG: Number(this.latG.toFixed(2)),
      longG: Number(this.longG.toFixed(2)),
      braking: this.braking,
      nitro: this.nitroActive,
      lap: this.lap,
      progress: Number(this.totalProgress.toFixed(4)),
      finished: this.finished
    };
  }
}
