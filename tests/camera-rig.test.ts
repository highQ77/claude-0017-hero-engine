import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/ecs';
import { Hierarchy, HierarchyKey, Transform } from '../src/scene';
import { CameraFollow, CameraRig, CameraShake, shakeCamera } from '../src/render/CameraRig';

function setup() {
  const world = new World();
  world.setResource(HierarchyKey, new Hierarchy(world));
  const rig = new CameraRig(world);
  const target = world.spawn(Transform.at(2, 0, 0));
  const cam = world.spawn(Transform);
  return { world, rig, target, cam };
}

/** 攝影機看的方向（-Z） */
const forward = (t: { rotation: THREE.Quaternion }) => new THREE.Vector3(0, 0, -1).applyQuaternion(t.rotation);

describe('攝影機跟隨', () => {
  test('第一幀直接就位、看著目標；之後平滑跟上', () => {
    const { world, rig, target, cam } = setup();
    world.add(cam, CameraFollow, { target, offset: new THREE.Vector3(0, 3, 6), lookOffset: new THREE.Vector3() });
    rig.updateFollow(1 / 60);
    const t = world.require(cam, Transform);
    expect(t.position.toArray()).toEqual([2, 3, 6]);
    const toTarget = new THREE.Vector3(2, 0, 0).sub(t.position).normalize();
    expect(forward(t).dot(toTarget)).toBeCloseTo(1, 5);
    // 目標移動：攝影機往新位置靠近，但不會一幀就到
    world.require(target, Transform).position.x = 12;
    rig.updateFollow(1 / 60);
    expect(t.position.x).toBeGreaterThan(2);
    expect(t.position.x).toBeLessThan(12);
    for (let i = 0; i < 300; i++) rig.updateFollow(1 / 60);
    expect(t.position.x).toBeCloseTo(12, 3);
  });

  test('smoothTime 0 立刻跟上；bounds 限制範圍；snap 下一幀直接就位', () => {
    const { world, rig, target, cam } = setup();
    const f = world.add(cam, CameraFollow, {
      target,
      smoothTime: 0,
      offset: new THREE.Vector3(0, 0, 5),
      bounds: { min: new THREE.Vector3(-5, -5, -5), max: new THREE.Vector3(5, 5, 5) },
    });
    rig.updateFollow(1 / 60);
    const t = world.require(cam, Transform);
    expect(t.position.toArray()).toEqual([2, 0, 5]);
    world.require(target, Transform).position.x = 100;
    rig.updateFollow(1 / 60);
    expect(t.position.x).toBe(5); // 被範圍擋住
    f.smoothTime = 10;
    f.bounds = null;
    rig.snap(cam);
    rig.updateFollow(1 / 60);
    expect(t.position.x).toBe(100);
  });

  test("offsetSpace 'target'：跟著目標的左右轉向（跟在背後）", () => {
    const { world, rig, target, cam } = setup();
    world.add(cam, CameraFollow, { target, smoothTime: 0, offsetSpace: 'target', offset: new THREE.Vector3(0, 2, 5) });
    const tt = world.require(target, Transform);
    tt.position.set(0, 0, 0);
    tt.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // 轉 90 度
    rig.updateFollow(1 / 60);
    const p = world.require(cam, Transform).position;
    expect(p.x).toBeCloseTo(5, 5);
    expect(p.y).toBeCloseTo(2, 5);
    expect(p.z).toBeCloseTo(0, 5);
  });

  test('攝影機有父節點：換算成相對父節點的位置', () => {
    const { world, rig, target, cam } = setup();
    const holder = world.spawn(Transform.at(10, 0, 0));
    world.requireResource(HierarchyKey).setParent(cam, holder);
    world.add(cam, CameraFollow, { target, smoothTime: 0, offset: new THREE.Vector3(0, 0, 4) });
    rig.updateFollow(1 / 60);
    // 世界位置是 [2, 0, 4]：相對父節點 [10, 0, 0] 是 [-8, 0, 4]
    expect(world.require(cam, Transform).position.toArray()).toEqual([-8, 0, 4]);
  });

  test('目標被銷毀或沒有目標時不動', () => {
    const { world, rig, target, cam } = setup();
    world.add(cam, CameraFollow, { target });
    world.destroy(target);
    world.require(cam, Transform).position.set(1, 1, 1);
    rig.updateFollow(1 / 60);
    expect(world.require(cam, Transform).position.toArray()).toEqual([1, 1, 1]);
  });
});

describe('攝影機晃動', () => {
  test('只改繪製用的攝影機、慢慢停下來、不改 Transform', () => {
    const { world, rig, cam } = setup();
    const obj = new THREE.PerspectiveCamera();
    shakeCamera(world, cam, 0.8);
    shakeCamera(world, cam, 0.8);
    expect(world.require(cam, CameraShake).trauma).toBe(1); // 最多到 1
    obj.matrix.identity();
    rig.updateShake(1 / 60, () => obj);
    expect(obj.matrix.equals(new THREE.Matrix4())).toBe(false);
    expect(world.require(cam, Transform).position.toArray()).toEqual([0, 0, 0]);
    for (let i = 0; i < 120; i++) rig.updateShake(1 / 60, () => obj);
    expect(world.require(cam, CameraShake).trauma).toBe(0);
    obj.matrix.identity();
    rig.updateShake(1 / 60, () => obj);
    expect(obj.matrix.equals(new THREE.Matrix4())).toBe(true); // 停下來後不再改
  });

  test('options 可以改晃動的設定', () => {
    const { world, cam } = setup();
    shakeCamera(world, cam, 0.3, { maxAngle: 10, decay: 0.5 });
    const s = world.require(cam, CameraShake);
    expect(s.maxAngle).toBe(10);
    expect(s.decay).toBe(0.5);
    expect(s.trauma).toBeCloseTo(0.3);
  });
});
