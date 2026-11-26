import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const CinematicGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uNitro: { value: 0.0 },
    uSpeed: { value: 0.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uNitro;
    uniform float uSpeed;
    varying vec2 vUv;

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);

      // Subtle dynamic radial chromatic aberration ONLY at high speed / Nitro boost
      float caAmt = (uNitro * 0.0038 + max(0.0, uSpeed - 0.68) * 0.0018) * smoothstep(0.18, 0.72, dist);
      vec2 dir = normalize(center + vec2(0.0001));
      float r = texture2D(tDiffuse, vUv + dir * caAmt).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * caAmt).b;
      vec3 col = vec3(r, g, b);

      // Safe [0..1] post-tonemap Gran Turismo filmic contrast & subtle vignette
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);
      float vig = 1.0 - smoothstep(0.46, 0.96, dist) * (0.24 + uNitro * 0.12);
      col *= vig;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.2, 2400);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 4x MSAA HalfFloat RenderTarget for razor-sharp anti-aliased wheel spokes & panel seams!
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const rt = new THREE.WebGLRenderTarget(
      Math.floor(window.innerWidth * pixelRatio),
      Math.floor(window.innerHeight * pixelRatio),
      {
        type: THREE.HalfFloatType,
        samples: 4
      }
    );

    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.16,  // refined natural bloom
      0.24,  // tight realistic lens halo
      1.65   // strict HDR threshold: only headlights, OLED taillights & gantry LEDs bloom
    );
    this.composer.addPass(this.bloomPass);

    // Run ACESFilmic OutputPass BEFORE CinematicGradeShader so S-curve runs in safe [0..1] LDR space (ZERO HDR rainbow artifacts!)
    this.composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(CinematicGradeShader);
    this.composer.addPass(this.gradePass);

    // Environment & Real Photographed Poly Haven HDRI Cache
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.rgbeLoader = new RGBELoader();
    this.hdriCache = new Map();

    // Instant fallback environment while studio.hdr finishes loading
    this.fallbackEnvRT = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.fallbackEnvRT.texture;
    this.currentMode = 'showroom';
    this.currentTrackHdri = null;

    // Preload real Poly Haven HDRIs (studio, dusk, sunset)
    this._loadHdri('/env/studio.hdr', true);
    this._loadHdri('/env/dusk.hdr', false);
    this._loadHdri('/env/sunset.hdr', false);

    // World groups
    this.showroomGroup = new THREE.Group();
    this.raceGroup = new THREE.Group();
    this.scene.add(this.showroomGroup);
    this.scene.add(this.raceGroup);

    // Balanced daylight/dusk hemisphere + tight high-res directional shadow sun
    this.ambientLight = new THREE.HemisphereLight(0x88a8cc, 0x1b1e26, 0.55);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffcb96, 1.45);
    this.sunLight.position.set(160, 125, -220);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 480;
    const d = 130; // Wide frustum prevents visible shadow cutoff lines across the road
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Particle pool (soft radial smoke & sparks)
    this.particles = this._createParticleSystem();
    this.scene.add(this.particles.mesh);

    this._buildShowroom();

    window.addEventListener('resize', () => this.onResize());
  }

  _loadHdri(url, applyIfShowroom = false) {
    if (this.hdriCache.has(url)) return;
    this.rgbeLoader.load(
      url,
      (hdrTex) => {
        hdrTex.mapping = THREE.EquirectangularReflectionMapping;
        const envRT = this.pmrem.fromEquirectangular(hdrTex);
        this.hdriCache.set(url, { bg: hdrTex, env: envRT.texture });

        if (applyIfShowroom && this.currentMode === 'showroom') {
          this.scene.environment = envRT.texture;
        }
        if (this.currentMode === 'race' && this.currentTrackHdri === url) {
          this.scene.environment = envRT.texture;
          this.scene.background = hdrTex;
          this.scene.backgroundIntensity = 0.88;
        }
      },
      undefined,
      () => {}
    );
  }

  _buildShowroom() {
    // Gran Turismo Scapes dark architectural studio floor
    const floorGeo = new THREE.CylinderGeometry(16, 16.5, 0.4, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0d1016,
      metalness: 0.25,
      roughness: 0.42
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    this.showroomGroup.add(floor);

    // Subtle brushed metal turntable inlay ring
    const ringGeo = new THREE.TorusGeometry(6.2, 0.028, 12, 96);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x6f85a6, metalness: 0.8, roughness: 0.25 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.015;
    this.showroomGroup.add(ring);

    const keyLight = new THREE.SpotLight(0xf6f8ff, 34, 34, Math.PI / 4, 0.85, 1.4);
    keyLight.position.set(7.5, 8.2, 7.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    this.showroomGroup.add(keyLight);

    const rimLight = new THREE.PointLight(0x90bfff, 18, 24);
    rimLight.position.set(-7.5, 3.6, -6.0);
    this.showroomGroup.add(rimLight);
  }

  _createParticleSystem() {
    const maxCount = 600;
    const positions = new Float32Array(maxCount * 3);
    const colors = new Float32Array(maxCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pCanvas = document.createElement('canvas');
    pCanvas.width = 64;
    pCanvas.height = 64;
    const pCtx = pCanvas.getContext('2d');
    const pGrad = pCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    pGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    pGrad.addColorStop(0.38, 'rgba(255, 255, 255, 0.55)');
    pGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    pCtx.fillStyle = pGrad;
    pCtx.fillRect(0, 0, 64, 64);
    const pTex = new THREE.CanvasTexture(pCanvas);

    const mat = new THREE.PointsMaterial({
      size: 0.95,
      map: pTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    const mesh = new THREE.Points(geo, mat);
    mesh.frustumCulled = false;

    const pool = [];
    for (let i = 0; i < maxCount; i++) {
      pool.push({
        active: false, life: 0, maxLife: 1,
        x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0,
        r: 1, g: 1, b: 1, gravity: 0
      });
      positions[i * 3 + 1] = -999;
    }

    return { mesh, geo, positions, colors, pool, cursor: 0, maxCount };
  }

  spawnParticle(x, y, z, vx, vy, vz, r, g, b, life = 0.55, gravity = 0) {
    const ps = this.particles;
    const p = ps.pool[ps.cursor];
    ps.cursor = (ps.cursor + 1) % ps.maxCount;
    p.active = true;
    p.life = life;
    p.maxLife = life;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.r = r; p.g = g; p.b = b;
    p.gravity = gravity;
  }

  updateParticles(dt) {
    const ps = this.particles;
    for (let i = 0; i < ps.maxCount; i++) {
      const p = ps.pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        ps.positions[i * 3 + 1] = -999;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const ratio = p.life / p.maxLife;
      ps.positions[i * 3] = p.x;
      ps.positions[i * 3 + 1] = p.y;
      ps.positions[i * 3 + 2] = p.z;
      ps.colors[i * 3] = p.r * ratio;
      ps.colors[i * 3 + 1] = p.g * ratio;
      ps.colors[i * 3 + 2] = p.b * ratio;
    }
    ps.geo.attributes.position.needsUpdate = true;
    ps.geo.attributes.color.needsUpdate = true;
  }

  setPostFX(nitroAmount, speedNorm) {
    this.gradePass.uniforms.uNitro.value = THREE.MathUtils.lerp(this.gradePass.uniforms.uNitro.value, nitroAmount, 0.14);
    this.gradePass.uniforms.uSpeed.value = THREE.MathUtils.lerp(this.gradePass.uniforms.uSpeed.value, speedNorm, 0.14);
  }

  applyTrackAtmosphere(trackConfig) {
    this.scene.fog = new THREE.FogExp2(trackConfig.fogColor, trackConfig.fogDensity);
    this.ambientLight.color.set(trackConfig.ambientColor);
    this.sunLight.color.set(trackConfig.sunColor);

    const hdriUrl = trackConfig.hdri || '/env/dusk.hdr';
    this.currentTrackHdri = hdriUrl;
    const cached = this.hdriCache.get(hdriUrl);
    if (cached) {
      this.scene.environment = cached.env;
      this.scene.background = cached.bg;
      this.scene.backgroundIntensity = 0.88;
    } else {
      this.scene.background = new THREE.Color(trackConfig.fogColor);
      this._loadHdri(hdriUrl, false);
    }
  }

  applyShowroomAtmosphere() {
    this.scene.fog = new THREE.FogExp2('#0b0e14', 0.022);
    this.scene.background = new THREE.Color('#0c1018');
    const studio = this.hdriCache.get('/env/studio.hdr');
    this.scene.environment = studio ? studio.env : this.fallbackEnvRT.texture;
    this.setPostFX(0, 0);
  }

  setMode(mode) {
    this.currentMode = mode;
    this.showroomGroup.visible = mode === 'showroom';
    this.raceGroup.visible = mode === 'race';
    if (mode === 'showroom') {
      this.applyShowroomAtmosphere();
      this.bloomPass.strength = 0.12;
      this.sunLight.intensity = 0.65;
    } else {
      this.bloomPass.strength = 0.16;
      this.sunLight.intensity = 1.55;
    }
  }

  updateShadowFollow(targetPos, sunPos) {
    const dir = new THREE.Vector3(...sunPos).normalize().multiplyScalar(130);
    this.sunLight.position.copy(targetPos).add(dir);
    this.sunLight.target.position.copy(targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  render() {
    this.composer.render();
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}
