import { NULL_ENTITY, type Entity, type World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { HierarchyKey } from './keys';
export { HierarchyKey } from './keys';

/**
 * 父節點。請用 Hierarchy.setParent() 修改，不要直接改 entity 欄位，
 * 否則子節點索引會不同步。
 */
export const Parent = defineComponent<{ entity: Entity }>('Parent', () => ({ entity: NULL_ENTITY }));

const EMPTY: readonly Entity[] = Object.freeze([]);

/**
 * 父子層級：維護「父 → 子」索引。
 * 銷毀父節點時會一併銷毀所有子孫。
 */
export class Hierarchy {
  private readonly children = new Map<Entity, Entity[]>();
  private readonly offs: (() => void)[] = [];

  /**
   * @param world ECS 世界
   */
  constructor(private readonly world: World) {
    this.offs.push(
      world.onAdd(Parent, (child, p) => this.link(p.entity, child)),
      world.onRemove(Parent, (child, p) => this.unlink(p.entity, child)),
      world.onDestroy((e) => {
        const kids = this.children.get(e);
        if (kids) for (const child of [...kids]) world.destroy(child);
        this.children.delete(e);
      }),
    );
    world.setResource(HierarchyKey, this);
  }

  /** 移除所有父子關係 */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.children.clear();
    if (this.world.getResource(HierarchyKey) === this) this.world.removeResource(HierarchyKey);
  }

  /**
   * 子實體
   * @param e 實體
   */
  childrenOf(e: Entity): readonly Entity[] {
    return this.children.get(e) ?? EMPTY;
  }

  /**
   * 父實體（沒有時是 null）
   * @param e 實體
   */
  parentOf(e: Entity): Entity | null {
    const p = this.world.get(e, Parent);
    return p && this.world.isAlive(p.entity) ? p.entity : null;
  }

  /**
   * 設定父節點；傳 null 代表脫離父節點
   * @param child 子實體
   * @param parent 父實體；null 代表脫離父節點
   */
  setParent(child: Entity, parent: Entity | null): void {
    if (parent !== null) {
      if (!this.world.isAlive(parent)) throw new Error('父節點已銷毀');
      if (parent === child || this.isAncestor(child, parent)) {
        throw new Error('不能把節點設為自己或子孫的子節點');
      }
    }
    if (this.world.get(child, Parent)?.entity === parent) return;
    this.world.remove(child, Parent);
    if (parent !== null) this.world.add(child, Parent, { entity: parent });
  }

  /**
   * ancestor 是否為 e 的祖先
   * @param ancestor 可能的祖先
   * @param e 實體
   */
  isAncestor(ancestor: Entity, e: Entity): boolean {
    let p = this.parentOf(e);
    while (p !== null) {
      if (p === ancestor) return true;
      p = this.parentOf(p);
    }
    return false;
  }

  /**
   * 走訪 e 的所有子孫（深度優先，不含 e 自己）
   * @param e 從這個實體往下找
   * @param fn 每個子孫呼叫一次
   */
  forEachDescendant(e: Entity, fn: (descendant: Entity) => void): void {
    for (const child of this.childrenOf(e)) {
      fn(child);
      this.forEachDescendant(child, fn);
    }
  }

  private link(parent: Entity, child: Entity): void {
    if (parent === NULL_ENTITY) return;
    let list = this.children.get(parent);
    if (!list) this.children.set(parent, (list = []));
    list.push(child);
  }

  private unlink(parent: Entity, child: Entity): void {
    const list = this.children.get(parent);
    if (!list) return;
    const i = list.indexOf(child);
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) this.children.delete(parent);
  }
}
