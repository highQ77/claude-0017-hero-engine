import { describe, expect, test } from 'vitest';
import { evalNumber } from '../src/editors/s3d-editor/fields/number';
import {
  defaultGeometry,
  readGeometry,
  readMaterial,
  writeGeometry,
  writeMaterial,
} from '../src/editors/s3d-editor/mesh';
import { SCHEMAS, defaultOf, schemaOf, toFileValue, withDefaults } from '../src/editors/s3d-editor/schemas';
import { cameraCodec, lightCodec } from '../src/render';
import { transformCodec } from '../src/scene';
import { modelCodec } from '../src/assets';
import { animatorCodec } from '../src/animation';
import { colliderCodec, rigidBodyCodec } from '../src/physics/sceneCodecs';
import { particleEmitterCodec } from '../src/particles';
import { audioSourceCodec } from '../src/audio';
import { text3dCodec } from '../src/text3d';
import { uiPanel3dCodec } from '../src/ui3d';
import { cameraLayersCodec, cameraViewportCodec, renderLayerCodec } from '../src/render';
import * as THREE from 'three';
import { colliderLinePoints, fitCollider } from '../src/editors/s3d-editor/colliders';

describe('3D 場景編輯器：數字欄位的算式', () => {
  test('四則運算、括號、負號、科學記號', () => {
    expect(evalNumber('2*1.5')).toBe(3);
    expect(evalNumber(' -(3+1)/2 ')).toBe(-2);
    expect(evalNumber('1e2+.5')).toBe(100.5);
    expect(evalNumber('10/4-1')).toBe(1.5);
  });
  test('看不懂或不是有限數字時回傳 null', () => {
    for (const t of ['', 'abc', '1+', '(1', '1/0', 'alert(1)', '2**3']) expect(evalNumber(t)).toBeNull();
  });
});

describe('3D 場景編輯器：網格欄位', () => {
  test('幾何：讀取時補上預設值，寫回時省略', () => {
    expect(readGeometry({ box: 2 })!.values).toEqual([2, 2, 2]);
    expect(readGeometry({ plane: [4, 2] })!.values).toEqual([4, 2]);
    expect(readGeometry({ sphere: 0.3 })!.values).toEqual([0.3, 32, 16]);
    expect(writeGeometry('box', [2, 2, 2], {})).toEqual({ box: 2 });
    expect(writeGeometry('box', [1, 2, 1], {})).toEqual({ box: [1, 2] }); // 深度省略 = 寬
    expect(writeGeometry('box', [2, 3, 1], {})).toEqual({ box: [2, 3, 1] }); // 深度和寬不同，不能省略
    expect(readGeometry(writeGeometry('box', [2, 3, 1], {}))!.values).toEqual([2, 3, 1]);
    expect(writeGeometry('cylinder', [0.5, 1, 32], {})).toEqual({ cylinder: [0.5, 1] });
    expect(defaultGeometry('sphere')).toEqual({ sphere: 0.5 });
    // rotation、offset 保留
    const g = readGeometry({ cylinder: [0.3, 0.06], rotation: [1.57, 0, 0] })!;
    expect(writeGeometry(g.shape, g.values, g.extra)).toEqual({ cylinder: [0.3, 0.06], rotation: [1.57, 0, 0] });
    expect(readGeometry({ box: 1, sphere: 1 })).toBeNull();
    expect(readGeometry({ banana: 1 })).toBeNull();
  });

  test('材質：顏色或 standard；只有顏色時寫回顏色字串，其他參數保留', () => {
    expect(readMaterial('#FF8800')).toMatchObject({ color: '#ff8800', roughness: 1, metalness: 0 });
    const m = readMaterial({ standard: { color: '#88ccff', metalness: 0.5, opacity: 0.5 } })!;
    expect(m.extra).toEqual({ opacity: 0.5 });
    expect(writeMaterial({ ...m, metalness: 0 })).toEqual({ standard: { color: '#88ccff', opacity: 0.5 } });
    expect(writeMaterial({ color: '#112233', roughness: 1, metalness: 0, emissive: '#000000', extra: {} })).toBe(
      '#112233',
    );
    expect(readMaterial({ basic: { color: '#fff' } })).toBeNull();
    expect(readMaterial('red')).toBeNull();
  });
});

describe('3D 場景編輯器：欄位說明', () => {
  test('預設值和存讀規則一致：用預設值存檔是空物件', () => {
    const codecs = {
      Transform: transformCodec,
      Camera: cameraCodec,
      Light: lightCodec,
      Model: modelCodec,
      Animator: animatorCodec,
      RigidBody: rigidBodyCodec,
      Collider: colliderCodec,
      ParticleEmitter: particleEmitterCodec,
      AudioSource: audioSourceCodec,
      Text3D: text3dCodec,
      UIPanel3D: uiPanel3dCodec,
      RenderLayer: renderLayerCodec,
      CameraLayers: cameraLayersCodec,
      CameraViewport: cameraViewportCodec,
    } as const;
    for (const schema of SCHEMAS) {
      const codec = codecs[schema.name as keyof typeof codecs];
      const full = withDefaults(schema, {});
      const file = Object.fromEntries(schema.fields.map((f) => [f.key, toFileValue(schema, f, full[f.key])]));
      // 讀進來再寫出去：全部都是預設值，所以存檔時全部省略
      const value = { ...codec.type.create(), ...codec.read(file, { entity: 'x', component: schema.name, warn() {} }) };
      expect(codec.write(value as never), schema.name).toEqual({});
    }
  });

  test('燈光：角度用度、陰影解析度是選單（數字）', () => {
    const light = schemaOf('Light')!;
    const angle = light.fields.find((f) => f.key === 'angle')!;
    expect(defaultOf(light, angle)).toBe(30);
    const size = light.fields.find((f) => f.key === 'shadowMapSize')!;
    expect(withDefaults(light, { shadowMapSize: 2048 }).shadowMapSize).toBe('2048');
    expect(toFileValue(light, size, '2048')).toBe(2048);
    expect(withDefaults(light, {}).color).toBe('#ffffff');
  });
});

describe('3D 場景編輯器：碰撞體', () => {
  const base = {
    halfExtents: { x: 1, y: 0.5, z: 2 },
    radius: 0.5,
    halfHeight: 1,
    offset: { x: 0, y: 0, z: 0 },
  };
  const bounds = (pts: number[]) => {
    const box = new THREE.Box3();
    for (let i = 0; i < pts.length; i += 3) box.expandByPoint(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
    return box;
  };

  test('線框的範圍和形狀一致（含位移）', () => {
    const box = colliderLinePoints({ ...base, shape: 'box', offset: { x: 0, y: 1, z: 0 } })!;
    expect(box).toHaveLength(24 * 3); // 12 條邊
    expect(bounds(box).min.toArray()).toEqual([-1, 0.5, -2]);
    expect(bounds(box).max.toArray()).toEqual([1, 1.5, 2]);
    const capsule = bounds(colliderLinePoints({ ...base, shape: 'capsule' })!);
    expect(capsule.max.y).toBeCloseTo(1.5); // 半高 + 半徑
    expect(capsule.max.x).toBeCloseTo(0.5);
    const cone = bounds(colliderLinePoints({ ...base, shape: 'cone' })!);
    expect([cone.min.y, cone.max.y]).toEqual([-1, 1]);
    expect(colliderLinePoints({ ...base, shape: 'trimesh' })).toBeNull();
  });

  test('符合網格大小', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(1, 2, 0.5));
    expect(fitCollider('box', box)).toEqual({ halfExtents: [1, 1, 0.5], offset: [0, 1, 0] });
    expect(fitCollider('sphere', box)).toEqual({ radius: 1, offset: [0, 1, 0] });
    expect(fitCollider('cylinder', box)).toEqual({ radius: 1, halfHeight: 1, offset: [0, 1, 0] });
    // 膠囊：半高扣掉頭尾的半徑
    expect(
      fitCollider('capsule', new THREE.Box3(new THREE.Vector3(-0.3, -1, -0.3), new THREE.Vector3(0.3, 1, 0.3))),
    ).toEqual({
      radius: 0.3,
      halfHeight: 0.7,
    });
    expect(fitCollider('trimesh', box)).toEqual({});
  });
});
