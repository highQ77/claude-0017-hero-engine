import type { Entity, World } from '../ecs';

/** 節點的結果：成功、失敗、還在執行 */
export type BTStatus = 'success' | 'failure' | 'running';

/** 行為樹執行時的資訊 */
export interface BTContext<B extends object = Record<string, unknown>> {
  /** 執行行為樹的實體 */
  entity: Entity;
  /** ECS 世界 */
  world: World;
  /** 這一幀的秒數 */
  dt: number;
  /** 黑板：這棵樹共用的資料（目標、記憶等） */
  blackboard: B;
}

/** 行為樹節點 */
export abstract class BTNode<B extends object = Record<string, unknown>> {
  /** 除錯用名稱 */
  label: string;
  /** 上一次 tick 的結果 */
  lastStatus: BTStatus | null = null;

  constructor(label: string) {
    this.label = label;
  }

  /** 執行這個節點 */
  tick(ctx: BTContext<B>): BTStatus {
    const status = this.run(ctx);
    this.lastStatus = status;
    if (status !== 'running') this.onFinish();
    return status;
  }

  /** 被中斷或結束時清除內部狀態 */
  reset(): void {
    this.lastStatus = null;
    this.onFinish();
  }

  protected abstract run(ctx: BTContext<B>): BTStatus;
  protected onFinish(): void {}
  /** 子節點 */
  abstract get children(): readonly BTNode<B>[];
}

abstract class Composite<B extends object> extends BTNode<B> {
  constructor(
    label: string,
    readonly nodes: BTNode<B>[],
  ) {
    super(label);
  }
  get children(): readonly BTNode<B>[] {
    return this.nodes;
  }
  override reset(): void {
    super.reset();
    for (const c of this.nodes) c.reset();
  }
}

/** 依序執行：全部成功才成功；遇到失敗就失敗。會記得執行到哪一個（下一幀從那裡繼續） */
export class Sequence<B extends object> extends Composite<B> {
  private index = 0;
  protected run(ctx: BTContext<B>): BTStatus {
    while (this.index < this.nodes.length) {
      const status = this.nodes[this.index].tick(ctx);
      if (status === 'running') return 'running';
      if (status === 'failure') return 'failure';
      this.index++;
    }
    return 'success';
  }
  protected override onFinish(): void {
    this.index = 0;
  }
}

/**
 * 依優先順序選擇：第一個不失敗的生效。
 * 每幀都從第一個重新判斷，優先度高的條件成立時會中斷正在執行的低優先行為
 * （例如「看到玩家就追」會中斷「巡邏」）。
 *
 * 注意：要先執行高優先的那一支才知道它會不會成立，所以被中斷那一支的 onInterrupt
 * 會在新那一支第一次執行「之後」才呼叫。onInterrupt 只清理自己的狀態，
 * 不要去改共用的目標（例如移動目標），以免蓋掉新行為剛設定的值。
 */
export class Selector<B extends object> extends Composite<B> {
  private runningIndex = -1;
  protected run(ctx: BTContext<B>): BTStatus {
    for (let i = 0; i < this.nodes.length; i++) {
      const status = this.nodes[i].tick(ctx);
      if (status === 'failure') continue;
      // 換到別的子節點：中斷先前執行中的那個
      if (this.runningIndex !== -1 && this.runningIndex !== i) this.nodes[this.runningIndex].reset();
      this.runningIndex = status === 'running' ? i : -1;
      return status;
    }
    if (this.runningIndex !== -1) this.nodes[this.runningIndex].reset();
    this.runningIndex = -1;
    return 'failure';
  }
  protected override onFinish(): void {
    this.runningIndex = -1;
  }
}

/** 同時執行：policy 'all' 全部成功才成功；'one' 任一成功即成功 */
export class Parallel<B extends object> extends Composite<B> {
  constructor(
    label: string,
    /** all：全部成功才成功；one：一個成功就成功 */
    readonly policy: 'all' | 'one',
    nodes: BTNode<B>[],
  ) {
    super(label, nodes);
  }
  protected run(ctx: BTContext<B>): BTStatus {
    let successes = 0;
    let failures = 0;
    for (const child of this.nodes) {
      const s = child.tick(ctx);
      if (s === 'success') successes++;
      else if (s === 'failure') failures++;
    }
    const n = this.nodes.length;
    const done = (status: BTStatus) => {
      for (const c of this.nodes) if (c.lastStatus === 'running') c.reset();
      return status;
    };
    if (this.policy === 'one') {
      if (successes > 0) return done('success');
      if (failures === n) return done('failure');
    } else {
      if (failures > 0) return done('failure');
      if (successes === n) return done('success');
    }
    return 'running';
  }
}

abstract class Decorator<B extends object> extends BTNode<B> {
  constructor(
    label: string,
    readonly child: BTNode<B>,
  ) {
    super(label);
  }
  get children(): readonly BTNode<B>[] {
    return [this.child];
  }
  override reset(): void {
    super.reset();
    this.child.reset();
  }
}

class Inverter<B extends object> extends Decorator<B> {
  protected run(ctx: BTContext<B>): BTStatus {
    const s = this.child.tick(ctx);
    return s === 'running' ? 'running' : s === 'success' ? 'failure' : 'success';
  }
}

class AlwaysSucceed<B extends object> extends Decorator<B> {
  protected run(ctx: BTContext<B>): BTStatus {
    return this.child.tick(ctx) === 'running' ? 'running' : 'success';
  }
}

/** 重複執行子節點 times 次（Infinity 為無限）；子節點失敗則失敗 */
class Repeat<B extends object> extends Decorator<B> {
  private count = 0;
  constructor(
    label: string,
    child: BTNode<B>,
    readonly times: number,
  ) {
    super(label, child);
  }
  protected run(ctx: BTContext<B>): BTStatus {
    const s = this.child.tick(ctx);
    if (s === 'running') return 'running';
    if (s === 'failure') return 'failure';
    this.count++;
    if (this.count >= this.times) return 'success';
    return 'running';
  }
  protected override onFinish(): void {
    this.count = 0;
  }
}

/** 冷卻：子節點完成後 seconds 秒內直接回傳失敗 */
class Cooldown<B extends object> extends Decorator<B> {
  private remaining = 0;
  constructor(
    label: string,
    child: BTNode<B>,
    readonly seconds: number,
  ) {
    super(label, child);
  }
  override tick(ctx: BTContext<B>): BTStatus {
    if (this.remaining > 0) {
      this.remaining -= ctx.dt;
      this.lastStatus = 'failure';
      return 'failure';
    }
    return super.tick(ctx);
  }
  protected run(ctx: BTContext<B>): BTStatus {
    const s = this.child.tick(ctx);
    if (s !== 'running') this.remaining = this.seconds;
    return s;
  }
  /** 冷卻時間不因中斷而清除 */
  override reset(): void {
    this.lastStatus = null;
    this.child.reset();
  }
}

/** 逾時：子節點執行超過 seconds 秒就中斷並失敗 */
class Timeout<B extends object> extends Decorator<B> {
  private elapsed = 0;
  constructor(
    label: string,
    child: BTNode<B>,
    readonly seconds: number,
  ) {
    super(label, child);
  }
  protected run(ctx: BTContext<B>): BTStatus {
    this.elapsed += ctx.dt;
    if (this.elapsed > this.seconds) {
      this.child.reset();
      return 'failure';
    }
    return this.child.tick(ctx);
  }
  protected override onFinish(): void {
    this.elapsed = 0;
  }
}

class Condition<B extends object> extends BTNode<B> {
  constructor(
    label: string,
    private readonly fn: (ctx: BTContext<B>) => boolean,
  ) {
    super(label);
  }
  get children(): readonly BTNode<B>[] {
    return [];
  }
  protected run(ctx: BTContext<B>): BTStatus {
    return this.fn(ctx) ? 'success' : 'failure';
  }
}

class Action<B extends object> extends BTNode<B> {
  constructor(
    label: string,
    private readonly fn: (ctx: BTContext<B>) => BTStatus | void,
    private readonly onReset?: (ctx: BTContext<B> | null) => void,
  ) {
    super(label);
  }
  get children(): readonly BTNode<B>[] {
    return [];
  }
  protected run(ctx: BTContext<B>): BTStatus {
    return this.fn(ctx) ?? 'success';
  }
  override reset(): void {
    const wasRunning = this.lastStatus === 'running';
    super.reset();
    if (wasRunning) this.onReset?.(null);
  }
}

class Wait<B extends object> extends BTNode<B> {
  private elapsed = 0;
  constructor(
    label: string,
    readonly seconds: number | ((ctx: BTContext<B>) => number),
  ) {
    super(label);
  }
  private target = -1;
  get children(): readonly BTNode<B>[] {
    return [];
  }
  protected run(ctx: BTContext<B>): BTStatus {
    if (this.target < 0) this.target = typeof this.seconds === 'function' ? this.seconds(ctx) : this.seconds;
    this.elapsed += ctx.dt;
    return this.elapsed >= this.target ? 'success' : 'running';
  }
  protected override onFinish(): void {
    this.elapsed = 0;
    this.target = -1;
  }
}

/**
 * 建立行為樹節點的工具。
 * @example
 * const tree = new BehaviorTree(
 *   BT.selector(
 *     BT.sequence(BT.condition(seesPlayer), BT.action(chase)),   // 優先：看到就追
 *     BT.sequence(BT.action(goToNextWaypoint), BT.wait(1)),      // 否則：巡邏
 *   ),
 * );
 */
export const BT = {
  /** 依序執行子節點：全部成功才成功，有一個失敗就停下（「先做 A 再做 B」） */
  sequence: <B extends object>(...children: BTNode<B>[]) => new Sequence<B>('sequence', children),
  /** 依序嘗試子節點：有一個成功就成功（「能做 A 就做 A，不行就做 B」，越前面優先度越高） */
  selector: <B extends object>(...children: BTNode<B>[]) => new Selector<B>('selector', children),
  /** 同時執行所有子節點（all：全部成功才成功；one：一個成功就成功） */
  parallel: <B extends object>(policy: 'all' | 'one', ...children: BTNode<B>[]) =>
    new Parallel<B>('parallel', policy, children),
  /** 條件：回傳 true 成功、false 失敗（例如「看得到玩家嗎」） */
  condition: <B extends object>(fn: (ctx: BTContext<B>) => boolean, label = 'condition') => new Condition<B>(label, fn),
  /**
   * 動作：回傳 'running' 代表還在做，'failure' 代表失敗，不回傳視為成功。
   * onInterrupt 會在執行中被中斷時呼叫（例如停下移動）。
   */
  action: <B extends object>(fn: (ctx: BTContext<B>) => BTStatus | void, label = 'action', onInterrupt?: () => void) =>
    new Action<B>(label, fn, onInterrupt),
  /** 等待幾秒後成功（也可以給函式，每次重新計算秒數） */
  wait: <B extends object>(seconds: number | ((ctx: BTContext<B>) => number)) => new Wait<B>('wait', seconds),
  /** 反轉結果：成功變失敗、失敗變成功 */
  invert: <B extends object>(child: BTNode<B>) => new Inverter<B>('invert', child),
  /** 不論結果都當作成功 */
  succeed: <B extends object>(child: BTNode<B>) => new AlwaysSucceed<B>('succeed', child),
  /** 重複執行子節點幾次（預設無限次） */
  repeat: <B extends object>(child: BTNode<B>, times = Infinity) => new Repeat<B>('repeat', child, times),
  /** 冷卻：成功後幾秒內不再執行（直接失敗） */
  cooldown: <B extends object>(seconds: number, child: BTNode<B>) => new Cooldown<B>('cooldown', child, seconds),
  /** 逾時：執行超過幾秒就失敗 */
  timeout: <B extends object>(seconds: number, child: BTNode<B>) => new Timeout<B>('timeout', child, seconds),
};

/**
 * 行為樹：每個實體要有自己的一棵（節點裡記錄了執行進度），請用函式建立。
 */
export class BehaviorTree<B extends object = Record<string, unknown>> {
  constructor(/** 根節點 */ readonly root: BTNode<B>) {}

  /** 執行一次（每幀呼叫；Brain 元件會自動呼叫） */
  tick(ctx: BTContext<B>): BTStatus {
    return this.root.tick(ctx);
  }

  /** 重設所有節點的狀態（例如冷卻、等待） */
  reset(): void {
    this.root.reset();
  }

  /** 目前執行中的節點路徑（除錯用），例如 ['selector', 'sequence', 'chase'] */
  get activePath(): string[] {
    const path: string[] = [];
    let node: BTNode<B> | undefined = this.root;
    while (node && node.lastStatus === 'running') {
      path.push(node.label);
      node = node.children.find((c) => c.lastStatus === 'running');
    }
    return path;
  }
}
