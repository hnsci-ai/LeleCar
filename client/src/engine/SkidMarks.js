import * as THREE from 'three';

function createSkidTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0.0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.20, 'rgba(8,8,10,0.78)');
  grad.addColorStop(0.50, 'rgba(5,5,7,0.88)');
  grad.addColorStop(0.80, 'rgba(8,8,10,0.78)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 64);

  // Softly feather front/back edges so adjacent quads blend into smooth continuous rubber ribbons
  const vGrad = ctx.createLinearGradient(0, 0, 0, 64);
  vGrad.addColorStop(0.0, 'rgba(0,0,0,1)');
  vGrad.addColorStop(0.14, 'rgba(0,0,0,0)');
  vGrad.addColorStop(0.86, 'rgba(0,0,0,0)');
  vGrad.addColorStop(1.0, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, 32, 64);

  return new THREE.CanvasTexture(c);
}

/**
 * Velocity-aligned pooled tire skidmarks supporting both rear (drift/wheelspin)
 * and front (understeer/ABS braking) axles with continuous speed-scaled rubber ribbons.
 */
export class SkidMarks {
  constructor(parentGroup, maxQuads = 1400) {
    this.maxQuads = maxQuads;
    this.cursor = 0;

    const geo = new THREE.PlaneGeometry(0.36, 1.0);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      map: createSkidTexture(),
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, maxQuads);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    dummy.position.set(0, -999, 0);
    dummy.updateMatrix();
    for (let i = 0; i < maxQuads; i++) {
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this._dummy = dummy;
    parentGroup.add(this.mesh);
  }

  /**
   * Stamps a pair of left/right tire marks at the true wheel contact patches,
   * aligned along the tire's actual travel direction (velYaw) for smooth drift curves.
   */
  stampAxle(pos, chassisYaw, velYaw, axleOffsetZ = -1.28, halfTrack = 0.90, segLength = 1.4, intensity = 1.0) {
    const fwdX = Math.sin(chassisYaw);
    const fwdZ = Math.cos(chassisYaw);
    const leftX = Math.cos(chassisYaw);
    const leftZ = -Math.sin(chassisYaw);

    const clampedLen = Math.max(0.75, Math.min(3.6, segLength));
    const widthScale = 0.62 + Math.min(1, Math.max(0.15, intensity)) * 0.65;

    for (const side of [-halfTrack, halfTrack]) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.maxQuads;
      this._dummy.position.set(
        pos.x + leftX * side + fwdX * axleOffsetZ,
        pos.y + 0.048,
        pos.z + leftZ * side + fwdZ * axleOffsetZ
      );
      this._dummy.rotation.set(0, velYaw, 0);
      this._dummy.scale.set(widthScale, 1, clampedLen);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(idx, this._dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Backward-compatible simple stamp
  stamp(pos, yaw) {
    this.stampAxle(pos, yaw, yaw, -1.28, 0.90, 1.55, 0.85);
  }

  clear() {
    this._dummy.position.set(0, -999, 0);
    this._dummy.scale.set(1, 1, 1);
    this._dummy.updateMatrix();
    for (let i = 0; i < this.maxQuads; i++) {
      this.mesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
