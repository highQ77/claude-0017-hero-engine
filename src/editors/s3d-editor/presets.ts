/** 「＋」選單：可以加入的物件 */
import type { SceneFileEntity } from '../../scene';
import { ParticleEmitter, ParticlePresets, particleEmitterCodec } from '../../particles';
import { defaultGeometry } from './mesh';

/** 粒子特效：引擎的預設（ParticlePresets）換成場景檔的寫法 */
const particles =
  (name: string, preset: keyof typeof ParticlePresets, override: Record<string, unknown> = {}): Preset['make'] =>
  (p) => ({
    name,
    components: {
      Transform: { position: [p[0], p[1] + 0.1, p[2]] },
      ParticleEmitter: particleEmitterCodec.write({
        ...ParticleEmitter.create(),
        ...ParticlePresets[preset](),
        ...override,
      }),
    },
  });

export interface Preset {
  /** 選單顯示的文字 */
  label: string;
  /** 新實體的 id 開頭 */
  id: string;
  /** 建立實體（position 是放置的位置） */
  make(position: number[]): Omit<SceneFileEntity, 'id'>;
}

const mesh =
  (shape: string, name: string, color: string, y = 0.5): Preset['make'] =>
  (p) => ({
    name,
    components: {
      Transform: { position: [p[0], p[1] + y, p[2]] },
      MeshRenderer: { geometry: defaultGeometry(shape), material: color, castShadow: true, receiveShadow: true },
    },
  });

/** 分組：[群組名稱, 項目] */
export const PRESETS: readonly (readonly [string, readonly Preset[]])[] = [
  [
    '基本',
    [{ label: '空物件', id: 'empty', make: (p) => ({ name: '空物件', components: { Transform: { position: p } } }) }],
  ],
  [
    '形狀',
    [
      { label: '方塊', id: 'box', make: mesh('box', '方塊', '#c8d0c0') },
      { label: '球', id: 'sphere', make: mesh('sphere', '球', '#c8d0c0') },
      { label: '圓柱', id: 'cylinder', make: mesh('cylinder', '圓柱', '#c8d0c0') },
      { label: '圓錐', id: 'cone', make: mesh('cone', '圓錐', '#c8d0c0') },
      { label: '膠囊', id: 'capsule', make: mesh('capsule', '膠囊', '#c8d0c0', 0.8) },
      { label: '甜甜圈', id: 'torus', make: mesh('torus', '甜甜圈', '#c8d0c0') },
      {
        label: '平面',
        id: 'plane',
        make: (p) => ({
          name: '平面',
          components: {
            Transform: { position: p, rotation: [-90, 0, 0] },
            MeshRenderer: { geometry: { plane: 4 }, material: '#5a6b52', receiveShadow: true },
          },
        }),
      },
    ],
  ],
  [
    '燈光',
    [
      {
        label: '平行光',
        id: 'sun',
        make: (p) => ({
          name: '平行光',
          components: {
            Transform: { position: [p[0] + 5, p[1] + 10, p[2] + 5], rotation: [-60, 30, 0] },
            Light: { castShadow: true },
          },
        }),
      },
      {
        label: '點光源',
        id: 'point',
        make: (p) => ({
          name: '點光源',
          components: { Transform: { position: [p[0], p[1] + 2, p[2]] }, Light: { kind: 'point', intensity: 5 } },
        }),
      },
      {
        label: '聚光燈',
        id: 'spot',
        make: (p) => ({
          name: '聚光燈',
          components: {
            Transform: { position: [p[0], p[1] + 4, p[2]], rotation: [-90, 0, 0] },
            Light: { kind: 'spot', intensity: 20 },
          },
        }),
      },
      {
        label: '半球光',
        id: 'ambient',
        make: () => ({ name: '半球光', components: { Light: { kind: 'hemisphere', intensity: 0.6 } } }),
      },
    ],
  ],
  [
    '特效',
    [
      { label: '火焰', id: 'fire', make: particles('火焰', 'fire') },
      { label: '煙霧', id: 'smoke', make: particles('煙霧', 'smoke') },
      // 引擎的火花預設是用程式一次發射（rate 0）；放在場景裡改成持續噴出
      { label: '火花', id: 'sparks', make: particles('火花', 'sparks', { rate: 40 }) },
    ],
  ],
  [
    '其他',
    [
      {
        label: '攝影機',
        id: 'camera',
        make: (p) => ({
          name: '攝影機',
          components: { Transform: { position: [p[0], p[1] + 2, p[2] + 6] }, Camera: {} },
        }),
      },
    ],
  ],
];
