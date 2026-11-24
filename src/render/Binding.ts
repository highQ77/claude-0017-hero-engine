import type { Object3D, Scene } from 'three';
import type { ComponentType, Entity, World } from '../ecs';
import { Transform } from '../scene';

/** 元件 → three.js 物件的對應方式（建立、更新、移除） */
export interface BindingSpec<T, O extends Object3D> {
  /** 對應的元件 */
  readonly type: ComponentType<T>;
  /**
   * 元件加上時建立對應的 three.js 物件；回傳 null 代表暫不建立
   * @param data 元件的資料
   * @param entity 實體
   */
  create(data: T, entity: Entity): O | null;
  /**
   * 每幀同步資料；回傳新物件代表要替換（例如燈光種類改變）
   * @param object 目前的 three.js 物件
   * @param data 元件的資料
   * @param entity 實體
   */
  update(object: O, data: T, entity: Entity): O | null | void;
  /**
   * 物件被移除或替換時呼叫
   * @param object 要釋放的 three.js 物件
   */
  dispose?(object: O): void;
}

/** 標記在 object.userData 上，代表不跟隨實體的變換 */
export const IGNORE_TRANSFORM = 'ignoreTransform';

/**
 * 綁定：讓某種元件與 three.js 物件一對一對應。
 * three.js 場景保持扁平，位置一律由 Transform 的世界矩陣決定。
 */
export class Binding<T, O extends Object3D> {
  private readonly objects = new Map<Entity, O>();
  private readonly offs: (() => void)[] = [];

  /**
   * @param world ECS 世界
   * @param root three.js 場景（物件加在這裡）
   * @param spec 元件與建立、更新、釋放物件的函式
   */
  constructor(
    private readonly world: World,
    private readonly root: Scene,
    private readonly spec: BindingSpec<T, O>,
  ) {
    this.offs.push(
      world.onAdd(spec.type, (e, data) => this.attach(e, data)),
      world.onRemove(spec.type, (e) => this.detach(e)),
    );
    // 安裝前就存在的實體
    for (const e of world.query([spec.type]).entities) this.attach(e, world.get(e, spec.type)!);
  }

  /**
   * 實體對應的 three.js 物件
   * @param e 實體
   */
  get(e: Entity): O | undefined {
    return this.objects.get(e);
  }

  /** 所有實體與 three.js 物件 */
  entries(): IterableIterator<[Entity, O]> {
    return this.objects.entries();
  }

  /** 把元件的資料同步到 three.js 物件（每幀呼叫） */
  sync(): void {
    const world = this.world;
    for (const [e, data] of this.pending()) this.attach(e, data);
    // 用快照走訪：替換物件時會改動 Map
    for (const [e, current] of [...this.objects]) {
      const data = world.get(e, this.spec.type);
      if (data === undefined) continue;
      let object = current;
      const replacement = this.spec.update(current, data, e);
      if (replacement === null) {
        this.detach(e);
        continue;
      }
      if (replacement && replacement !== current) {
        this.detach(e);
        this.place(e, replacement);
        object = replacement;
        // 新物件立刻同步一次，避免這一幀用預設值繪製
        this.spec.update(object, data, e);
      }
      if (object.userData[IGNORE_TRANSFORM]) continue;
      const t = world.get(e, Transform);
      if (t) {
        object.matrix.copy(t.worldMatrix);
        object.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /** 移除所有物件 */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const e of [...this.objects.keys()]) this.detach(e);
  }

  /** create() 曾回傳 null 的實體，每幀再試一次（例如 object 欄位之後才填入） */
  private *pending(): Generator<[Entity, T]> {
    if (this.objects.size === this.world.query([this.spec.type]).size) return;
    for (const e of this.world.query([this.spec.type]).entities) {
      if (!this.objects.has(e)) yield [e, this.world.get(e, this.spec.type)!];
    }
  }

  private attach(e: Entity, data: T): void {
    if (this.objects.has(e)) return;
    const object = this.spec.create(data, e);
    if (object) this.place(e, object);
  }

  private place(e: Entity, object: O): void {
    object.matrixAutoUpdate = false;
    object.userData.entity = e; // 之後點選物件時可以反查實體
    this.root.add(object);
    this.objects.set(e, object);
  }

  private detach(e: Entity): void {
    const object = this.objects.get(e);
    if (!object) return;
    object.removeFromParent();
    this.spec.dispose?.(object);
    this.objects.delete(e);
  }
}
