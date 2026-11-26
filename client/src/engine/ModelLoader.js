import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { CARS } from '../../../shared/config.js';

class ModelLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');
    this.loader.setDRACOLoader(this.dracoLoader);

    this.cache = new Map();
    this.readyPromise = null;
  }

  async preloadAll() {
    if (this.readyPromise) return this.readyPromise;
    const targets = [
      ...CARS.map((c) => ({ key: c.id, url: `/models/${c.id}.glb` })),
      { key: 'cyber-arch', url: '/models/cyber-arch.glb' }
    ];

    this.readyPromise = Promise.all(
      targets.map(
        ({ key, url }) =>
          new Promise((resolve) => {
            this.loader.load(
              url,
              (gltf) => {
                gltf.scene.traverse((child) => {
                  if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material) {
                      const mats = Array.isArray(child.material) ? child.material : [child.material];
                      for (const m of mats) {
                        if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.25;
                      }
                    }
                  }
                });
                this.cache.set(key, gltf.scene);
                resolve(true);
              },
              undefined,
              () => {
                resolve(false);
              }
            );
          })
      )
    );
    return this.readyPromise;
  }

  getClone(key) {
    const src = this.cache.get(key);
    if (!src) return null;
    const clone = src.clone(true);
    // Clone brake light materials so each car's brake lights animate independently
    clone.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) =>
            (m.name && m.name.startsWith('BrakeLight_')) ? m.clone() : m
          );
        } else if (
          child.name.includes('BrakeLight') ||
          (child.material.name && child.material.name.startsWith('BrakeLight_'))
        ) {
          child.material = child.material.clone();
        }
      }
    });
    return clone;
  }
}

export const modelLoader = new ModelLoader();
