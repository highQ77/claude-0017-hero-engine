import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { Entity } from '../ecs';
import { createLogger } from '../core/Logger';
// 只引用資源鍵：不要因為登記一個存讀規則就把整個場景檔讀取器（XML 解析）包進來
import { SceneCodecsKey } from '../scene/keys';
import { ScriptRunner, type ScriptRunnerOptions } from './ScriptRunner';
import { ScriptList, scriptListCodec } from './ScriptList';
import type { Script } from './Script';
import { ScriptsKey } from './keys';

const log = createLogger('scripts');
export { ScriptsKey } from './keys';

/** fixedUpdate：在物理更新（100）之前，腳本施的力才會在這一步生效 */
export const SCRIPT_FIXED_PRIORITY = 50;
/** update：和一般系統同一層 */
export const SCRIPT_UPDATE_PRIORITY = 0;
/** lateUpdate：在物理寫回位置（900）之後、變換計算（1000）之前 */
export const SCRIPT_LATE_PRIORITY = 950;

/**
 * 腳本外掛：讓實體可以掛行為腳本。需先安裝 EcsPlugin。
 * 安裝了 PhysicsPlugin、InputPlugin、RenderPlugin 時，會自動提供碰撞與點擊事件。
 */
export class ScriptPlugin implements Plugin {
  readonly name = 'scripts';
  readonly dependencies = ['ecs'] as const;
  private _runner: ScriptRunner | null = null;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  private offs: (() => void)[] = [];
  /** 剛加上 ScriptList、還沒掛腳本的實體 */
  private readonly pendingLists = new Set<Entity>();
  /** 由 ScriptList 掛上的腳本（移除 ScriptList 時一起移除） */
  private readonly fromList = new Map<Entity, Script[]>();

  /**
   * @param options 腳本錯誤時直接拋出（rethrow，測試用）
   */
  constructor(private readonly options: ScriptRunnerOptions = {}) {}

  /** 腳本執行器（也可以用 world.requireResource(ScriptsKey) 取得） */
  get runner(): ScriptRunner {
    if (!this._runner) throw new Error('ScriptPlugin 尚未安裝');
    return this._runner;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.ecs = ecs;
    this.world = ecs.world;
    const runner = (this._runner = new ScriptRunner(ecs.world, engine, this.options));
    ecs.world.setResource(ScriptsKey, runner);
    // 場景檔的腳本（ScriptList）：加上時先記下來，這一幀的腳本執行之前才掛（那時其他元件都已經加好）
    this.offs.push(
      ecs.world.getResource(SceneCodecsKey)?.register(scriptListCodec) ?? (() => {}),
      ecs.world.onAdd(ScriptList, (e) => this.pendingLists.add(e)),
      ecs.world.onRemove(ScriptList, (e) => {
        this.pendingLists.delete(e);
        for (const s of this.fromList.get(e) ?? []) if (s.alive) runner.remove(e, s);
        this.fromList.delete(e);
      }),
    );
    for (const phase of ['fixedUpdate', 'update'] as const)
      ecs.addSystem({
        name: `scripts-attach-${phase}`,
        phase,
        priority: (phase === 'update' ? SCRIPT_UPDATE_PRIORITY : SCRIPT_FIXED_PRIORITY) - 1,
        run: () => this.attachPending(),
      });
    ecs.addSystem({
      name: 'scripts-fixed',
      phase: 'fixedUpdate',
      priority: SCRIPT_FIXED_PRIORITY,
      run: (_w, t) => runner.fixedUpdate(t.fixedDelta),
    });
    ecs.addSystem({ name: 'scripts-update', priority: SCRIPT_UPDATE_PRIORITY, run: (_w, t) => runner.update(t.delta) });
    ecs.addSystem({
      name: 'scripts-late',
      phase: 'lateUpdate',
      priority: SCRIPT_LATE_PRIORITY,
      run: (_w, t) => runner.lateUpdate(t.delta),
    });
  }

  /** 替剛加上 ScriptList 的實體掛腳本 */
  private attachPending(): void {
    const world = this.world;
    const runner = this._runner;
    if (!world || !runner || !this.pendingLists.size) return;
    const list = [...this.pendingLists];
    this.pendingLists.clear();
    for (const e of list) {
      const data = world.get(e, ScriptList);
      if (!data || !world.isAlive(e)) continue;
      const made: Script[] = [];
      for (const [name, props] of Object.entries(data.scripts)) {
        const cls = runner.registered(name);
        if (!cls) {
          log.warn(
            `場景檔用到腳本「${name}」，但沒有登記：請在遊戲裡 scripts.register({ ${name} })（已登記：${runner.registeredNames().join('、') || '無'}）`,
          );
          continue;
        }
        made.push(runner.add(e, cls, props as never));
      }
      this.fromList.set(e, made);
    }
  }

  uninstall(): void {
    for (const off of this.offs.splice(0)) off();
    this.pendingLists.clear();
    this.fromList.clear();
    this.ecs?.removeSystem('scripts-attach-fixedUpdate').removeSystem('scripts-attach-update');
    this.ecs?.removeSystem('scripts-late').removeSystem('scripts-update').removeSystem('scripts-fixed');
    this._runner?.dispose();
    if (this.world?.getResource(ScriptsKey) === this._runner) this.world?.removeResource(ScriptsKey);
    this._runner = null;
    this.ecs = this.world = null;
  }
}
