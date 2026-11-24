import type { Engine, Plugin } from '../core/Engine';
import type { Phase } from '../core/Loop';
import type { Time } from '../core/Time';
import { World } from './World';
import type { ComponentType } from './Component';
import type { Entity } from './Entity';
import type { ComponentValues, QueryOptions } from './Query';

/**
 * 系統：所有遊戲行為都寫在這裡，對符合查詢的實體做事。
 */
export interface System {
  /** 系統名稱（removeSystem、啟用／停用時用） */
  readonly name: string;
  /** 在哪個更新階段執行，預設 update */
  readonly phase?: Phase;
  /** 同階段中的順序，越小越先，預設 0 */
  readonly priority?: number;
  /**
   * 加入時呼叫一次（可在這裡建立查詢、註冊掛鉤）
   * @param world ECS 世界
   */
  init?(world: World): void;
  /**
   * 每幀執行
   * @param world ECS 世界
   * @param time 時間（time.delta 是這一幀的秒數）
   */
  run(world: World, time: Time): void;
  /**
   * 移除時呼叫
   * @param world ECS 世界
   */
  dispose?(world: World): void;
}

interface SystemEntry {
  system: System;
  enabled: boolean;
  off?: () => void;
}

/** 每個階段結束時執行延後指令的優先度 */
const FLUSH_PRIORITY = Number.MAX_SAFE_INTEGER;

/**
 * ECS 外掛：把 World 與系統接到引擎的主迴圈上。
 */
export class EcsPlugin implements Plugin {
  readonly name = 'ecs';
  /** ECS 世界：實體、元件、資源都在這裡 */
  readonly world: World;
  private engine: Engine | null = null;
  private readonly systems = new Map<string, SystemEntry>();
  private readonly flushOffs: (() => void)[] = [];
  private offTimers: () => void = () => {};

  /**
   * @param world ECS 世界
   */
  constructor(world = new World()) {
    this.world = world;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    this.engine = engine;
    // 綁定實體的計時器：實體銷毀時自動取消
    this.offTimers = this.world.onDestroy((e) => engine.timers.cancelOwner(e));
    for (const phase of ['input', 'fixedUpdate', 'update', 'lateUpdate', 'render'] as const) {
      this.flushOffs.push(engine.on(phase, () => this.world.flush(), FLUSH_PRIORITY));
    }
    for (const entry of this.systems.values()) this.attach(entry);
  }

  uninstall(): void {
    for (const name of [...this.systems.keys()].reverse()) this.removeSystem(name);
    for (const off of this.flushOffs) off();
    this.flushOffs.length = 0;
    this.world.clear();
    this.offTimers();
    this.offTimers = () => {};
    this.engine = null;
  }

  /**
   * 最常見的系統：每幀對符合查詢的實體逐一處理。最後一個參數是時間（time.delta 是這一幀的秒數）。
   *
   *   ecs.each('spin', [Transform, Spin], (e, t, s, time) => math.rotate(t, [0, s.speed * time.delta, 0]));
   *
   * options：phase（階段，預設 update）、priority（順序）、none（排除有這些元件的實體）。比較複雜的系統用 addSystem。
   * @param name 系統名稱（removeSystem、setEnabled 用）
   * @param types 要有的元件
   * @param fn 每個實體呼叫一次：實體、各元件的資料、時間
   * @param options 階段、順序、排除有這些元件的實體（none）
   */
  each<const Cs extends readonly ComponentType<unknown>[]>(
    name: string,
    types: Cs,
    fn: (entity: Entity, ...args: [...ComponentValues<Cs>, Time]) => void,
    options: {
      /** 在哪個階段執行，預設 update */
      phase?: Phase;
      /** 同一階段內的順序：小的先執行，預設 0 */
      priority?: number;
    } & QueryOptions = {},
  ): this {
    const { phase, priority, ...query } = options;
    return this.addSystem({
      name,
      phase,
      priority,
      run: (world, time) =>
        world
          .query(types, query)
          .each((e, ...values) => fn(e, ...([...values, time] as [...ComponentValues<Cs>, Time]))),
    });
  }

  /**
   * 加入系統（可以指定階段、順序、init／dispose；最常見的「查詢 + 逐一處理」用 each 比較短）
   * @param system 系統：名稱、階段、順序、run（每幀執行）、init、dispose
   */
  addSystem(system: System): this {
    if (this.systems.has(system.name)) throw new Error(`系統「${system.name}」已存在`);
    const entry: SystemEntry = { system, enabled: true };
    this.systems.set(system.name, entry);
    if (this.engine) this.attach(entry);
    return this;
  }

  /**
   * 移除系統
   * @param name 系統名稱
   */
  removeSystem(name: string): this {
    const entry = this.systems.get(name);
    if (!entry) return this;
    if (entry.off) {
      entry.off();
      entry.system.dispose?.(this.world);
    }
    this.systems.delete(name);
    return this;
  }

  /**
   * 是否有這個系統
   * @param name 系統名稱
   */
  hasSystem(name: string): boolean {
    return this.systems.has(name);
  }

  /**
   * 暫停或恢復單一系統
   * @param name 系統名稱
   * @param enabled false 暫停、true 恢復
   */
  setEnabled(name: string, enabled: boolean): this {
    const entry = this.systems.get(name);
    if (!entry) throw new Error(`找不到系統「${name}」`);
    entry.enabled = enabled;
    return this;
  }

  /**
   * 系統是否啟用
   * @param name 系統名稱
   */
  isEnabled(name: string): boolean {
    return this.systems.get(name)?.enabled ?? false;
  }

  private attach(entry: SystemEntry): void {
    const { system } = entry;
    system.init?.(this.world);
    entry.off = this.engine!.on(
      system.phase ?? 'update',
      (time) => {
        if (entry.enabled) system.run(this.world, time);
      },
      system.priority ?? 0,
    );
  }
}
