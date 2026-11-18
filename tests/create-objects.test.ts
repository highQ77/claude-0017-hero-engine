/**
 * 不用 import three 就能建立的物件：create.mesh／group／points、自訂頂點的幾何、toon／normal 材質、
 * 畫布貼圖、模型動畫片段 create.clip。
 */
import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { create } from '../src';

describe('create.mesh／group／points', () => {
  test('網格：描述轉成幾何與材質，並套用名稱、位置、旋轉、縮放、陰影', () => {
    const m = create.mesh({ box: [1, 2, 3] }, '#ff0000', {
      name: 'arm',
      position: [1, 2, 3],
      rotation: [0, Math.PI, 0],
      scale: 2,
      castShadow: true,
    });
    expect(m).toBeInstanceOf(THREE.Mesh);
    expect(m.name).toBe('arm');
    expect(m.position.toArray()).toEqual([1, 2, 3]);
    expect(m.rotation.y).toBeCloseTo(Math.PI);
    expect(m.scale.toArray()).toEqual([2, 2, 2]);
    expect(m.castShadow).toBe(true);
    expect((m.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  });

  test('群組：第一個參數可以是設定，其他是子物件', () => {
    const a = create.mesh({ sphere: 0.5 });
    const b = create.mesh({ box: 1 });
    const g = create.group({ name: 'robot', position: [0, 1, 0] }, a, b);
    expect(g.name).toBe('robot');
    expect(g.position.y).toBe(1);
    expect(g.children).toEqual([a, b]);
  });

  test('點雲：接受 [x, y, z] 陣列或攤平的數字', () => {
    const p1 = create.points([
      [0, 0, 0],
      [1, 2, 3],
    ]);
    const p2 = create.points([0, 0, 0, 1, 2, 3], { size: 0.2, blending: 'additive' });
    expect(p1.geometry.getAttribute('position').count).toBe(2);
    expect(p2.geometry.getAttribute('position').getZ(1)).toBe(3);
    expect((p2.material as THREE.PointsMaterial).size).toBe(0.2);
    expect((p2.material as THREE.PointsMaterial).blending).toBe(THREE.AdditiveBlending);
  });
});

describe('描述的新種類', () => {
  test('vertices：自訂頂點，沒給法線時自動計算；數量不對時說明', () => {
    const g = create.geometry({ vertices: [-1, 0, 0, 1, 0, 0, 0, 1, 0], colors: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    expect(g.getAttribute('position').count).toBe(3);
    expect(g.getAttribute('color').count).toBe(3);
    expect(g.getAttribute('normal').getZ(0)).toBeCloseTo(1);
    expect(() => create.geometry({ vertices: [0, 0] })).toThrow(/3 的倍數/);
    expect(() => create.geometry({ vertices: [0, 0, 0], colors: [1, 0] })).toThrow(/colors 要有 3 個數字/);
  });

  test('toon、normal 材質', () => {
    expect(create.material({ toon: { color: '#00ff00' } })).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(create.material({ normal: { wireframe: true } }).wireframe).toBe(true);
  });

  test('貼圖可以給畫布，pixelated 為最近點取樣', () => {
    const canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
    const t = create.texture(canvas, { pixelated: true, repeat: 2 });
    expect(t).toBeInstanceOf(THREE.CanvasTexture);
    expect(t.magFilter).toBe(THREE.NearestFilter);
    expect(t.repeat.toArray()).toEqual([2, 2]);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});

describe('create.clip', () => {
  test('依屬性選擇軌道種類；rotation 轉成四元數', () => {
    const clip = create.clip('test', {
      'arm.rotation': {
        times: [0, 1],
        values: [
          [0, 0, 0],
          [0, 0, Math.PI / 2],
        ],
      },
      'arm.position': {
        times: [0, 2],
        values: [
          [0, 0, 0],
          [0, 1, 0],
        ],
      },
      'arm.visible': { times: [0, 1], values: [true, false] },
      'arm.material.opacity': { times: [0, 1], values: [1, 0], interpolation: 'step' },
      'arm.material.color': { times: [0, 1], values: ['#ff0000', '#0000ff'] },
    });
    const [rot, pos, vis, op, col] = clip.tracks;
    expect(clip.duration).toBe(2);
    expect(rot).toBeInstanceOf(THREE.QuaternionKeyframeTrack);
    expect(rot.name).toBe('arm.quaternion');
    expect(rot.values[6]).toBeCloseTo(Math.sin(Math.PI / 4)); // 第二個時間點的 z
    expect(pos).toBeInstanceOf(THREE.VectorKeyframeTrack);
    expect(vis).toBeInstanceOf(THREE.BooleanKeyframeTrack);
    expect(op).toBeInstanceOf(THREE.NumberKeyframeTrack);
    expect(op.getInterpolation()).toBe(THREE.InterpolateDiscrete);
    expect(col).toBeInstanceOf(THREE.ColorKeyframeTrack);
  });

  test('時間點和數值數量不一樣時說明', () => {
    expect(() => create.clip('bad', { '.position': { times: [0, 1], values: [[0, 0, 0]] } })).toThrow(/數量要一樣/);
  });

  test('播放：mixer 依名稱找到物件', () => {
    const arm = create.mesh({ box: 1 }, '#fff', { name: 'arm' });
    const root = create.group(arm);
    const clip = create.clip('up', {
      'arm.position': {
        times: [0, 1],
        values: [
          [0, 0, 0],
          [0, 2, 0],
        ],
      },
    });
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(0.5);
    expect(arm.position.y).toBeCloseTo(1);
  });
});
