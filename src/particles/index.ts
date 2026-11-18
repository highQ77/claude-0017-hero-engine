import { burst } from './components';
import { createParticleGeometry, createParticleMaterial, defaultParticleTexture } from './ParticleMaterial';
export { ParticleEmitter, ParticlePresets } from './components';
export { particleEmitterCodec } from './sceneCodecs';
export type { ParticleEmitterData, Range, EmitterShape } from './components';
export { ParticleController } from './ParticleController';

export { ParticlePlugin, ParticlesKey, PARTICLE_PRIORITY } from './ParticlePlugin';

// ───────── 小工具函式（依用途分類）─────────

/** 播放：動畫、觸發器、音效、粒子爆發（particles 模組的部分；總入口 hero.play 有全部） */
export const play = {
  /** 粒子發射器立刻噴出一批粒子 */
  burst: burst,
} as const;

/** 建立物件：幾何、材質、貼圖、設定…（particles 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 建立粒子用的幾何（自訂粒子繪製時用） */
  particleGeometry: createParticleGeometry,
  /** 建立粒子用的材質（自訂粒子繪製時用） */
  particleMaterial: createParticleMaterial,
  /** 預設的圓形粒子貼圖 */
  particleTexture: defaultParticleTexture,
} as const;
