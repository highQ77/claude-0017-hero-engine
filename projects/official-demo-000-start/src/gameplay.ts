/**
 * 遊戲玩法：每幀執行的系統（移動、攝影機、碰撞音效、點擊）與遊戲動作（跳躍、爆炸、攝影機模式…）。
 * 動作由快捷列、選單、鍵盤、3D 控制台共用。
 */
import { AnimationStateMachine, play } from '@engine/animation';
import type { Entity, World } from '@engine/ecs';
import { MathUtils, Vector3 } from '@engine/math';
import { RigidBody } from '@engine/physics';
import { CameraFollow, Light, shakeCamera } from '@engine/render';
import { Transform, math } from '@engine/scene';
import type { UICheckBox, UIJoystick } from '@engine/ui2d';
import { Orbit, Player, Spin, Toy } from './components';
import { audio, ecs, engine, hierarchy, input, physics, physicsPlugin, render, tweens, ui, world } from './engine';
import { burst, explosion, sparks } from './fx';
import { setNavDebugVisible } from './guards';
import { showEnergy } from './hud';
import { ENERGY_REGEN, JUMP_COST, state } from './state';

// ───────── 系統 ─────────

const CENTER = new Vector3();
const velocity = new Vector3();

export function installSystems(): void {
  ecs.each('spin', [Transform, Spin], (_e, t, s, time) =>
    math.rotate(t, [s.x * s.rate * time.delta, s.y * s.rate * time.delta, 0]),
  );

  // 移動：鍵盤／手把，加上手機的虛擬搖桿（HUD 的 stick 或「手機版面」的 mobileStick）
  ecs.each('player-move', [Transform, Player], (_e, t, p, time) => {
    const stick = ui.get<UIJoystick>('mobileStick') ?? ui.get<UIJoystick>('stick');
    const x = MathUtils.clamp(input.actions.axis('moveX') + (stick?.x ?? 0), -1, 1);
    const z = MathUtils.clamp(input.actions.axis('moveZ') + (stick?.y ?? 0), -1, 1);
    t.position.x = MathUtils.clamp(t.position.x + x * p.speed * time.delta, -8, 8);
    t.position.z = MathUtils.clamp(t.position.z + z * p.speed * time.delta, -8, 8);
  });

  // 環繞的攝影機：滾輪縮放
  ecs.each(
    'orbit-camera',
    [Transform, Orbit],
    (_e, t, o, time) => {
      o.radius = MathUtils.clamp(o.radius + input.pointer.wheel * 0.01, 3, 15);
      o.angle += o.speed * time.delta;
      t.position.set(Math.cos(o.angle) * o.radius, o.height, Math.sin(o.angle) * o.radius);
      math.lookAt(t, CENTER);
    },
    { phase: 'lateUpdate' },
  );

  // 碰撞開始時：依撞擊速度播放 3D 落地聲；撞得夠用力就噴火花、畫面輕震
  ecs.addSystem({
    name: 'impacts',
    run(w) {
      for (const ev of physics.collisions) {
        if (!ev.started || ev.sensor) continue;
        for (const e of [ev.a, ev.b]) {
          if (!w.isAlive(e) || !w.has(e, Toy)) continue;
          const speed = physics.getLinearVelocity(e, velocity).length();
          if (speed < 1) continue;
          const p = w.require(e, Transform).position;
          audio.play('sounds/bounce.wav', {
            spatial: { refDistance: 3 },
            position: p,
            volume: Math.min(1, speed / 8) * 0.6,
            randomPitch: 0.15,
          });
          if (speed > 4) {
            burst(w, p, sparks(Math.round(speed * 3)));
            if (state.camera !== null) shakeCamera(w, state.camera, Math.min(0.35, speed * 0.04));
          }
        }
      }
    },
  });

  // 掉出場外的物件直接刪除
  ecs.each('cleanup-fallen', [Toy, Transform], (e, _toy, t) => {
    if (t.position.y < -20) world.defer(() => world.destroy(e));
  });

  // 體力慢慢回復（整數改變才更新畫面）
  ecs.addSystem({
    name: 'energy-regen',
    run(_w, time) {
      if (state.energy >= 100) return;
      const before = Math.round(state.energy);
      state.energy = Math.min(100, state.energy + ENERGY_REGEN * time.delta);
      if (Math.round(state.energy) !== before) showEnergy();
    },
  });

  // 空白鍵：跳躍；B 鍵：金字塔跳一下；點擊：踢飛物件
  ecs.addSystem({
    name: 'player-actions',
    run(w) {
      if (input.actions.wasPressed('jump')) jumpAll();
      if (input.wasPressed('KeyB')) w.query([AnimationStateMachine]).each((_e, sm) => play.trigger(sm, 'bob'));
      if (input.wasPressed('Mouse:Left')) clickWorld(w);
    },
  });
}

/** 點到 3D 物件：球與箱子踢飛、金字塔跳一下、方塊彈一下（金幣由 Coin 腳本自己處理） */
function clickWorld(w: World): void {
  const hit = render.pick(input.pointer.ndcX, input.pointer.ndcY);
  if (!hit) return;
  // 點到的可能是外觀子實體：往上找到有剛體的那個
  const e = w.has(hit.entity, RigidBody) ? hit.entity : (hierarchy.parentOf(hit.entity) ?? hit.entity);
  const sm = w.get(e, AnimationStateMachine);
  if (w.has(e, Toy)) {
    const cam = w.require(render.activeCamera!, Transform).position;
    const away = hit.point.clone().sub(cam).setY(0).normalize().multiplyScalar(4);
    physics.setLinearVelocity(e, { x: away.x, y: 7, z: away.z });
    physics.setAngularVelocity(e, { x: Math.random() * 10 - 5, y: Math.random() * 10 - 5, z: Math.random() * 10 - 5 });
    audio.play('sounds/jump.wav', { volume: 0.5, pitch: 1.4 });
  } else if (sm) {
    play.trigger(sm, 'bob');
    audio.play('sounds/jump.wav', { volume: 0.5, pitch: 0.7 });
  } else if (w.has(e, Player)) {
    audio.play('sounds/pop.wav', { group: 'ui', volume: 0.6 });
    squash(e);
  }
}

/** 彈一下：先壓扁再用彈性曲線回復 */
function squash(e: Entity): void {
  const scale = world.require(e, Transform).scale;
  tweens.killTweensOf(scale);
  tweens.play(
    tweens
      .timeline()
      .to(scale, { x: 1.4, y: 0.7, z: 1.4 }, { duration: 0.08, easing: 'quadOut' })
      .to(scale, { x: 1, y: 1, z: 1 }, { duration: 0.6, easing: 'elasticOut' }),
    { entity: e },
  );
}

// ───────── 動作 ─────────

/** 上次提示體力不足的時間（遊戲時間，避免一直跳提示） */
let lowEnergyNotice = -Infinity;

/** 所有物件往上彈；體力不夠時不會跳 */
export function jumpAll(): void {
  if (state.energy < JUMP_COST) {
    if (engine.time.elapsed - lowEnergyNotice > 1.2) {
      lowEnergyNotice = engine.time.elapsed;
      ui.toast('體力不足，休息一下吧', { icon: 'bolt', color: '#ffb347', duration: 1.2 });
    }
    return;
  }
  state.energy -= JUMP_COST;
  showEnergy();
  audio.play('sounds/jump.wav', { volume: 0.5, randomPitch: 0.05 });
  world.query([Toy]).each((e) => {
    const v = physics.getLinearVelocity(e, velocity);
    physics.setLinearVelocity(e, {
      x: v.x + (Math.random() - 0.5),
      y: 5 + Math.random() * 2,
      z: v.z + (Math.random() - 0.5),
    });
  });
}

const _lightPos = new Vector3();

/**
 * 方塊底下的燈光不跟著刪掉：脫離方塊、留在原地，爆炸時閃一下再慢慢熄滅（亮度 0，但燈還在）。
 * 效能：場景裡的燈數一改變，所有受光照的材質都要重新編譯著色器，爆炸那一刻畫面會卡住。
 * 燈留著、只把亮度降到 0 就不會重新編譯（換場景時跟著場景一起移除）。
 */
function keepLights(target: Entity): void {
  const lights: Entity[] = [];
  hierarchy.forEachDescendant(target, (e) => {
    if (world.has(e, Light)) lights.push(e);
  });
  for (const e of lights) {
    const light = world.require(e, Light);
    const t = world.require(e, Transform);
    t.worldMatrix.decompose(_lightPos, t.rotation, t.scale);
    hierarchy.setParent(e, null);
    t.position.copy(_lightPos);
    light.intensity *= 4; // 爆炸的閃光
    tweens.to(light, { intensity: 0 }, { duration: 1.2, easing: 'quadOut', entity: e });
  }
}

/** 方塊先溶解（補間溶解著色器的 progress 0 → 1），再爆炸 */
export function explodePlayer(): boolean {
  const target = state.player;
  if (target === null || !state.playerMaterial) return false;
  state.player = null;
  tweens.to(
    state.playerMaterial.uniforms.progress,
    { value: 1 },
    {
      duration: 0.9,
      easing: 'quadIn',
      entity: target,
      onComplete: () => {
        const p = world.require(target, Transform).position;
        keepLights(target);
        burst(world, p, explosion());
        if (state.camera !== null) shakeCamera(world, state.camera, 0.8);
        audio.play('sounds/bounce.wav', { volume: 1, pitch: 0.4 });
        world.destroy(target);
      },
    },
  );
  return true;
}

/** 攝影機：跟隨方塊（CameraFollow）或自動環繞（Orbit）；場景裡沒有方塊時維持環繞 */
export function applyCameraMode(): void {
  const cam = state.camera;
  if (cam === null || !world.isAlive(cam)) return;
  if (state.followCamera && state.player !== null) {
    world.remove(cam, Orbit);
    world.add(cam, CameraFollow, {
      target: state.player,
      offset: new Vector3(0, 4.5, 7),
      lookOffset: new Vector3(0, 0, 0),
      smoothTime: 0.35,
      bounds: { min: new Vector3(-9.5, 1, -9.5), max: new Vector3(9.5, 12, 9.5) }, // 不要拍到牆外
    });
  } else {
    world.remove(cam, CameraFollow);
    if (!world.has(cam, Orbit)) world.add(cam, Orbit);
  }
}

export function toggleCamera(): void {
  state.followCamera = !state.followCamera;
  applyCameraMode();
  ui.toast(
    !state.followCamera
      ? '攝影機：自動環繞'
      : state.player !== null
        ? '攝影機：跟隨方塊（WASD 移動）'
        : '這個場景沒有方塊：攝影機維持環繞',
    { duration: 1.4 },
  );
}

/** 碰撞形狀與導航網格 */
export function toggleDebug(): void {
  physicsPlugin.debug = !physicsPlugin.debug;
  setNavDebugVisible(world, physicsPlugin.debug);
}

export function toggleMusic(): void {
  audio.setMuted('music', !audio.isMuted('music'));
  const toggle = ui.get<UICheckBox>('musicToggle');
  if (toggle) toggle.checked = !audio.isMuted('music');
}
