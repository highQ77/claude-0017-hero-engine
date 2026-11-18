/**
 * 沙塵：風吹過沙漠，分成兩層粒子。
 * - 塵霧：又大又淡的沙霧，慢慢飄過，讓空氣看起來混濁
 * - 沙粒：貼著地面被吹走的細沙，速度快、沿風向拉長
 * 風會一陣一陣的（陣風時沙變多、變快）。在場景的 setup 裡呼叫 spawnDust(world)；換場景時一起移除。
 * dustSettings 可以在執行中調整（後製面板的「沙塵」區塊就是改它）。
 */
import { type World, define } from '@engine/ecs';
import { ParticleEmitter, type ParticleEmitterData } from '@engine/particles';
import { spawn } from '@engine/render';
import { ecs } from './engine';

/** 風向（水平，會自動正規化）：目前從船尾往船頭、稍微斜吹 */
const WIND = normalize({ x: 1, y: 0, z: 0.35 });
/** 沙塵覆蓋的範圍中心（船身中央） */
const CENTER: [number, number, number] = [3, 0, 0];

/** 沙塵的整體設定：每幀套用到兩層粒子上（1 = 下面寫的原始值） */
export const dustSettings = {
  /** 開關（關閉時停止發射，已經飄出來的沙會跑完） */
  enabled: true,
  /** 濃度：粒子數量與不透明度的倍率 */
  density: 1,
  /** 大小：粒子大小的倍率（1 = 下面寫的原始值） */
  size: 0.6,
  /** 風速：粒子速度的倍率 */
  wind: 1,
};
/** 預設值（「還原」用） */
export const DUST_DEFAULTS = { ...dustSettings };

function normalize(v: { x: number; y: number; z: number }) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

type Range2 = [number, number];

/** 每層沙塵的原始值（每幀依陣風與 dustSettings 算出實際值） */
const DustLayer = define.component('DustLayer', () => ({
  rate: 0,
  speed: [1, 2] as Range2,
  size: [1, 1] as Range2,
  opacity: 1,
  maxParticles: 100,
  /** 陣風時最多增加的比例（0.8 = 多 80%） */
  gust: 0.8,
  time: 0,
}));

/** 0～1 的陣風強度：幾個不同週期的波疊在一起，平常小、偶爾一陣大的 */
function gustAt(t: number): number {
  const w = 0.5 + 0.5 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1.7);
  return w * w;
}

type LayerSettings = Partial<ParticleEmitterData> & { rate: number; speed: Range2; size: Range2; opacity: number };

function spawnLayer(world: World, y: number, settings: LayerSettings, gust: number): void {
  const e = spawn.entity(world, { name: '沙塵', position: [CENTER[0], y, CENTER[2]] }, ParticleEmitter.with(settings));
  // 粒子上限：陣風最強、濃度最高（面板滑桿上限 2）時都放得下
  const maxParticles = Math.ceil(settings.rate * (1 + gust) * 2 * ((settings.lifetime as Range2)[1] ?? 1));
  world.add(e, DustLayer, { ...settings, maxParticles, gust });
}

/** 建立沙塵（塵霧＋沙粒） */
export function spawnDust(world: World): void {
  // 塵霧：大而淡、飄得慢，一般透明（不發光）
  spawnLayer(
    world,
    8,
    {
      shape: 'box',
      halfExtents: { x: 100, y: 8, z: 100 },
      rate: 40,
      lifetime: [10, 16],
      speed: [3, 6],
      direction: { x: WIND.x, y: 0.05, z: WIND.z },
      spread: 0.25,
      size: [16, 30],
      sizeEnd: 1.8,
      rotation: [0, Math.PI * 2],
      angularVelocity: [-0.15, 0.15],
      color: '#b8a07e',
      colorEnd: '#8d7c66',
      opacity: 0.2,
      opacityEnd: 0,
      fadeIn: 0.35,
      blending: 'normal',
    },
    0.6,
  );
  // 沙粒：貼地、快速，沿著風向拉成短線
  spawnLayer(
    world,
    3,
    {
      shape: 'box',
      halfExtents: { x: 75, y: 3, z: 75 },
      rate: 380,
      lifetime: [2, 4],
      speed: [10, 17],
      direction: { x: WIND.x, y: 0.08, z: WIND.z },
      spread: 0.15,
      acceleration: { x: 0, y: -0.6, z: 0 }, // 沙比空氣重，慢慢落下
      size: [0.12, 0.26],
      sizeEnd: 0.6,
      stretch: 2.5,
      color: '#e2cba4',
      colorEnd: '#b59a74',
      opacity: 0.7,
      opacityEnd: 0,
      fadeIn: 0.15,
      blending: 'normal',
    },
    1.2,
  );
}

ecs.each('dust-update', [ParticleEmitter, DustLayer], (_e, em, d, time) => {
  d.time += time.delta;
  const s = dustSettings;
  const gust = 1 + gustAt(d.time) * d.gust;
  em.playing = s.enabled;
  em.maxParticles = d.maxParticles;
  em.rate = d.rate * gust * s.density;
  em.speed = [d.speed[0] * gust * s.wind, d.speed[1] * gust * s.wind];
  em.size = [d.size[0] * s.size, d.size[1] * s.size];
  em.opacity = Math.min(1, d.opacity * Math.sqrt(s.density)); // 濃度主要靠數量，不透明度只加一點
});
