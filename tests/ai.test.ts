import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, World, type Entity } from '../src/ecs';
import { ScenePlugin, Transform, math } from '../src/scene';
import { Collider, PhysicsPlugin, RigidBody } from '../src/physics';
import {
  AIPlugin,
  BT,
  BehaviorTree,
  Brain,
  NavGrid,
  PathFollower,
  StateMachine,
  SteeringAgent,
  steer,
  sense,
  type BTContext,
  type BTStatus,
} from '../src/ai';
import { fakeScheduler } from './helpers';

// ───────── 有限狀態機 ─────────

describe('有限狀態機', () => {
  test('enter／update／exit、回傳名稱切換、計時、go', () => {
    const log: string[] = [];
    const ctx = { hp: 10 };
    const fsm = new StateMachine(ctx, 'idle', {
      idle: {
        enter: (_c, from) => log.push(`enter idle from ${from}`),
        update: (c) => (c.hp < 5 ? 'flee' : undefined),
        exit: () => log.push('exit idle'),
      },
      flee: { enter: (_c, from) => log.push(`enter flee from ${from}`) },
      dead: {},
    });
    const changes: string[] = [];
    fsm.onChange((to, from) => changes.push(`${from}->${to}`));
    fsm.update(0.5);
    fsm.update(0.5);
    expect(fsm.current).toBe('idle');
    expect(fsm.timeInState).toBe(1);
    ctx.hp = 3;
    fsm.update(0.1);
    expect(fsm.current).toBe('flee');
    expect(fsm.previous).toBe('idle');
    expect(fsm.timeInState).toBe(0);
    fsm.go('dead');
    expect(log).toEqual(['enter idle from null', 'exit idle', 'enter flee from idle']);
    expect(changes).toEqual(['null->idle', 'idle->flee', 'flee->dead']);
    expect(() => fsm.go('nope')).toThrow(/不存在/);
    expect(() => new StateMachine({}, 'x', {})).toThrow(/初始狀態/);
  });
});

// ───────── 行為樹 ─────────

function ctx<B extends object>(blackboard: B, dt = 0.1): BTContext<B> {
  return { entity: 0 as Entity, world: new World(), dt, blackboard };
}

/** 執行 n 次後成功的動作 */
function countdown(n: number, log: string[], name: string) {
  let left = n;
  return BT.action(
    () => {
      log.push(name);
      if (--left > 0) return 'running';
      left = n;
      return 'success';
    },
    name,
    () => {
      log.push(`${name}:interrupt`);
      left = n;
    },
  );
}

describe('行為樹', () => {
  test('Sequence 記得執行到哪裡；失敗就停', () => {
    const log: string[] = [];
    const tree = new BehaviorTree(
      BT.sequence(
        countdown(1, log, 'a'),
        countdown(2, log, 'b'),
        BT.action(() => {
          log.push('c');
        }),
      ),
    );
    const c = ctx({});
    expect(tree.tick(c)).toBe('running'); // a 成功，b 進行中
    expect(tree.tick(c)).toBe('success'); // 從 b 繼續，不會重跑 a
    expect(log).toEqual(['a', 'b', 'b', 'c']);
    const failing = new BehaviorTree(
      BT.sequence(
        BT.condition(() => false),
        BT.action(() => {
          log.push('never');
        }),
      ),
    );
    expect(failing.tick(c)).toBe('failure');
    expect(log).not.toContain('never');
  });

  test('Selector 每幀從頭判斷，高優先成立時中斷正在執行的低優先動作', () => {
    const log: string[] = [];
    const bb = { seesPlayer: false };
    const tree = new BehaviorTree(
      BT.selector<typeof bb>(
        BT.sequence(
          BT.condition((c) => c.blackboard.seesPlayer),
          BT.action(() => {
            log.push('chase');
            return 'running';
          }, 'chase'),
        ),
        countdown(5, log, 'patrol'),
      ),
    );
    const c = ctx(bb);
    tree.tick(c);
    tree.tick(c);
    expect(tree.activePath).toEqual(['selector', 'patrol']);
    bb.seesPlayer = true;
    expect(tree.tick(c)).toBe('running');
    // 先執行高優先的 chase（才知道它成立），接著中斷 patrol
    expect(log).toEqual(['patrol', 'patrol', 'chase', 'patrol:interrupt']);
    expect(tree.activePath).toEqual(['selector', 'sequence', 'chase']);
  });

  test('Parallel、Wait、Invert、Succeed、Repeat', () => {
    const c = ctx({});
    expect(
      new BehaviorTree(
        BT.parallel(
          'all',
          BT.wait(0.2),
          BT.action(() => 'success' as BTStatus),
        ),
      ).tick(c),
    ).toBe('running');
    const p = new BehaviorTree(
      BT.parallel(
        'one',
        BT.wait(0.2),
        BT.action(() => 'success' as BTStatus),
      ),
    );
    expect(p.tick(c)).toBe('success');

    const wait = new BehaviorTree(BT.wait(0.25));
    expect([wait.tick(c), wait.tick(c), wait.tick(c)]).toEqual(['running', 'running', 'success']);
    expect(wait.tick(c)).toBe('running'); // 重新開始計時

    expect(new BehaviorTree(BT.invert(BT.condition(() => true))).tick(c)).toBe('failure');
    expect(new BehaviorTree(BT.succeed(BT.condition(() => false))).tick(c)).toBe('success');

    let n = 0;
    const rep = new BehaviorTree(
      BT.repeat(
        BT.action(() => {
          n++;
        }),
        3,
      ),
    );
    expect([rep.tick(c), rep.tick(c), rep.tick(c)]).toEqual(['running', 'running', 'success']);
    expect(n).toBe(3);
  });

  test('Cooldown 與 Timeout', () => {
    const c = ctx({}, 0.5);
    let fired = 0;
    const cd = new BehaviorTree(
      BT.cooldown(
        1,
        BT.action(() => {
          fired++;
        }),
      ),
    );
    const results = [cd.tick(c), cd.tick(c), cd.tick(c), cd.tick(c)];
    expect(results).toEqual(['success', 'failure', 'failure', 'success']);
    expect(fired).toBe(2);

    const to = new BehaviorTree(
      BT.timeout(
        1,
        BT.action(() => 'running' as BTStatus),
      ),
    );
    expect([to.tick(c), to.tick(c), to.tick(c)]).toEqual(['running', 'running', 'failure']);
  });
});

// ───────── 導航網格 ─────────

describe('導航網格（A*）', () => {
  /** 10x10 的網格，中間一道牆，只留下方的缺口 */
  function walledGrid() {
    const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 10, z: 10 }, cellSize: 1 });
    grid.setArea(5, 0, 5.9, 7.9, false); // x = 5 那一欄，z 0~7 擋住
    return grid;
  }

  test('繞過牆找到路；路徑不穿過障礙物', () => {
    const grid = walledGrid();
    const path = grid.findPath({ x: 1.5, y: 0, z: 1.5 }, { x: 8.5, y: 0, z: 1.5 }, { smooth: false })!;
    expect(path).not.toBeNull();
    expect(path[0].toArray()).toEqual([1.5, 0, 1.5]);
    expect(path.at(-1)!.toArray()).toEqual([8.5, 0, 1.5]);
    for (const p of path) expect(grid.isWalkable(p)).toBe(true);
    expect(Math.max(...path.map((p) => p.z))).toBeGreaterThan(8); // 從缺口繞過去
  });

  test('拉直後點更少，且每一段都不穿牆', () => {
    const grid = walledGrid();
    const raw = grid.findPath({ x: 1.5, y: 0, z: 1.5 }, { x: 8.5, y: 0, z: 1.5 }, { smooth: false })!;
    const smooth = grid.findPath({ x: 1.5, y: 0, z: 1.5 }, { x: 8.5, y: 0, z: 1.5 })!;
    expect(smooth.length).toBeLessThan(raw.length);
    for (let i = 1; i < smooth.length; i++) expect(grid.lineOfSight(smooth[i - 1], smooth[i])).toBe(true);
  });

  test('斜走不切障礙物的角；找不到路回傳 null；起點在牆裡時改用最近的格子', () => {
    const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 3, z: 3 }, cellSize: 1 });
    grid.setWalkable(1, 0, false);
    grid.setWalkable(0, 1, false);
    expect(grid.findPath({ x: 0.5, y: 0, z: 0.5 }, { x: 1.5, y: 0, z: 1.5 })).toBeNull(); // 只能斜切，不允許

    const closed = walledGrid();
    closed.setArea(5, 8, 5.9, 9.9, false); // 把缺口補起來
    expect(closed.findPath({ x: 1.5, y: 0, z: 1.5 }, { x: 8.5, y: 0, z: 1.5 })).toBeNull();

    const g = walledGrid();
    const path = g.findPath({ x: 5.5, y: 0, z: 3.5 }, { x: 1.5, y: 0, z: 3.5 })!;
    expect(g.isWalkable(path[0])).toBe(true);
  });

  test('從物理碰撞體烘焙：固定物體擋住，動態物體與地板不算', async () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    const physicsPlugin = await PhysicsPlugin.create();
    engine.use(ecs).use(new ScenePlugin()).use(physicsPlugin);
    const world = ecs.world;
    const spawn = (x: number, y: number, z: number, ...c: Parameters<World['spawn']>) => {
      const e = world.spawn(...c);
      world.add(e, Transform).position.set(x, y, z);
      return e;
    };
    spawn(5, -0.5, 5, Collider.with({ halfExtents: { x: 10, y: 0.5, z: 10 } })); // 地板，頂面 y = 0
    spawn(2.5, 0.5, 2.5, RigidBody.with({ type: 'fixed' }), Collider); // 固定方塊
    spawn(7.5, 0.5, 7.5, RigidBody.with({ type: 'dynamic' }), Collider); // 動態方塊
    const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 10, z: 10 }, cellSize: 1 });
    grid.bakeFromPhysics(physicsPlugin.physics, world, { probeY: 0.5, agentRadius: 0.3 });
    expect(grid.isWalkable({ x: 2.5, z: 2.5 })).toBe(false);
    expect(grid.isWalkable({ x: 7.5, z: 7.5 })).toBe(true);
    expect(grid.isWalkable({ x: 5.5, z: 5.5 })).toBe(true);
  });
});

// ───────── 轉向 ─────────

describe('轉向行為', () => {
  test('steer.seek 指向目標；steer.arrive 在目標附近減速', () => {
    const f = steer.seek({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 2);
    expect(f.toArray()).toEqual([2, 0, 0]);
    const far = steer.arrive({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 2, 2);
    const near = steer.arrive({ x: 9.5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 2, 2);
    expect(far.x).toBe(2);
    expect(near.x).toBeCloseTo(0.5, 5);
  });
});

// ───────── 整合 ─────────

async function setupAI(withPhysics = false) {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const ai = new AIPlugin();
  const engine = new Engine({ scheduler: clock.scheduler, fixedDelta: 1 / 30, maxDelta: 0.1, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin());
  const physics = withPhysics ? await PhysicsPlugin.create() : null;
  if (physics) engine.use(physics);
  engine.use(ai);
  engine.start();
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) clock.frame(1000 / 30);
  };
  return { world: ecs.world, ai, run, physics };
}

describe('轉向角色與找路', () => {
  test('steer.arrive 抵達目標並停下；朝向移動方向', async () => {
    const { world, run } = await setupAI();
    const e = world.spawn(Transform, SteeringAgent.with({ mode: 'arrive', target: { x: 5, y: 0, z: 0 }, maxSpeed: 3 }));
    run(1);
    const t = world.get(e, Transform)!;
    // 往 +X 走：前方（-Z）應該轉向 +X
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(t.rotation).x).toBeGreaterThan(0.9);
    run(4);
    // 停在 stopDistance（預設 0.15）的容許範圍內
    expect(Math.abs(t.position.x - 5)).toBeLessThanOrEqual(world.get(e, SteeringAgent)!.stopDistance);
    expect(world.get(e, SteeringAgent)!.arrived).toBe(true);
    expect(world.get(e, SteeringAgent)!.velocity.length()).toBeLessThan(0.05);
  });

  test('flee 遠離；分離讓重疊的角色散開', async () => {
    const { world, run } = await setupAI();
    const e = world.spawn(Transform, SteeringAgent.with({ mode: 'flee', target: { x: 0, y: 0, z: 0 } }));
    world.get(e, Transform)!.position.set(1, 0, 0);
    const a = world.spawn(Transform, SteeringAgent.with({ separation: 2, separationRadius: 1.5 }));
    const b = world.spawn(Transform, SteeringAgent.with({ separation: 2, separationRadius: 1.5 }));
    world.get(b, Transform)!.position.set(0.2, 0, 10);
    world.get(a, Transform)!.position.set(0, 0, 10);
    run(1);
    expect(world.get(e, Transform)!.position.x).toBeGreaterThan(2);
    expect(world.get(a, Transform)!.position.distanceTo(world.get(b, Transform)!.position)).toBeGreaterThan(1);
  });

  test('PathFollower 繞過牆走到目的地', async () => {
    const { world, ai, run } = await setupAI();
    const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 10, z: 10 }, cellSize: 0.5 });
    grid.setArea(4.5, 0, 5.5, 7.5, false);
    const wallOnly = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 10, z: 10 }, cellSize: 0.5 });
    wallOnly.setArea(4.5, 0, 5.5, 7.5, false);
    grid.inflate(1); // 預留角色寬度
    ai.navGrid = grid;
    const e = world.spawn(
      SteeringAgent.with({ maxSpeed: 4, separation: 0 }),
      PathFollower.with({ destination: { x: 8.5, y: 0, z: 1.5 } }),
    );
    world.get(e, Transform) ?? world.add(e, Transform).position.set(1.5, 0, 1.5);
    let maxZ = 0;
    for (let i = 0; i < 12; i++) {
      run(0.5);
      const p = world.get(e, Transform)!.position;
      maxZ = Math.max(maxZ, p.z);
      expect(wallOnly.isWalkable(p)).toBe(true); // 一路上都沒有走進牆裡
    }
    expect(maxZ).toBeGreaterThan(8);
    expect(world.get(e, PathFollower)!.status).toBe('arrived');
    expect(world.get(e, Transform)!.position.distanceTo(new THREE.Vector3(8.5, 0, 1.5))).toBeLessThan(0.3);
  });

  test('目的地無法到達時狀態為 unreachable', async () => {
    const { world, ai, run } = await setupAI();
    const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 4, z: 4 }, cellSize: 1 });
    grid.setArea(2, 0, 2.9, 3.9, false);
    ai.navGrid = grid;
    const e = world.spawn(Transform, SteeringAgent, PathFollower.with({ destination: { x: 3.5, y: 0, z: 0.5 } }));
    world.get(e, Transform)!.position.set(0.5, 0, 0.5);
    run(0.2);
    expect(world.get(e, PathFollower)!.status).toBe('unreachable');
  });
});

describe('大腦與感知', () => {
  test('Brain 每幀執行行為樹；tickRate 降低思考頻率', async () => {
    const { world, run } = await setupAI();
    let ticks = 0;
    const e = world.spawn(
      Brain.with({
        tree: new BehaviorTree(
          BT.action(() => {
            ticks++;
            return 'running';
          }),
        ),
        tickRate: 5,
      }),
    );
    run(1);
    expect(ticks).toBe(5);
    expect(world.get(e, Brain)!.status).toBe('running');
  });

  test('sense.canSee：視距、視野角度、被牆擋住', async () => {
    const { world, run } = await setupAI(true);
    const guard = world.spawn(Transform);
    const gt = world.get(guard, Transform)!;
    gt.position.set(0, 1, 0);
    math.lookAt(gt, new THREE.Vector3(0, 1, -10)); // 看向 -Z
    const target = world.spawn(Transform);
    world.get(target, Transform)!.position.set(0, 1, -5);
    run(0.1);
    expect(sense.canSee(world, guard, target, { range: 10, fov: 90 })).toBe(true);
    expect(sense.canSee(world, guard, target, { range: 4, fov: 90 })).toBe(false); // 太遠
    world.get(target, Transform)!.position.set(5, 1, 0); // 在正右邊
    run(0.1);
    expect(sense.canSee(world, guard, target, { fov: 90 })).toBe(false);
    expect(sense.canSee(world, guard, target, { fov: 360 })).toBe(true);

    world.get(target, Transform)!.position.set(0, 1, -5);
    const wall = world.spawn(RigidBody.with({ type: 'fixed' }), Collider.with({ halfExtents: { x: 2, y: 2, z: 0.1 } }));
    world.add(wall, Transform).position.set(0, 1, -2.5);
    run(0.1);
    expect(sense.canSee(world, guard, target, { fov: 90 })).toBe(false);
    expect(sense.canSee(world, guard, target, { fov: 90, occlusion: false })).toBe(true);
  });
});
