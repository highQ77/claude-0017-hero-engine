import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { HierarchyKey } from './Hierarchy';

/** 標記實體屬於哪個場景；卸載場景時會一併銷毀 */
export const SceneMember = defineComponent<{ scene: string }>('SceneMember', () => ({ scene: '' }));

/** 場景：setup 建立實體，切換時自動移除（scenes.load(名稱)） */
export interface Scene {
  /** 場景名稱 */
  readonly name: string;
  /** 建立場景內容。這期間建立的實體會自動歸屬於此場景 */
  setup(world: World, scenes: SceneManager): void;
  /** 卸載時呼叫（實體會自動銷毀，這裡只需清理額外資源） */
  teardown?(world: World): void;
}

/** 載入場景的設定 */
export interface LoadOptions {
  /** 疊加載入，不卸載現有場景（例如暫停選單、介面場景） */
  additive?: boolean;
}

/**
 * 場景管理：載入、切換、疊加場景。
 *
 * 實體歸屬規則：
 * - setup 期間建立的實體 → 屬於該場景
 * - 遊戲進行中建立的實體 → 屬於主場景（最先載入的那個）
 * - 沒有任何場景時建立的、或呼叫 persist() 的實體 → 永久存在，不隨場景卸載
 */
export class SceneManager {
  private readonly registry = new Map<string, Scene>();
  private readonly loaded: string[] = [];
  private spawnTarget: string | null = null;
  private readonly offCreate: () => void;

  constructor(private readonly world: World) {
    this.offCreate = world.onCreate((e) => {
      if (this.spawnTarget !== null) world.add(e, SceneMember, { scene: this.spawnTarget });
    });
  }

  /** 註冊場景 */
  register(...scenes: Scene[]): this {
    for (const scene of scenes) {
      if (this.registry.has(scene.name)) throw new Error(`場景「${scene.name}」已註冊`);
      this.registry.set(scene.name, scene);
    }
    return this;
  }

  /** 主場景名稱 */
  get active(): string | null {
    return this.loaded[0] ?? null;
  }

  /** 目前載入的場景 */
  get loadedScenes(): readonly string[] {
    return this.loaded;
  }

  /** 場景是否已載入 */
  isLoaded(name: string): boolean {
    return this.loaded.includes(name);
  }

  /**
   * 載入場景。預設會先卸載所有場景；additive 為 true 時疊加載入。
   * 建議在系統之外呼叫，或用 world.defer() 包起來。
   */
  load(name: string, options: LoadOptions = {}): void {
    const scene = this.registry.get(name);
    if (!scene) throw new Error(`找不到場景「${name}」`);
    if (this.isLoaded(name)) {
      if (options.additive) return;
      this.unload(name);
    }
    if (!options.additive) this.unloadAll();

    this.loaded.push(name);
    const previous = this.spawnTarget;
    this.spawnTarget = name;
    try {
      scene.setup(this.world, this);
    } finally {
      this.spawnTarget = options.additive ? previous : name;
    }
  }

  /** 卸載場景（移除它建立的實體） */
  unload(name: string): void {
    const i = this.loaded.indexOf(name);
    if (i === -1) return;
    const members = this.world
      .query([SceneMember])
      .entities.filter((e) => this.world.get(e, SceneMember)!.scene === name);
    for (const e of members) this.world.destroy(e); // 已被父節點連帶銷毀的會自動略過
    this.registry.get(name)?.teardown?.(this.world);
    this.loaded.splice(i, 1);
    if (this.spawnTarget === name) this.spawnTarget = this.loaded[0] ?? null;
  }

  /** 卸載所有場景 */
  unloadAll(): void {
    for (const name of [...this.loaded].reverse()) this.unload(name);
  }

  /** 讓實體（連同子孫）不隨場景卸載，例如玩家角色、背景音樂 */
  persist(e: Entity): void {
    this.world.remove(e, SceneMember);
    this.world.getResource(HierarchyKey)?.forEachDescendant(e, (d) => this.world.remove(d, SceneMember));
  }

  /** 卸載所有場景並清除註冊 */
  dispose(): void {
    this.offCreate();
  }
}
