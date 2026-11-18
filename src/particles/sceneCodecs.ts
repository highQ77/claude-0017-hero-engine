/** 粒子元件的場景檔存讀規則：ParticleEmitter（ParticlePlugin 安裝時登記） */
import { plainCodec, tidy, type ComponentCodec } from '../scene/SceneFile';
import { ParticleEmitter, type ParticleEmitterData, type Range } from './components';

const DEG = 180 / Math.PI;
/** 固定值或 [最小, 最大] 的欄位；角度的存成度 */
const RANGES = ['lifetime', 'speed', 'size', 'rotation', 'angularVelocity'] as const;
const RANGE_DEGREES = new Set<string>(['rotation', 'angularVelocity']);
type RangeKey = (typeof RANGES)[number];

const flat = plainCodec(ParticleEmitter, {
  colors: ['color', 'colorEnd'],
  angles: ['spread'],
  triples: ['direction', 'halfExtents', 'acceleration'],
  choices: { shape: ['point', 'sphere', 'box', 'circle'], blending: ['additive', 'normal'], space: ['world', 'local'] },
  skip: [...RANGES, 'duration', 'texture', 'burstCount', 'aliveCount'],
});

const defaults = ParticleEmitter.create();

function readRange(v: unknown, key: string, toInternal: (n: number) => number): Range {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (ok(v)) return toInternal(v);
  if (Array.isArray(v) && v.length === 2 && v.every(ok)) return [toInternal(v[0]), toInternal(v[1])];
  throw new Error(`${key} 要是數字或 [最小, 最大]，收到 ${JSON.stringify(v)}`);
}

function writeRange(v: Range, toFile: (n: number) => number): number | number[] {
  return typeof v === 'number' ? tidy(toFile(v)) : [tidy(toFile(v[0])), tidy(toFile(v[1]))];
}

/**
 * ParticleEmitter：數值欄位和元件一樣，另外：
 * - lifetime、speed、size、rotation、angularVelocity：數字，或 [最小, 最大] 之間隨機
 * - spread、rotation、angularVelocity 用度（元件裡是弧度）
 * - duration：省略或 null 代表不停止（Infinity）
 * - color、colorEnd：'#rrggbb'；direction、halfExtents、acceleration：[x, y, z]
 * 自訂貼圖（texture）不能存。
 */
export const particleEmitterCodec: ComponentCodec<ParticleEmitterData> = {
  type: ParticleEmitter,
  read(data, ctx) {
    if (data === null || data === undefined) return {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('要是物件');
    const rest: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    const out: Partial<ParticleEmitterData> = {};
    for (const key of RANGES) {
      if (!(key in rest)) continue;
      const deg = RANGE_DEGREES.has(key);
      out[key as RangeKey] = readRange(rest[key], key, deg ? (n) => n / DEG : (n) => n);
      delete rest[key];
    }
    if ('duration' in rest) {
      const d = rest.duration;
      if (d !== null && (typeof d !== 'number' || !(d >= 0)))
        throw new Error(`duration 要是 0 以上的數字，或 null（不停止），收到 ${JSON.stringify(d)}`);
      out.duration = d === null ? Infinity : d;
      delete rest.duration;
    }
    return { ...flat.read(rest, ctx), ...out };
  },
  write(value) {
    const out = flat.write(value) as Record<string, unknown>;
    for (const key of RANGES) {
      const deg = RANGE_DEGREES.has(key);
      const v = writeRange(value[key], deg ? (n) => n * DEG : (n) => n);
      const d = writeRange(defaults[key], deg ? (n) => n * DEG : (n) => n);
      if (JSON.stringify(v) !== JSON.stringify(d)) out[key] = v;
    }
    if (Number.isFinite(value.duration)) out.duration = tidy(value.duration);
    return out;
  },
};

/** 粒子模組提供的所有存讀規則 */
export const particleCodecs: readonly ComponentCodec<never>[] = [
  particleEmitterCodec,
] as unknown as ComponentCodec<never>[];
