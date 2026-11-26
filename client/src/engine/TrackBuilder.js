import * as THREE from 'three';
import { modelLoader } from './ModelLoader.js';

function createBuildingFacadeTexture(styleIndex = 0) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');

  // 3 distinct realistic urban facade palettes (steel-blue glass, warm granite, dark architectural glass)
  const bases = ['#0d1522', '#171920', '#101824'];
  const mullions = ['#1b283b', '#272a34', '#1e2c3e'];
  const palettes = [
    ['#ffdfa8', '#ffecc8', '#d6e8ff', '#a8c8f0'],
    ['#ffe0a3', '#ffd28e', '#f5e6cc', '#c9d8eb'],
    ['#d8ecff', '#fff0cf', '#bcd4f0', '#ffe4b5']
  ];

  ctx.fillStyle = bases[styleIndex % 3];
  ctx.fillRect(0, 0, 256, 512);

  ctx.fillStyle = mullions[styleIndex % 3];
  const stepX = styleIndex === 1 ? 24 : 32;
  const stepY = styleIndex === 2 ? 18 : 22;
  for (let x = 0; x < 256; x += stepX) ctx.fillRect(x, 0, 3, 512);
  for (let y = 0; y < 512; y += stepY) ctx.fillRect(0, y, 256, 4);

  const pal = palettes[styleIndex % 3];
  for (let y = 5; y < 504; y += stepY) {
    const floorLit = Math.random() < 0.62;
    for (let x = 4; x < 248; x += stepX) {
      if (floorLit && Math.random() < 0.32) {
        ctx.fillStyle = pal[Math.floor(Math.random() * pal.length)];
        ctx.globalAlpha = 0.22 + Math.random() * 0.52;
        ctx.fillRect(x, y, stepX - 7, stepY - 8);
      }
    }
  }
  ctx.globalAlpha = 1.0;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const texLoader = new THREE.TextureLoader();

function loadPbrTex(url, isColor = false, repeatX = 1, repeatY = 1) {
  const tex = texLoader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 16;
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRoadMarkingsTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  // Crisp outer white highway edge lines
  ctx.fillStyle = 'rgba(235, 240, 248, 0.85)';
  ctx.fillRect(14, 0, 8, 512);
  ctx.fillRect(490, 0, 8, 512);
  // Crisp dashed center lane divider
  ctx.fillStyle = 'rgba(225, 230, 238, 0.72)';
  for (let y = 0; y < 512; y += 128) {
    ctx.fillRect(253, y + 18, 6, 62);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function createLampPoolTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0.0, 'rgba(255, 224, 172, 0.34)');
  g.addColorStop(0.45, 'rgba(255, 200, 130, 0.14)');
  g.addColorStop(1.0, 'rgba(255, 180, 100, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createBillboardTexture(text, accentHex) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f3b2e';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#e8eef5';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 140);
  ctx.fillStyle = '#f5f8fc';
  ctx.font = '800 46px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 76);
  ctx.fillStyle = accentHex;
  ctx.fillRect(60, 118, 392, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createAsphaltTextures(theme) {
  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  ctx.fillStyle = theme === 'night' ? '#1c1f26' : '#282a30';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 45000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 22 + Math.floor(Math.random() * 34);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle racing-line rubber wear & center seam
  const wearGrad = ctx.createLinearGradient(0, 0, size, 0);
  wearGrad.addColorStop(0, 'rgba(0,0,0,0)');
  wearGrad.addColorStop(0.24, 'rgba(8,8,10,0.38)');
  wearGrad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
  wearGrad.addColorStop(0.76, 'rgba(8,8,10,0.38)');
  wearGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wearGrad;
  ctx.fillRect(0, 0, size, size);

  // Outer highway edge lines
  ctx.fillStyle = 'rgba(225, 230, 238, 0.84)';
  ctx.fillRect(26, 0, 14, size);
  ctx.fillRect(size - 40, 0, 14, size);

  // Dashed lane divider
  ctx.fillStyle = 'rgba(220, 224, 232, 0.68)';
  for (let y = 0; y < size; y += 128) {
    ctx.fillRect(size * 0.5 - 5, y + 18, 10, 62);
  }

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.wrapS = THREE.RepeatWrapping;
  colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.anisotropy = 16;

  // Damp puddle roughness map
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 512;
  const rctx = roughCanvas.getContext('2d');
  rctx.fillStyle = theme === 'night' ? '#868686' : '#b8b8b8';
  rctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 480; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const rx = 10 + Math.random() * 44;
    const ry = 24 + Math.random() * 75;
    const v = theme === 'night' ? 30 + Math.random() * 62 : 135 + Math.random() * 60;
    rctx.fillStyle = `rgba(${v},${v},${v},0.22)`;
    rctx.beginPath();
    rctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    rctx.fill();
  }
  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = THREE.RepeatWrapping;
  roughTex.wrapT = THREE.RepeatWrapping;

  // Tangent-Space Asphalt Normal Map
  const nSize = 256;
  const normCanvas = document.createElement('canvas');
  normCanvas.width = nSize;
  normCanvas.height = nSize;
  const nctx = normCanvas.getContext('2d');
  const imgData = nctx.createImageData(nSize, nSize);
  const d = imgData.data;
  for (let i = 0; i < nSize * nSize; i++) {
    const nx = (Math.random() - 0.5) * 46;
    const ny = (Math.random() - 0.5) * 46;
    d[i * 4] = 128 + nx;
    d[i * 4 + 1] = 128 + ny;
    d[i * 4 + 2] = 242;
    d[i * 4 + 3] = 255;
  }
  nctx.putImageData(imgData, 0, 0);
  const normalTex = new THREE.CanvasTexture(normCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(4, 4);

  return { colorTex, roughTex, normalTex };
}

function createKerbTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#b41c2e' : '#a8b0bf';
    ctx.fillRect(0, i * 64, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCheckeredTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  const sq = 16;
  for (let y = 0; y < 64; y += sq) {
    for (let x = 0; x < 256; x += sq) {
      ctx.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#e8edf5' : '#11131a';
      ctx.fillRect(x, y, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Track {
  constructor(config) {
    this.config = config;
    this.group = new THREE.Group();
    this.roadWidth = config.roadWidth;
    this.halfWidth = config.roadWidth * 0.5;
    this.samples = [];
    this.countdownLights = [];
    this.waterUniforms = null;

    const controlPts = config.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(controlPts, true, 'catmullrom', 0.45);
    this.totalLength = this.curve.getLength();
    this.sampleCount = 480;

    this._precomputeSamples();
    this._buildRoadAndBarriers();
    this._buildCatsEyeStuds();
    this._buildStartFinishGantry();
    this._buildEnvironment();
  }

  update(timeSec) {
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value = timeSec;
    }
  }

  _precomputeSamples() {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.sampleCount; i++) {
      const t = i / this.sampleCount;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const normal = new THREE.Vector3().crossVectors(right, tangent).normalize();
      this.samples.push({ t, pos, tangent, right, normal });
    }
  }

  _buildRoadAndBarriers() {
    const N = this.sampleCount;
    const hw = this.halfWidth;
    const kerbW = 1.65;
    const wallOffset = hw + kerbW + 1.4;
    const wallH = 1.55;

    const roadPositions = [];
    const roadNormals = [];
    const roadUvs = [];
    const roadIndices = [];

    const kerbPositions = [];
    const kerbNormals = [];
    const kerbUvs = [];
    const kerbIndices = [];

    const wallPositions = [];
    const wallNormals = [];
    const wallUvs = [];
    const wallIndices = [];

    const railPositionsL = [];
    const railPositionsR = [];
    const fencePositionsL = [];
    const fencePositionsR = [];

    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const vCoord = (i / N) * (this.totalLength / 18);

      const pL = s.pos.clone().addScaledVector(s.right, -hw);
      const pR = s.pos.clone().addScaledVector(s.right, hw);
      roadPositions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
      roadNormals.push(s.normal.x, s.normal.y, s.normal.z, s.normal.x, s.normal.y, s.normal.z);
      roadUvs.push(0, vCoord, 1, vCoord);

      const kLOut = s.pos.clone().addScaledVector(s.right, -(hw + kerbW)).add(new THREE.Vector3(0, 0.08, 0));
      const kROut = s.pos.clone().addScaledVector(s.right, hw + kerbW).add(new THREE.Vector3(0, 0.08, 0));
      kerbPositions.push(
        kLOut.x, kLOut.y, kLOut.z, pL.x, pL.y + 0.04, pL.z,
        pR.x, pR.y + 0.04, pR.z, kROut.x, kROut.y, kROut.z
      );
      for (let k = 0; k < 4; k++) kerbNormals.push(s.normal.x, s.normal.y, s.normal.z);
      const kv = (i / N) * (this.totalLength / 10);
      kerbUvs.push(0, kv, 1, kv, 0, kv, 1, kv);

      const wLB = s.pos.clone().addScaledVector(s.right, -wallOffset);
      const wLT = wLB.clone().add(new THREE.Vector3(0, wallH, 0));
      const wRB = s.pos.clone().addScaledVector(s.right, wallOffset);
      const wRT = wRB.clone().add(new THREE.Vector3(0, wallH, 0));

      wallPositions.push(
        wLB.x, wLB.y, wLB.z, wLT.x, wLT.y, wLT.z,
        wRB.x, wRB.y, wRB.z, wRT.x, wRT.y, wRT.z
      );
      wallNormals.push(
        s.right.x, 0, s.right.z, s.right.x, 0, s.right.z,
        -s.right.x, 0, -s.right.z, -s.right.x, 0, -s.right.z
      );
      const wu = (i / N) * (this.totalLength / 16);
      wallUvs.push(wu, 0, wu, 1, wu, 0, wu, 1);

      if (i < N) {
        const bi = i * 2;
        roadIndices.push(bi, bi + 1, bi + 2, bi + 1, bi + 3, bi + 2);

        const ki = i * 4;
        kerbIndices.push(ki, ki + 1, ki + 4, ki + 1, ki + 5, ki + 4);
        kerbIndices.push(ki + 2, ki + 3, ki + 6, ki + 3, ki + 7, ki + 6);

        const wi = i * 4;
        wallIndices.push(wi, wi + 4, wi + 1, wi + 1, wi + 4, wi + 5);
        wallIndices.push(wi + 2, wi + 3, wi + 6, wi + 3, wi + 7, wi + 6);
      }

      railPositionsL.push(wLT.clone().add(new THREE.Vector3(0, 0.08, 0)));
      railPositionsR.push(wRT.clone().add(new THREE.Vector3(0, 0.08, 0)));
      fencePositionsL.push(wLT.clone().add(new THREE.Vector3(0, 1.05, 0)));
      fencePositionsR.push(wRT.clone().add(new THREE.Vector3(0, 1.05, 0)));
    }

    // Real Scanned Poly Haven Photogrammetry Track Asphalt PBR Material!
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);

    const asphaltDiff = loadPbrTex('/textures/asphalt_diff.jpg', true, 3, 2);
    const asphaltNor = loadPbrTex('/textures/asphalt_nor.jpg', false, 3, 2);
    const asphaltRough = loadPbrTex('/textures/asphalt_rough.jpg', false, 3, 2);

    const roadMat = new THREE.MeshStandardMaterial({
      map: asphaltDiff,
      normalMap: asphaltNor,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: asphaltRough,
      color: this.config.theme === 'night' ? new THREE.Color(0x9aa2b0) : new THREE.Color(0xc8cbd0),
      roughness: this.config.theme === 'night' ? 0.58 : 0.84,
      metalness: this.config.theme === 'night' ? 0.14 : 0.05
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    // Crisp Highway Lane Markings Overlay on top of scanned asphalt
    const markingsMat = new THREE.MeshStandardMaterial({
      map: createRoadMarkingsTexture(),
      transparent: true,
      roughness: 0.72,
      metalness: 0.05,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });
    const markingsMesh = new THREE.Mesh(roadGeo, markingsMat);
    markingsMesh.position.y = 0.015;
    markingsMesh.receiveShadow = true;
    this.group.add(markingsMesh);

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.9, side: THREE.BackSide });
    const deckMesh = new THREE.Mesh(roadGeo, deckMat);
    deckMesh.position.y = -0.35;
    this.group.add(deckMesh);

    // Kerbs
    const kerbGeo = new THREE.BufferGeometry();
    kerbGeo.setAttribute('position', new THREE.Float32BufferAttribute(kerbPositions, 3));
    kerbGeo.setAttribute('normal', new THREE.Float32BufferAttribute(kerbNormals, 3));
    kerbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(kerbUvs, 2));
    kerbGeo.setIndex(kerbIndices);
    const kerbMat = new THREE.MeshStandardMaterial({
      map: createKerbTexture(),
      roughness: 0.85,
      metalness: 0.04
    });
    const kerbMesh = new THREE.Mesh(kerbGeo, kerbMat);
    kerbMesh.receiveShadow = true;
    this.group.add(kerbMesh);

    // Real Scanned Poly Haven Precast Concrete Jersey Barriers!
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
    wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wallNormals, 3));
    wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUvs, 2));
    wallGeo.setIndex(wallIndices);
    const wallMat = new THREE.MeshStandardMaterial({
      map: loadPbrTex('/textures/concrete_diff.jpg', true, 1, 1),
      normalMap: loadPbrTex('/textures/concrete_nor.jpg', false, 1, 1),
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: loadPbrTex('/textures/concrete_rough.jpg', false, 1, 1),
      color: new THREE.Color(0x8c929c),
      metalness: 0.08,
      roughness: 0.88,
      side: THREE.DoubleSide
    });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    this.group.add(wallMesh);

    // Satin galvanized steel top guardrail + upper highway catch-rail
    const railSteelMat = new THREE.MeshStandardMaterial({
      color: 0x7e8794,
      metalness: 0.56,
      roughness: 0.58
    });
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPositionsL, true), 300, 0.10, 6, true), railSteelMat));
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPositionsR, true), 300, 0.10, 6, true), railSteelMat));
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fencePositionsL, true), 300, 0.055, 5, true), railSteelMat));
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fencePositionsR, true), 300, 0.055, 5, true), railSteelMat));

    this._buildCornerChevrons();
  }

  _buildCatsEyeStuds() {
    // Instanced reflective highway cat's-eye studs along center line & edges (classic Wangan Expressway look!)
    const studGeo = new THREE.BoxGeometry(0.16, 0.045, 0.24);
    const amberMat = new THREE.MeshBasicMaterial({ color: 0xffc048 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xe6f2ff });

    const step = 4;
    const count = Math.floor(this.sampleCount / step);
    const centerStuds = new THREE.InstancedMesh(studGeo, amberMat, count);
    const edgeStuds = new THREE.InstancedMesh(studGeo, whiteMat, count * 2);

    const dummy = new THREE.Object3D();
    let ci = 0;
    let ei = 0;
    for (let i = 0; i < this.sampleCount; i += step) {
      const s = this.samples[i];
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);

      // Center amber cat's eye
      dummy.position.set(s.pos.x, s.pos.y + 0.03, s.pos.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      centerStuds.setMatrixAt(ci++, dummy.matrix);

      // Left & right white shoulder reflectors
      for (const side of [-1, 1]) {
        const p = s.pos.clone().addScaledVector(s.right, side * (this.halfWidth - 0.55));
        dummy.position.set(p.x, p.y + 0.03, p.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        edgeStuds.setMatrixAt(ei++, dummy.matrix);
      }
    }
    this.group.add(centerStuds);
    this.group.add(edgeStuds);
  }

  _buildCornerChevrons() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#14171f';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#f5b800';
    for (let i = 0; i < 3; i++) {
      const ox = 22 + i * 76;
      ctx.beginPath();
      ctx.moveTo(ox, 16);
      ctx.lineTo(ox + 34, 16);
      ctx.lineTo(ox + 60, 64);
      ctx.lineTo(ox + 34, 112);
      ctx.lineTo(ox, 112);
      ctx.lineTo(ox + 26, 64);
      ctx.closePath();
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const chevronMat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(0xffc422),
      emissiveIntensity: 0.45,
      roughness: 0.45
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x262a34, roughness: 0.7 });

    const N = this.sampleCount;
    for (let i = 0; i < N; i += 8) {
      const sPrev = this.samples[(i - 4 + N) % N];
      const sCurr = this.samples[i];
      const sNext = this.samples[(i + 4) % N];
      const crossY = sPrev.tangent.x * sNext.tangent.z - sPrev.tangent.z * sNext.tangent.x;
      if (Math.abs(crossY) > 0.095) {
        const outsideSide = crossY > 0 ? -1 : 1;
        const pos = sCurr.pos.clone().addScaledVector(sCurr.right, outsideSide * (this.halfWidth + 4.0));
        const yaw = Math.atan2(sCurr.tangent.x, sCurr.tangent.z);

        const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.35, 0.14), chevronMat);
        board.position.set(pos.x, pos.y + 2.35, pos.z);
        board.rotation.y = yaw + Math.PI + (outsideSide * 0.25);
        this.group.add(board);

        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), postMat);
        post.position.set(pos.x, pos.y + 1.1, pos.z);
        this.group.add(post);
      }
    }
  }

  _buildStartFinishGantry() {
    const s = this.samples[0];
    const gantry = new THREE.Group();
    gantry.position.copy(s.pos);
    gantry.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);

    const span = this.roadWidth + 7.5;
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1d212c, metalness: 0.75, roughness: 0.35 });

    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 11.5, 2.2), pillarMat);
      pillar.position.set(side * (span / 2), 5.5, 0);
      pillar.castShadow = true;
      gantry.add(pillar);
    }

    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.5, 2.4, 2.6), pillarMat);
    beam.position.set(0, 10.5, 0);
    beam.castShadow = true;
    gantry.add(beam);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(span - 2, 1.8),
      new THREE.MeshBasicMaterial({ map: createCheckeredTexture(), side: THREE.DoubleSide })
    );
    banner.position.set(0, 10.5, -1.36);
    gantry.add(banner);
    const bannerBack = banner.clone();
    bannerBack.position.z = 1.36;
    gantry.add(bannerBack);

    const lineMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.roadWidth, 3.2),
      new THREE.MeshBasicMaterial({ map: createCheckeredTexture() })
    );
    lineMesh.rotation.x = -Math.PI / 2;
    lineMesh.position.y = 0.06;
    gantry.add(lineMesh);

    this.countdownLights = [];
    for (let i = -2; i <= 2; i++) {
      const podMat = new THREE.MeshBasicMaterial({ color: 0x222530 });
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), podMat);
      pod.position.set(i * 2.2, 8.9, 1.4);
      gantry.add(pod);
      this.countdownLights.push(podMat);
    }

    this.group.add(gantry);
  }

  setCountdownLights(litCount, go = false) {
    for (let i = 0; i < this.countdownLights.length; i++) {
      if (go) {
        this.countdownLights[i].color.setHex(0x00ff88);
      } else if (i < litCount) {
        this.countdownLights[i].color.setHex(0xff1e33);
      } else {
        this.countdownLights[i].color.setHex(0x222530);
      }
    }
  }

  _buildAnimatedOcean() {
    const waterGeo = new THREE.PlaneGeometry(3200, 3200, 1, 1);
    this.waterUniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color(this.config.theme === 'night' ? '#071426' : '#132033') },
      uSkyColor: { value: new THREE.Color(this.config.theme === 'night' ? '#1c3456' : '#5e4652') },
      uSunColor: { value: new THREE.Color(this.config.sunColor) },
      uSunDir: { value: new THREE.Vector3(...this.config.sunPos).normalize() }
    };
    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uSkyColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;

        void main() {
          vec2 p = vWorldPos.xz * 0.055;
          float w1 = sin(p.x * 1.4 + uTime * 1.1) * cos(p.y * 1.1 - uTime * 0.8);
          float w2 = sin(p.x * 3.1 - p.y * 2.3 + uTime * 1.7) * 0.45;
          vec3 N = normalize(vec3((w1 + w2) * 0.09, 1.0, (w1 - w2) * 0.09));

          vec3 V = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);
          vec3 col = mix(uDeepColor, uSkyColor * 0.75, clamp(fresnel, 0.0, 0.78));

          // Soft shimmering golden twilight water glints
          vec3 H = normalize(normalize(uSunDir) + V);
          float spec = pow(max(dot(N, H), 0.0), 72.0);
          col += uSunColor * min(0.35, spec * 0.45);

          // Cool twilight bay horizon mist
          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-dist * dist * 0.00000032);
          col = mix(col, uSkyColor * 0.48, clamp(fogFactor, 0.0, 0.82));

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = this.config.waterLevel;
    this.group.add(water);
  }

  _buildEnvironment() {
    this._buildAnimatedOcean();

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x262c3a, metalness: 0.65, roughness: 0.42 });
    const lampMat = new THREE.MeshBasicMaterial({
      color: this.config.theme === 'night' ? 0xffe8c2 : 0xffddaa
    });
    const lampPoolMat = new THREE.MeshBasicMaterial({
      map: createLampPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const poolGeo = new THREE.PlaneGeometry(18, 22);
    poolGeo.rotateX(-Math.PI / 2);

    // Streetlamps + warm sodium asphalt light pools + catch-fence posts
    for (let i = 16; i < this.sampleCount; i += 24) {
      const s = this.samples[i];
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);

      for (const side of [-1, 1]) {
        const base = s.pos.clone().addScaledVector(s.right, side * (this.halfWidth + 4.4));
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.20, 9.5, 6), poleMat);
        pole.position.set(base.x, base.y + 4.75, base.z);
        this.group.add(pole);

        const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 0.22), poleMat);
        arm.position.set(
          base.x - s.right.x * side * 1.4,
          base.y + 9.4,
          base.z - s.right.z * side * 1.4
        );
        arm.rotation.y = yaw;
        this.group.add(arm);

        const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.42), lampMat);
        bulb.position.set(
          base.x - s.right.x * side * 2.4,
          base.y + 9.28,
          base.z - s.right.z * side * 2.4
        );
        bulb.rotation.y = yaw;
        this.group.add(bulb);
      }

      // Warm golden streetlamp light pool on the wet asphalt (creates alternating light/shadow rhythm!)
      const pool = new THREE.Mesh(poolGeo, lampPoolMat);
      pool.position.set(s.pos.x, s.pos.y + 0.045, s.pos.z);
      pool.rotation.y = yaw;
      this.group.add(pool);

      if (s.pos.y > this.config.waterLevel + 3) {
        const h = s.pos.y - this.config.waterLevel;
        const col = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 2.6), poleMat);
        col.position.set(s.pos.x, this.config.waterLevel + h / 2 - 0.35, s.pos.z);
        this.group.add(col);
      }
    }

    if (this.config.theme === 'night') {
      this._buildTokyoSkyline();
    } else {
      this._buildAlpineMountains();
    }
  }

  _buildTokyoSkyline() {
    const facadeMats = [0, 1, 2].map((idx) => {
      const tex = createBuildingFacadeTexture(idx);
      return new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(idx === 1 ? 0xffe4c4 : 0xfff0dd),
        emissiveIntensity: 0.44,
        metalness: 0.72,
        roughness: 0.26
      });
    });
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x3b4252, metalness: 0.8, roughness: 0.35 });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2211 });
    const seed = (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };

    for (let i = 0; i < 95; i++) {
      const angle = (i / 95) * Math.PI * 2 + seed(i) * 0.1;
      const dist = 430 + seed(i + 100) * 350;
      const cx = 140 + Math.cos(angle) * dist;
      const cz = 10 + Math.sin(angle) * dist;
      const w = 22 + seed(i + 200) * 36;
      const d = 22 + seed(i + 300) * 36;
      const h = 68 + seed(i + 400) * 230;

      const mat = facadeMats[i % facadeMats.length];
      const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      baseMesh.position.set(cx, this.config.waterLevel + h / 2, cz);
      this.group.add(baseMesh);

      // Multi-tiered architectural setback crown & rooftop spire on tall towers!
      if (h > 135) {
        const crownH = 18 + seed(i + 500) * 28;
        const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, crownH, d * 0.68), mat);
        crown.position.set(cx, this.config.waterLevel + h + crownH / 2, cz);
        this.group.add(crown);

        const spireH = 18 + seed(i + 600) * 26;
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.1, spireH, 6), spireMat);
        spire.position.set(cx, this.config.waterLevel + h + crownH + spireH / 2, cz);
        this.group.add(spire);

        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.95, 6, 6), beaconMat);
        beacon.position.set(cx, this.config.waterLevel + h + crownH + spireH + 0.5, cz);
        this.group.add(beacon);
      }
    }

    // Place Blender steel-truss highway gantries & cleanly mounted overhead expressway signs
    const slogans = [
      ['TOKYO BAY EXPRESS', '#ffaa22'],
      ['WANGAN SOUTH 2KM', '#ffaa22'],
      ['APEX GT3 CIRCUIT', '#e62238'],
      ['PIT LANE AHEAD', '#ffaa22']
    ];
    for (let i = 48; i < this.sampleCount; i += 80) {
      const s = this.samples[i];
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);

      const arch = modelLoader.getClone('cyber-arch');
      if (arch) {
        arch.position.copy(s.pos);
        arch.rotation.y = yaw;
        this.group.add(arch);
      }

      const [text, col] = slogans[(i / 80 | 0) % slogans.length];
      const boardTex = createBillboardTexture(text, col);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(11.5, 3.2),
        new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide })
      );
      const fwdOffset = s.tangent.clone().multiplyScalar(-0.85);
      board.position.set(s.pos.x + fwdOffset.x, s.pos.y + 9.2, s.pos.z + fwdOffset.z);
      board.rotation.y = yaw + Math.PI;
      this.group.add(board);
    }
  }

  _buildAlpineMountains() {
    const rockMat = new THREE.MeshStandardMaterial({
      map: loadPbrTex('/textures/rock_diff.jpg', true, 4, 4),
      normalMap: loadPbrTex('/textures/rock_nor.jpg', false, 4, 4),
      roughness: 0.92,
      metalness: 0.04
    });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xffece2, roughness: 0.72 });
    const seed = (n) => {
      const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
      return x - Math.floor(x);
    };

    for (let i = 0; i < 46; i++) {
      const angle = (i / 46) * Math.PI * 2;
      const dist = 460 + seed(i + 20) * 360;
      const cx = -120 + Math.cos(angle) * dist;
      const cz = -20 + Math.sin(angle) * dist;
      const r = 75 + seed(i + 50) * 115;
      const h = 115 + seed(i + 90) * 215;

      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), rockMat);
      cone.position.set(cx, this.config.waterLevel + h / 2 - 10, cz);
      cone.rotation.y = seed(i) * Math.PI;
      this.group.add(cone);

      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.34, h * 0.34, 7), snowMat);
      cap.position.set(cx, this.config.waterLevel + h * 0.83 - 10, cz);
      cap.rotation.y = cone.rotation.y;
      this.group.add(cap);
    }

    // Instanced Alpine Evergreen Pine Forest lining the circuit flanks
    const pineGeo = new THREE.ConeGeometry(2.6, 11.5, 7);
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x162b22, roughness: 0.88 });
    const treeCount = 160;
    const pines = new THREE.InstancedMesh(pineGeo, pineMat, treeCount);
    const dummy = new THREE.Object3D();
    for (let t = 0; t < treeCount; t++) {
      const s = this.samples[(t * 3) % this.sampleCount];
      const side = t % 2 === 0 ? 1 : -1;
      const offset = this.halfWidth + 10 + seed(t + 77) * 24;
      const p = s.pos.clone().addScaledVector(s.right, side * offset);
      const scale = 0.7 + seed(t + 19) * 0.85;
      dummy.position.set(p.x, p.y + 4.8 * scale - 1.2, p.z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = seed(t) * Math.PI;
      dummy.updateMatrix();
      pines.setMatrixAt(t, dummy.matrix);
    }
    this.group.add(pines);
  }

  getSampleAtProgress(t) {
    const wrapped = ((t % 1) + 1) % 1;
    const idx = Math.floor(wrapped * this.sampleCount) % this.sampleCount;
    return this.samples[idx];
  }

  getStartGridTransform(gridIndex) {
    const row = Math.floor(gridIndex / 2);
    const col = gridIndex % 2 === 0 ? -1 : 1;
    const distBack = 10 + row * 11;
    const t = (((-distBack / this.totalLength) % 1) + 1) % 1;
    const pos = this.curve.getPointAt(t);
    const tangent = this.curve.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

    const spawnPos = pos.clone().addScaledVector(right, col * 3.8);
    spawnPos.y += 0.45;
    const yaw = Math.atan2(tangent.x, tangent.z);
    return { position: spawnPos, yaw, t };
  }

  projectPoint(pos, hintIndex = -1) {
    const N = this.sampleCount;
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex >= 0) {
      const window = 24;
      for (let offset = -window; offset <= window; offset++) {
        const i = ((hintIndex + offset) % N + N) % N;
        const p = this.samples[i].pos;
        const dx = pos.x - p.x;
        const dz = pos.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
      if (bestDistSq > 1600) {
        hintIndex = -1;
      }
    }

    if (hintIndex < 0) {
      for (let i = 0; i < N; i++) {
        const p = this.samples[i].pos;
        const dx = pos.x - p.x;
        const dz = pos.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    const s = this.samples[bestIdx];
    const rel = new THREE.Vector3().subVectors(pos, s.pos);
    const lateralOffset = rel.dot(s.right);
    const forwardOffset = rel.dot(s.tangent);
    const t = (((bestIdx + forwardOffset / (this.totalLength / N)) / N) % 1 + 1) % 1;

    const nextIdx = (bestIdx + (forwardOffset >= 0 ? 1 : -1) + N) % N;
    const segLen = this.totalLength / N;
    const alpha = Math.min(1, Math.max(0, Math.abs(forwardOffset) / segLen));
    const height = THREE.MathUtils.lerp(s.pos.y, this.samples[nextIdx].pos.y, alpha);

    return { sample: s, index: bestIdx, t, lateralOffset, distSq: bestDistSq, height };
  }
}
