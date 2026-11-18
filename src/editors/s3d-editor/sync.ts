/**
 * 把場景檔資料同步到 world：只更新有變化的實體與元件（比對每個元件的 JSON）。
 * 元件資料「就地」換成新值（不移除再加），繪製外掛每幀會依資料更新 three.js 物件，所以不會閃爍、也不會重建網格。
 */
import type { Entity, World } from '../../ecs';
import {
  type Hierarchy,
  HierarchyKey,
  Name,
  SceneCodecsKey,
  type CodecContext,
  type SceneCodecs,
  type SceneFileData,
} from '../../scene';

interface Slot {
  entity: Entity;
  /** 元件名稱 → 上次套用的 JSON */
  applied: Map<string, string>;
}

export class WorldSync {
  private readonly slots = new Map<string, Slot>();
  /** 最近一次同步的警告（沒有存讀規則、資料錯誤） */
  warnings: string[] = [];

  constructor(private readonly world: World) {}

  private get codecs(): SceneCodecs {
    return this.world.requireResource(SceneCodecsKey);
  }

  private get hierarchy(): Hierarchy {
    return this.world.requireResource(HierarchyKey);
  }

  /** 檔案 id 對應的實體 */
  entityOf(id: string): Entity | undefined {
    return this.slots.get(id)?.entity;
  }

  /** 實體對應的檔案 id */
  idOf(entity: Entity): string | undefined {
    for (const [id, s] of this.slots) if (s.entity === entity) return id;
    return undefined;
  }

  /** 目前所有的 [檔案 id, 實體] */
  entries(): [string, Entity][] {
    return [...this.slots].map(([id, s]) => [id, s.entity]);
  }

  /** 同步到 data 的內容 */
  apply(data: SceneFileData): void {
    const world = this.world;
    const codecs = this.codecs;
    const hierarchy = this.hierarchy;
    this.warnings = [];
    const next = new Map(data.entities.map((e) => [e.id, e]));

    // 1. 新的實體
    for (const item of data.entities) {
      const slot = this.slots.get(item.id);
      // 實體被別的系統銷毀了（例如粒子的 autoDestroy）：重新建立
      if (!slot || !world.isAlive(slot.entity)) this.slots.set(item.id, { entity: world.create(), applied: new Map() });
    }
    // 2. 父子關係（要在刪除之前：被刪的父節點會連帶刪掉子節點）
    for (const item of data.entities) {
      const e = this.slots.get(item.id)!.entity;
      const parent = item.parent !== undefined ? (this.slots.get(item.parent)?.entity ?? null) : null;
      if (hierarchy.parentOf(e) !== parent) hierarchy.setParent(e, parent);
    }
    // 3. 刪掉的實體
    for (const [id, slot] of [...this.slots]) {
      if (next.has(id)) continue;
      for (const child of [...hierarchy.childrenOf(slot.entity)]) hierarchy.setParent(child, null);
      if (world.isAlive(slot.entity)) world.destroy(slot.entity);
      this.slots.delete(id);
    }
    // 4. 名稱與元件
    for (const item of data.entities) {
      const slot = this.slots.get(item.id)!;
      const e = slot.entity;
      if (item.name) world.add(e, Name, { value: item.name });
      else world.remove(e, Name);

      const components = item.components ?? {};
      for (const name of [...slot.applied.keys()]) {
        if (name in components) continue;
        const codec = codecs.get(name);
        if (codec) world.remove(e, codec.type);
        slot.applied.delete(name);
      }
      for (const [name, value] of Object.entries(components)) {
        const json = JSON.stringify(value);
        if (slot.applied.get(name) === json) continue;
        const codec = codecs.get(name);
        if (!codec) {
          this.warnings.push(`實體「${item.id}」：沒有元件「${name}」的存讀規則，畫面上不會顯示`);
          slot.applied.set(name, json);
          continue;
        }
        const ctx: CodecContext = {
          entity: item.id,
          component: name,
          warn: (m) => this.warnings.push(`實體「${item.id}」的 ${name}：${m}`),
        };
        try {
          const init = codec.read(value, ctx);
          const existing = world.get(e, codec.type);
          // 就地換成新值：先回到預設值，再套用檔案裡的欄位（檔案省略的欄位要回到預設）
          if (existing !== undefined) Object.assign(existing as object, codec.type.create(), init);
          else world.add(e, codec.type, init);
          slot.applied.set(name, json);
        } catch (error) {
          this.warnings.push(`實體「${item.id}」的 ${name}：${(error as Error).message}`);
        }
      }
    }
  }

  /** 忘記已套用的內容：下次 apply 會把每個元件都重新寫一次（試玩結束後，把被物理移動過的實體放回原位） */
  reset(): void {
    for (const slot of this.slots.values()) slot.applied.clear();
  }

  /** 刪除所有同步建立的實體 */
  clear(): void {
    this.apply({ format: 'hero-scene', version: 1, entities: [] });
  }

  /**
   * 告訴同步：這個元件在 world 裡已經是 json 的內容了（例如拖曳控制器時直接改了 Transform，
   * 放開後 commit 的資料和 world 一樣），下次同步不用再套用一次。
   */
  markApplied(id: string, component: string, value: unknown): void {
    this.slots.get(id)?.applied.set(component, JSON.stringify(value));
  }
}
