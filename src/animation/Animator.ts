import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { Model } from '../assets/Model';
import { createLogger } from '../core/Logger';

const log = createLogger('animation');

/**
 * 動畫播放器：播放模型裡的動畫片段（骨架、子節點、變形目標）。
 *
 * 只要把 play 設成片段名稱，系統就會交叉淡入淡出到該片段。
 * 片段來源：clips 有給就用 clips，否則自動使用 Model 載入的動畫。
 *
 * 注意：根物件本身的位置由 Transform 決定，片段裡對根物件位移的動畫不會生效；
 * 要移動整個實體請用 Tween 改 Transform。
 */
export interface AnimatorData {
  /** 自訂片段；null 代表使用 Model 的動畫 */
  clips: THREE.AnimationClip[] | null;
  /** 想播放的片段名稱；null 代表淡出停止 */
  play: string | null;
  /** 是否重複播放 */
  loop: boolean;
  /** 播放速度 */
  speed: number;
  /** 切換時的淡入淡出秒數 */
  fade: number;
  /** 暫停 */
  paused: boolean;
  /** 遞增此值可強制從頭播放（用 playAnimation 的 restart 選項即可） */
  token: number;

  // ── 以下由系統填寫 ──
  /** 目前播放中的片段 */
  current: string | null;
  /** 目前片段的播放時間（秒） */
  time: number;
  /** 目前片段長度（秒） */
  duration: number;
  /** 不循環的片段是否已播完 */
  finished: boolean;
}

/** 模型動畫元件：播放 glTF 模型內含的動畫（搭配 Model 元件） */
export const Animator = defineComponent<AnimatorData>('Animator', () => ({
  clips: null,
  play: null,
  loop: true,
  speed: 1,
  fade: 0.25,
  paused: false,
  token: 0,
  current: null,
  time: 0,
  duration: 0,
  finished: false,
}));

/** 播放模型動畫的設定 */
export interface PlayAnimationOptions {
  /** 是否重複（預設 true） */
  loop?: boolean;
  /** 播放速度（1 為原速） */
  speed?: number;
  /** 和前一個動畫交叉淡化的秒數 */
  fade?: number;
  /** 即使正在播放同一個片段，也從頭播放 */
  restart?: boolean;
}

/**
 * 播放片段的便利函式
 * @param animator Animator 元件的資料
 * @param name 動畫片段名稱（null 停止播放）
 * @param options 淡入秒數、速度、是否循環
 */
export function playAnimation(animator: AnimatorData, name: string | null, options: PlayAnimationOptions = {}): void {
  animator.play = name;
  if (options.loop !== undefined) animator.loop = options.loop;
  if (options.speed !== undefined) animator.speed = options.speed;
  if (options.fade !== undefined) animator.fade = options.fade;
  if (options.restart) animator.token++;
}

interface Tracked {
  root: THREE.Object3D;
  clips: readonly THREE.AnimationClip[];
  mixer: THREE.AnimationMixer;
  name: string | null;
  token: number;
  action: THREE.AnimationAction | null;
  finishedAction: THREE.AnimationAction | null;
  warned: Set<string>;
}

/**
 * 管理每個實體的 AnimationMixer。
 * getRoot 決定動畫作用在哪個 three.js 物件上（由 AnimationPlugin 提供）。
 */
export class AnimatorController {
  private readonly tracked = new Map<Entity, Tracked>();
  private readonly off: () => void;

  /**
   * @param world ECS 世界
   * @param getRoot 取得實體的 three.js 物件（模型的根節點）
   */
  constructor(
    private readonly world: World,
    private readonly getRoot: (e: Entity) => THREE.Object3D | null | undefined,
  ) {
    this.off = world.onRemove(Animator, (e) => this.release(e));
  }

  /**
   * 取得實體的 mixer（進階用途，例如直接操作 AnimationAction）
   * @param e 實體
   */
  mixerOf(e: Entity): THREE.AnimationMixer | undefined {
    return this.tracked.get(e)?.mixer;
  }

  /**
   * 更新所有模型動畫（每幀由外掛呼叫）
   * @param delta 經過的時間（秒）
   */
  update(delta: number): void {
    this.world.query([Animator]).each((e, a) => {
      const root = this.getRoot(e) ?? null;
      const clips = a.clips ?? this.world.get(e, Model)?.animations ?? EMPTY;
      let t = this.tracked.get(e);

      // 根物件或片段清單換了（例如模型重新載入）→ 重建
      if (t && (t.root !== root || t.clips !== clips)) {
        this.release(e);
        t = undefined;
      }
      if (!root) {
        a.current = null;
        a.time = a.duration = 0;
        a.finished = false;
        return;
      }
      if (!t) t = this.create(e, root, clips);

      if (a.play !== t.name || a.token !== t.token) this.transition(t, a);

      if (t.action) {
        t.action.setLoop(a.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        t.action.clampWhenFinished = !a.loop;
      }
      t.mixer.timeScale = a.paused ? 0 : a.speed;
      t.mixer.update(delta);

      a.current = t.action ? t.name : null;
      a.time = t.action?.time ?? 0;
      a.duration = t.action?.getClip().duration ?? 0;
      a.finished = t.action !== null && t.finishedAction === t.action;
    });
  }

  /** 停止並移除所有模型動畫 */
  dispose(): void {
    this.off();
    for (const e of [...this.tracked.keys()]) this.release(e);
  }

  private create(e: Entity, root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): Tracked {
    const mixer = new THREE.AnimationMixer(root);
    const t: Tracked = {
      root,
      clips,
      mixer,
      name: null,
      token: -1,
      action: null,
      finishedAction: null,
      warned: new Set(),
    };
    mixer.addEventListener('finished', (ev) => {
      t.finishedAction = ev.action;
    });
    this.tracked.set(e, t);
    return t;
  }

  private transition(t: Tracked, a: AnimatorData): void {
    const prev = t.action;
    t.name = a.play;
    t.token = a.token;
    t.finishedAction = null;

    const clip = a.play === null ? undefined : t.clips.find((c) => c.name === a.play);
    if (a.play !== null && !clip && !t.warned.has(a.play)) {
      t.warned.add(a.play);
      log.warn(`找不到動畫片段「${a.play}」，可用的有：${t.clips.map((c) => c.name).join('、') || '（無）'}`);
    }
    if (!clip) {
      if (prev) a.fade > 0 ? prev.fadeOut(a.fade) : prev.stop();
      t.action = null;
      return;
    }

    const next = t.mixer.clipAction(clip);
    next.reset();
    next.setLoop(a.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !a.loop;
    if (prev && prev !== next) {
      if (a.fade > 0) {
        prev.fadeOut(a.fade);
        next.fadeIn(a.fade);
      } else {
        prev.stop();
      }
    }
    next.play();
    t.action = next;
  }

  private release(e: Entity): void {
    const t = this.tracked.get(e);
    if (!t) return;
    t.mixer.stopAllAction();
    t.mixer.uncacheRoot(t.root);
    this.tracked.delete(e);
  }
}

const EMPTY: readonly THREE.AnimationClip[] = Object.freeze([]);
