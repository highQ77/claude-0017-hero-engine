/**
 * 視覺效果：自訂著色器、一次性的粒子特效、浮出的文字、空中漂浮的光點。
 */
import type { Entity, World } from '@engine/ecs';
import { Color, type Vector3 } from '@engine/math';
import { ParticleEmitter, type ParticleEmitterData, ParticlePresets } from '@engine/particles';
import { spawn } from '@engine/render';
import { Transform } from '@engine/scene';
import { EffectPresets, ShaderPresets } from '@engine/shaders';
import { Text3D } from '@engine/text3d';
import { shaders, tweens } from './engine';

// ───────── 著色器 ─────────

shaders
  .define(ShaderPresets.dissolve())
  .define(ShaderPresets.hologram())
  .define(ShaderPresets.wave({ color: 0xc8463c, roughness: 0.7, side: 'double' }))
  .defineEffect(EffectPresets.chromaticAberration())
  .defineEffect(EffectPresets.rainOnWindow())
  .defineEffect(EffectPresets.pixelate());

/** 自己寫的例子：在地上往外擴散的脈衝光環（半透明疊加） */
shaders.define({
  name: 'pulseRing',
  base: 'unlit',
  options: { transparent: true, depthWrite: false, blending: 'additive' },
  uniforms: { ringColor: new Color(1.0, 0.55, 0.15), speed: 0.8, rings: 3 },
  fragment: /* glsl */ `
    float r = length(vUv - 0.5) * 2.0;                     // 0 = 中心，1 = 外緣
    float wave = fract(r * rings - uTime * speed);         // 往外擴散的條紋
    float band = smoothstep(0.0, 0.15, wave) * (1.0 - smoothstep(0.15, 0.5, wave));
    float fade = 1.0 - smoothstep(0.6, 1.0, r);            // 外緣淡出
    color = vec4(ringColor * 3.0, band * fade);
  `,
});

export { shaders };

// ───────── 粒子 ─────────

/** 在某個位置放一次粒子特效：播完自動刪除 */
export function burst(world: World, position: Vector3, settings: Partial<ParticleEmitterData>): Entity {
  return spawn.entity(
    world,
    { position },
    ParticleEmitter.with({ duration: 0, loop: false, autoDestroy: true, ...settings }),
  );
}

/** 火花（撞擊、撿金幣） */
export const sparks = (count: number, color?: number, colorEnd?: number) => ({
  ...ParticlePresets.sparks(),
  burstCount: count,
  ...(color !== undefined ? { color } : {}),
  ...(colorEnd !== undefined ? { colorEnd } : {}),
});

/** 爆炸（循環的預設改成只放一次） */
export const explosion = () => ParticlePresets.explosion();

/**
 * 空中慢慢飄動的光點：讓場景有空氣感、看得出空間的深度。
 * 放在場景裡（setup 時建立），換場景時一起移除。
 */
export function ambientMotes(world: World, color = '#ffe2a8'): Entity {
  return spawn.entity(
    world,
    { position: [0, 2.5, 0] },
    ParticleEmitter.with({
      shape: 'box',
      halfExtents: { x: 9, y: 2.5, z: 9 },
      rate: 14,
      maxParticles: 220,
      lifetime: [6, 10],
      speed: [0.05, 0.15],
      spread: Math.PI,
      size: [0.03, 0.07],
      sizeEnd: 0.02,
      color,
      colorEnd: color,
      opacity: 0.55,
      opacityEnd: 0,
      fadeIn: 0.25,
      intensity: 2,
      blending: 'additive',
    }),
  );
}

// ───────── 浮出的文字 ─────────

/** 在某個位置浮出一段文字（例如撿到金幣的「+1」）：往上飄、縮小後刪除 */
export function floatText(world: World, position: Vector3, text: string, color = '#ffd75e'): void {
  const e = spawn.entity(
    world,
    { position: [position.x, position.y + 0.5, position.z] },
    Text3D.with({ mode: 'flat', text, size: 0.38, billboard: true, color, fontWeight: 'bold' }),
  );
  const t = world.require(e, Transform);
  tweens.to(t.position, { y: t.position.y + 1.1 }, { duration: 0.9, easing: 'quadOut', entity: e });
  tweens.to(
    t.scale,
    { x: 0, y: 0, z: 0 },
    { duration: 0.3, delay: 0.6, easing: 'backIn', entity: e, onComplete: () => world.destroy(e) },
  );
}
