import type { ColorRepresentation, Texture } from 'three';
import { defineComponent } from '../ecs/Component';

/** 固定值，或 [最小, 最大] 之間隨機 */
export type Range = number | readonly [number, number];

/** 發射範圍：一個點、球、方塊、圓 */
export type EmitterShape = 'point' | 'sphere' | 'box' | 'circle';

/**
 * 粒子發射器。所有欄位都可以在執行中修改（maxParticles 改變會重建）。
 */
export interface ParticleEmitterData {
  /** 同時存在的粒子上限 */
  maxParticles: number;
  /** 每秒發射數量 */
  rate: number;
  /** 持續發射幾秒；Infinity 為不停止 */
  duration: number;
  /** duration 結束後重新開始 */
  loop: boolean;
  /** false 時停止發射（已發射的粒子會跑完） */
  playing: boolean;
  /** 下一幀一次發射的數量（用 burst() 設定） */
  burstCount: number;

  /** 粒子壽命（秒） */
  lifetime: Range;
  /** 初速 */
  speed: Range;
  /** 發射方向（相對於實體） */
  direction: { x: number; y: number; z: number };
  /** 方向的擴散角（弧度）：0 為直線，Math.PI 為四面八方 */
  spread: number;

  /** 發射位置的形狀 */
  shape: EmitterShape;
  /** sphere、circle 的半徑 */
  radius: number;
  /** box 的半邊長 */
  halfExtents: { x: number; y: number; z: number };

  /** 加速度（例如重力 { x: 0, y: -9.8, z: 0 }，火焰往上可給正值） */
  acceleration: { x: number; y: number; z: number };
  /** 空氣阻力，每秒減少的速度比例 */
  drag: number;

  /** 起始大小（世界單位） */
  size: Range;
  /** 結束時的大小倍率 */
  sizeEnd: number;
  /** 起始旋轉（弧度） */
  rotation: Range;
  /** 旋轉速度（弧度／秒） */
  angularVelocity: Range;
  /** 沿速度方向拉長（火花、雨滴）；0 為不拉長 */
  stretch: number;

  /** 粒子剛出現時的顏色 */
  color: ColorRepresentation;
  /** 粒子消失前的顏色（中間漸變） */
  colorEnd: ColorRepresentation;
  /** 粒子剛出現時的不透明度 */
  opacity: number;
  /** 粒子消失前的不透明度 */
  opacityEnd: number;
  /** 前多少比例的壽命從透明淡入（煙霧常用） */
  fadeIn: number;
  /** 亮度倍率；大於 1 搭配光暈效果會發光 */
  intensity: number;

  /** 貼圖；null 為內建的柔和圓點 */
  texture: Texture | null;
  /** additive：疊加發光（火、火花）；normal：一般透明（煙） */
  blending: 'additive' | 'normal';
  /**
   * world：粒子發射後留在原地（移動時拖出軌跡）
   * local：粒子跟著發射器移動
   */
  space: 'world' | 'local';
  /** 不循環且全部粒子消失後，自動銷毀實體（一次性特效） */
  autoDestroy: boolean;

  /** 由系統填寫：目前存活的粒子數 */
  aliveCount: number;
}

/** 粒子發射器元件（ParticlePresets 有火、煙、火花、爆炸等預設） */
export const ParticleEmitter = defineComponent<ParticleEmitterData>('ParticleEmitter', () => ({
  maxParticles: 500,
  rate: 20,
  duration: Infinity,
  loop: true,
  playing: true,
  burstCount: 0,
  lifetime: [1, 2],
  speed: [1, 2],
  direction: { x: 0, y: 1, z: 0 },
  spread: 0.3,
  shape: 'point',
  radius: 0.5,
  halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
  acceleration: { x: 0, y: 0, z: 0 },
  drag: 0,
  size: 0.2,
  sizeEnd: 1,
  rotation: 0,
  angularVelocity: 0,
  stretch: 0,
  color: 0xffffff,
  colorEnd: 0xffffff,
  opacity: 1,
  opacityEnd: 0,
  fadeIn: 0,
  intensity: 1,
  texture: null,
  blending: 'additive',
  space: 'world',
  autoDestroy: false,
  aliveCount: 0,
}));

/** 一次發射 count 個粒子（例如爆炸、撞擊火花） */
export function burst(emitter: ParticleEmitterData, count: number): void {
  emitter.burstCount += count;
}

/**
 * 常用特效的設定，搭配 ParticleEmitter.with(ParticlePresets.fire()) 使用，
 * 也可以展開後覆蓋部分欄位：{ ...ParticlePresets.fire(), rate: 80 }
 */
export const ParticlePresets = {
  /** 火焰：往上飄、由黃轉紅、疊加發光 */
  fire: (): Partial<ParticleEmitterData> => ({
    rate: 60,
    lifetime: [0.5, 1.0],
    speed: [0.6, 1.2],
    spread: 0.25,
    shape: 'circle',
    radius: 0.15,
    acceleration: { x: 0, y: 1.5, z: 0 },
    size: [0.25, 0.4],
    sizeEnd: 0.2,
    angularVelocity: [-2, 2],
    color: 0xffd36b,
    colorEnd: 0xff3a10,
    opacity: 0.9,
    opacityEnd: 0,
    intensity: 2.5,
    blending: 'additive',
  }),
  /** 煙霧：緩慢上升、變大、淡入淡出 */
  smoke: (): Partial<ParticleEmitterData> => ({
    rate: 12,
    lifetime: [2, 3.5],
    speed: [0.3, 0.6],
    spread: 0.3,
    shape: 'circle',
    radius: 0.2,
    acceleration: { x: 0.15, y: 0.3, z: 0 },
    drag: 0.3,
    size: [0.3, 0.5],
    sizeEnd: 4,
    rotation: [0, Math.PI * 2],
    angularVelocity: [-0.4, 0.4],
    color: 0x7a7a7a,
    colorEnd: 0x3a3a3a,
    opacity: 0.45,
    opacityEnd: 0,
    fadeIn: 0.15,
    blending: 'normal',
  }),
  /** 火花：高速、受重力、沿速度拉長 */
  sparks: (): Partial<ParticleEmitterData> => ({
    rate: 0,
    lifetime: [0.3, 0.7],
    speed: [3, 7],
    spread: 0.9,
    acceleration: { x: 0, y: -9.8, z: 0 },
    drag: 0.5,
    size: [0.03, 0.06],
    sizeEnd: 0.5,
    stretch: 0.08,
    color: 0xfff1b0,
    colorEnd: 0xff7a1a,
    opacity: 1,
    opacityEnd: 0,
    intensity: 4,
    blending: 'additive',
  }),
  /** 爆炸：一次性、四面八方、自動銷毀 */
  explosion: (): Partial<ParticleEmitterData> => ({
    rate: 0,
    burstCount: 120,
    duration: 0,
    loop: false,
    lifetime: [0.4, 1.1],
    speed: [2, 9],
    spread: Math.PI,
    shape: 'sphere',
    radius: 0.2,
    drag: 2.5,
    size: [0.2, 0.55],
    sizeEnd: 2,
    rotation: [0, Math.PI * 2],
    color: 0xffe08a,
    colorEnd: 0xb3260a,
    opacity: 1,
    opacityEnd: 0,
    intensity: 3,
    blending: 'additive',
    autoDestroy: true,
  }),
};
