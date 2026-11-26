import * as THREE from 'three';
import { modelLoader } from './ModelLoader.js';

let sharedShadowTex = null;
function getContactShadowTexture() {
  if (sharedShadowTex) return sharedShadowTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  // Tight crisp automotive chassis & wheel ambient-occlusion shadow
  ctx.clearRect(0, 0, 256, 512);
  ctx.save();
  ctx.filter = 'blur(18px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.96)';
  ctx.beginPath();
  ctx.roundRect(36, 44, 184, 424, 52);
  ctx.fill();
  ctx.restore();
  sharedShadowTex = new THREE.CanvasTexture(c);
  return sharedShadowTex;
}

let sharedBeamTex = null;
function getHeadlightBeamTexture() {
  if (sharedBeamTex) return sharedBeamTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128, 244, 6, 128, 118, 152);
  grad.addColorStop(0, 'rgba(240, 248, 255, 0.50)');
  grad.addColorStop(0.42, 'rgba(215, 236, 255, 0.18)');
  grad.addColorStop(1, 'rgba(180, 215, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  sharedBeamTex = new THREE.CanvasTexture(c);
  return sharedBeamTex;
}

let sharedFlameTex = null;
function getFlameTexture() {
  if (sharedFlameTex) return sharedFlameTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(140, 225, 255, 0.92)');
  grad.addColorStop(0.52, 'rgba(255, 145, 40, 0.45)');
  grad.addColorStop(1.0, 'rgba(255, 80, 10, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  sharedFlameTex = new THREE.CanvasTexture(c);
  return sharedFlameTex;
}

function createNameplateSprite(label, isBot) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = isBot ? 'rgba(12, 16, 26, 0.68)' : 'rgba(0, 120, 180, 0.78)';
  ctx.beginPath();
  ctx.roundRect(18, 12, 220, 40, 8);
  ctx.fill();
  ctx.strokeStyle = isBot ? 'rgba(255, 190, 60, 0.65)' : 'rgba(0, 235, 255, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 13), 128, 33);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.88, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.set(0, 2.05, 0);
  return sprite;
}

/**
 * Builds a photorealistic GT3 supercar using Blender-sculpted GLB assets,
 * soft contact shadow, real SpotLight headlights (for player car),
 * dynamic red PointLight brake-light glow on wet asphalt, multi-blade OLED brake lights,
 * spring-damper G-force suspension kinematics, exhaust backfire flashes,
 * and optional 3D floating multiplayer nameplate.
 */
export function buildSupercar(carConfig, isLocalPlayer = false, nameplate = null, isBot = false, isShowroom = false) {
  const root = new THREE.Group();
  const glb = modelLoader.getClone(carConfig.id);

  let bodyGroup = new THREE.Group();
  let wheels = [];
  const brakeLightMats = [];

  if (glb) {
    root.add(glb);
    const foundBody = glb.getObjectByName('BodyRoot');
    if (foundBody) bodyGroup = foundBody;

    const wheelNames = [
      { name: 'Wheel_FL', front: true },
      { name: 'Wheel_FR', front: true },
      { name: 'Wheel_RL', front: false },
      { name: 'Wheel_RR', front: false }
    ];
    for (const wn of wheelNames) {
      const pivot = glb.getObjectByName(wn.name);
      const spinGroup = glb.getObjectByName(`${wn.name}_Spin`) || pivot;
      if (pivot && spinGroup) {
        wheels.push({ pivot, spinGroup, front: wn.front });
      }
    }

    glb.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (child.name.includes('BrakeLight') || (m.name && m.name.startsWith('BrakeLight_'))) {
            if (!brakeLightMats.includes(m)) brakeLightMats.push(m);
          }
        }
      }
    });
  } else {
    root.add(bodyGroup);
    const paintMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(carConfig.color),
      metalness: 0.84,
      roughness: 0.12,
      clearcoat: 1.0
    });
    const fallback = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 4.4), paintMat);
    fallback.position.y = 0.65;
    bodyGroup.add(fallback);
  }

  const baseBodyY = bodyGroup.position.y;

  // Deep Tight Contact Shadow hugging the road right under the 4 tires & diffuser
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.65, 5.15),
    new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3
    })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0, 0.025, 0);
  root.add(shadowPlane);

  // Subtle projected headlight wash on asphalt (hidden in showroom studio!)
  if (!isShowroom) {
    const headBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 18.0),
      new THREE.MeshBasicMaterial({
        map: getHeadlightBeamTexture(),
        transparent: true,
        opacity: 0.44,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    headBeam.rotation.x = -Math.PI / 2;
    headBeam.position.set(0, 0.05, 10.6);
    root.add(headBeam);
  }

  // Real dynamic lights for the player's car (illuminates wet road, barriers & opponents!)
  let brakePointLight = null;
  if (isLocalPlayer) {
    const spot = new THREE.SpotLight(0xf2f7ff, 55, 68, Math.PI / 4.8, 0.65, 1.35);
    spot.position.set(0, 0.72, 2.2);
    spot.target.position.set(0, 0.2, 24);
    root.add(spot);
    root.add(spot.target);

    brakePointLight = new THREE.PointLight(0xff1424, 3.0, 9.5, 1.8);
    brakePointLight.position.set(0, 0.78, -2.6);
    root.add(brakePointLight);
  }

  // Soft Volumetric Exhaust Afterburner / Shift-Backfire Sprites
  const nitroFlames = [];
  const flameTex = getFlameTexture();
  for (const side of [-0.34, 0.34]) {
    const flameMat = new THREE.SpriteMaterial({
      map: flameTex,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const flame = new THREE.Sprite(flameMat);
    flame.position.set(side, 0.34, -2.55);
    flame.scale.set(0.75, 0.75, 1);
    bodyGroup.add(flame);
    nitroFlames.push(flame);
  }

  // Optional floating 3D nameplate for LAN peers & AI rivals
  if (!isLocalPlayer && nameplate) {
    root.add(createNameplateSprite(nameplate, isBot));
  }

  // Spring-damper suspension state for organic body roll, squat/dive & kerb rumble
  let rollAngle = 0;
  let rollVel = 0;
  let pitchAngle = 0;
  let pitchVel = 0;
  let rumblePhase = 0;

  return {
    root,
    bodyGroup,
    wheels,
    nitroFlames,
    setVisualState({
      speed = 0,
      frontWheelSpeed = null,
      rearWheelSpeed = null,
      steer = 0,
      braking = false,
      nitro = false,
      driftAngle = 0,
      latG = null,
      longG = null,
      shiftKick = 0,
      kerbRumble = 0,
      backfire = 0,
      dt = 0.016
    }) {
      const fSpd = frontWheelSpeed !== null ? frontWheelSpeed : speed;
      const rSpd = rearWheelSpeed !== null ? rearWheelSpeed : speed;
      const wheelRadius = 0.36;

      for (const w of wheels) {
        const wSpd = w.front ? fSpd : rSpd;
        w.spinGroup.rotation.x += (wSpd / wheelRadius) * dt;
        if (w.front) {
          w.pivot.rotation.y = THREE.MathUtils.lerp(w.pivot.rotation.y, steer * 0.46, Math.min(1, dt * 18));
        }
      }

      // Realistic spring-damper body roll & squat/dive!
      // Right-handed +Z forward, +X left: positive Z-rotation tilts top toward -X (RIGHT, outside of a left turn!)
      const effLatG = latG !== null
        ? latG
        : (steer * Math.min(1, Math.abs(speed) / 38) * 1.2 + driftAngle * 1.1);
      const effLongG = longG !== null
        ? longG
        : (braking ? -1.1 : (nitro ? 0.9 : 0));

      const targetRoll = THREE.MathUtils.clamp(effLatG * 0.032, -0.068, 0.068);
      // Positive X-rotation = nose dive (braking); negative X-rotation = rear squat (acceleration)
      // Shift kick gives a crisp momentary forward nod on DCT upshift cut!
      const targetPitch = THREE.MathUtils.clamp(-effLongG * 0.020 + shiftKick * 0.014, -0.042, 0.048);

      const safeDt = Math.min(0.033, dt);
      const springK = 125;
      const dampC = 16.5;

      const rollAcc = (targetRoll - rollAngle) * springK - rollVel * dampC;
      rollVel += rollAcc * safeDt;
      rollAngle += rollVel * safeDt;

      const pitchAcc = (targetPitch - pitchAngle) * springK - pitchVel * dampC;
      pitchVel += pitchAcc * safeDt;
      pitchAngle += pitchVel * safeDt;

      // Subtle high-frequency suspension heave when riding on red/white apex kerbs
      let heaveY = 0;
      if (kerbRumble > 0.02) {
        rumblePhase += safeDt * (38 + Math.abs(speed) * 1.2);
        heaveY = Math.sin(rumblePhase) * 0.024 * kerbRumble;
      }

      bodyGroup.rotation.z = rollAngle;
      bodyGroup.rotation.x = pitchAngle;
      bodyGroup.position.y = baseBodyY + heaveY;

      // Multi-element OLED Brake Light emission + wet road red illumination
      const targetEmissive = braking ? 6.8 : 1.6;
      for (const m of brakeLightMats) {
        if (m.emissive) m.emissiveIntensity = targetEmissive;
      }
      if (brakePointLight) {
        brakePointLight.intensity = braking ? 12.5 : 2.2;
      }

      // Soft volumetric nitro afterburner & crisp upshift/downshift exhaust backfire pops
      const showFlame = nitro || backfire > 0.05;
      const flameOpacity = nitro
        ? (0.78 + Math.random() * 0.22)
        : (backfire > 0.05 ? Math.min(1, backfire * (0.75 + Math.random() * 0.35)) : 0);
      const flameScale = nitro
        ? (0.70 + Math.random() * 0.34)
        : (backfire > 0.05 ? (0.48 + backfire * 0.42) : 0.01);

      for (const f of nitroFlames) {
        f.material.opacity = showFlame ? flameOpacity : 0;
        f.scale.set(flameScale, flameScale, 1);
      }
    }
  };
}
