import type { AnimationClip, Object3D } from 'three';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { SceneObject } from '../render/components';
import type { AssetManager } from './AssetManager';
import { instantiate } from './dispose';
import { createLogger } from '../core/Logger';

const log = createLogger('assets');

/** 模型狀態：尚未載入、載入中、可以使用、載入失敗 */
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 模型：給網址就會自動載入 glTF，完成後加上 SceneObject 顯示出來。
 * 改 url 會換模型；移除元件或銷毀實體會自動釋放資源。
 */
export interface ModelData {
  /** 模型網址（glTF／GLB） */
  url: string;
  /** 投射陰影 */
  castShadow: boolean;
  /** 接收陰影 */
  receiveShadow: boolean;
  /** 以下由系統填寫，請勿手動修改 */
  status: ModelStatus;
  /** 載入失敗時的錯誤（成功時是 null） */
  error: Error | null;
  /** 模型附帶的動畫片段（給動畫模組使用） */
  animations: AnimationClip[];
}

/** 模型元件：載入 glTF 模型並放在實體的位置 */
export const Model = defineComponent<ModelData>('Model', () => ({
  url: '',
  castShadow: false,
  receiveShadow: false,
  status: 'idle',
  error: null,
  animations: [],
}));

interface Tracked {
  url: string;
  token: number;
  object: Object3D | null;
  castShadow: boolean;
  receiveShadow: boolean;
}

/**
 * 模型載入控制：載入結果先排入佇列，下一次 update 開頭才寫回 ECS，
 * 避免非同步回呼在系統走訪途中修改資料。
 */
export class ModelController {
  private readonly tracked = new Map<Entity, Tracked>();
  private readonly results: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];
  private nextToken = 1;

  /**
   * @param world ECS 世界
   * @param assets 資源管理器
   */
  constructor(
    private readonly world: World,
    private readonly assets: AssetManager,
  ) {
    this.offs.push(
      world.onAdd(Model, (e) => this.start(e)),
      world.onRemove(Model, (e) => this.stop(e, true)),
    );
    for (const e of world.query([Model]).entities) this.start(e);
  }

  /** 每幀呼叫：套用已完成的載入、偵測網址或陰影設定的變更 */
  update(): void {
    for (const apply of this.results.splice(0)) apply();
    for (const [e, t] of [...this.tracked]) {
      const model = this.world.get(e, Model);
      if (!model) continue;
      if (model.url !== t.url) {
        this.stop(e, false);
        this.start(e);
      } else if (t.object && (model.castShadow !== t.castShadow || model.receiveShadow !== t.receiveShadow)) {
        this.applyShadows(t, model);
      }
    }
  }

  /** 移除所有模型 */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const e of [...this.tracked.keys()]) this.stop(e, false);
    this.results.length = 0;
  }

  private start(e: Entity): void {
    const model = this.world.get(e, Model)!;
    const t: Tracked = {
      url: model.url,
      token: this.nextToken++,
      object: null,
      castShadow: false,
      receiveShadow: false,
    };
    this.tracked.set(e, t);
    model.error = null;
    model.animations = [];
    if (!model.url) {
      model.status = 'idle';
      return;
    }
    model.status = 'loading';
    this.assets.load(model.url, 'gltf').then(
      (gltf) => this.results.push(() => this.finish(e, t, gltf.scene, gltf.animations)),
      (error: Error) => this.results.push(() => this.fail(e, t, error)),
    );
  }

  private finish(e: Entity, t: Tracked, source: Object3D, animations: AnimationClip[]): void {
    if (this.tracked.get(e) !== t) return; // 已換網址或已移除
    const model = this.world.get(e, Model)!;
    const object = instantiate(source);
    t.object = object;
    this.applyShadows(t, model);
    model.status = 'ready';
    model.animations = animations;
    this.world.add(e, SceneObject).object = object;
  }

  private fail(e: Entity, t: Tracked, error: Error): void {
    if (this.tracked.get(e) !== t) return;
    const model = this.world.get(e, Model)!;
    model.status = 'error';
    model.error = error;
    log.error(error);
  }

  private stop(e: Entity, removed: boolean): void {
    const t = this.tracked.get(e);
    if (!t) return;
    this.tracked.delete(e);
    if (t.url) this.assets.release(t.url, 'gltf');
    // 拿掉自己放上去的物件（實體銷毀時 SceneObject 會自動移除）
    const so = this.world.isAlive(e) ? this.world.get(e, SceneObject) : undefined;
    if (so && t.object && so.object === t.object) {
      if (removed) this.world.remove(e, SceneObject);
      else so.object = null;
    }
  }

  private applyShadows(t: Tracked, model: ModelData): void {
    t.castShadow = model.castShadow;
    t.receiveShadow = model.receiveShadow;
    t.object?.traverse((o) => {
      o.castShadow = model.castShadow;
      o.receiveShadow = model.receiveShadow;
    });
  }
}
