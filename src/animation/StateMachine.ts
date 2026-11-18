import type { World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { Animator, playAnimation } from './Animator';

/** 狀態機的參數：名稱 → 數字或布林（轉換條件用） */
export type AnimationParams = Record<string, number | boolean>;

/** 動畫狀態：播放哪個動畫、怎麼播 */
export interface AnimationStateDef {
  /** 播放的片段名稱 */
  clip: string;
  /** 預設 true */
  loop?: boolean;
  /** 播放速度（1 為原速） */
  speed?: number;
  /** 進入此狀態的淡入秒數（轉換上沒有指定時使用） */
  fade?: number;
}

/** 狀態之間的轉換（什麼條件下從哪個狀態切到哪個狀態） */
export interface AnimationTransitionDef {
  /** 來源狀態；'*' 代表任何狀態 */
  from: string | '*';
  /** 轉換到的狀態 */
  to: string;
  /** 條件：根據參數判斷 */
  when?: (params: AnimationParams) => boolean;
  /** 觸發器：呼叫 trigger(name) 的那一幀才成立（用一次就消失） */
  trigger?: string;
  /** 目前片段播完才成立（搭配 loop: false 的狀態） */
  onFinish?: boolean;
  /** 這次轉換的淡入淡出秒數 */
  fade?: number;
}

/** 動畫狀態機的定義 */
export interface AnimationStateMachineDef {
  /** 一開始的狀態 */
  initial: string;
  /** 所有狀態：名稱 → 設定 */
  states: Record<string, AnimationStateDef>;
  /** 依順序檢查，第一個成立的生效 */
  transitions: AnimationTransitionDef[];
}

/**
 * 動畫狀態機：依參數、觸發器、播放結束自動切換 Animator 的片段。
 * 需要同一個實體上也有 Animator。
 * @example
 * world.add(e, AnimationStateMachine, { definition: {
 *   initial: 'idle',
 *   states: { idle: { clip: 'Idle' }, run: { clip: 'Run' }, attack: { clip: 'Attack', loop: false } },
 *   transitions: [
 *     { from: 'idle', to: 'run', when: (p) => (p.speed as number) > 0.1 },
 *     { from: 'run', to: 'idle', when: (p) => (p.speed as number) <= 0.1 },
 *     { from: '*', to: 'attack', trigger: 'attack' },
 *     { from: 'attack', to: 'idle', onFinish: true },
 *   ],
 * }});
 * world.get(e, AnimationStateMachine)!.params.speed = 3;
 * play.trigger(world.get(e, AnimationStateMachine)!, 'attack');
 */
export interface AnimationStateMachineData {
  /** 狀態機的定義 */
  definition: AnimationStateMachineDef | null;
  /** 目前的參數（設定 params.speed 等，轉換條件會依它判斷） */
  params: AnimationParams;
  /** 本幀的觸發器（請用 triggerAnimation） */
  triggers: Set<string>;
  /** 目前狀態（由系統填寫） */
  state: string | null;
  /** 上一個狀態（由系統填寫） */
  previous: string | null;
}

/** 動畫狀態機元件：依參數與觸發器自動切換模型動畫（搭配 Animator） */
export const AnimationStateMachine = defineComponent<AnimationStateMachineData>('AnimationStateMachine', () => ({
  definition: null,
  params: {},
  triggers: new Set(),
  state: null,
  previous: null,
}));

export function triggerAnimation(sm: AnimationStateMachineData, name: string): void {
  sm.triggers.add(name);
}

const validated = new WeakSet<AnimationStateMachineDef>();

function validate(def: AnimationStateMachineDef): void {
  if (validated.has(def)) return;
  if (!def.states[def.initial]) throw new Error(`狀態機的初始狀態「${def.initial}」不存在`);
  for (const t of def.transitions) {
    if (t.from !== '*' && !def.states[t.from]) throw new Error(`轉換的來源狀態「${t.from}」不存在`);
    if (!def.states[t.to]) throw new Error(`轉換的目標狀態「${t.to}」不存在`);
  }
  validated.add(def);
}

/** 每幀評估所有狀態機（在 Animator 更新之前） */
export function updateStateMachines(world: World): void {
  world.query([AnimationStateMachine, Animator]).each((_e, sm, animator) => {
    const def = sm.definition;
    if (!def) return;
    validate(def);

    const enter = (name: string, fade?: number) => {
      const state = def.states[name];
      sm.previous = sm.state;
      sm.state = name;
      playAnimation(animator, state.clip, {
        loop: state.loop ?? true,
        speed: state.speed ?? 1,
        fade: fade ?? state.fade ?? animator.fade,
        restart: true, // 進入狀態一律從頭播放（例如連續攻擊）
      });
    };

    if (sm.state === null || !def.states[sm.state]) {
      enter(def.initial, 0);
    } else {
      for (const t of def.transitions) {
        if (t.from !== '*' && t.from !== sm.state) continue;
        if (t.from === '*' && t.to === sm.state && !t.trigger) continue; // 避免「任何狀態」一直重新進入自己
        if (t.trigger && !sm.triggers.has(t.trigger)) continue;
        // 剛進入的狀態，Animator 還沒更新 → 不能用上一個片段的 finished 判斷
        if (t.onFinish && !(animator.finished && animator.current === def.states[sm.state].clip)) continue;
        if (t.when && !t.when(sm.params)) continue;
        if (t.trigger) sm.triggers.delete(t.trigger);
        enter(t.to, t.fade);
        break;
      }
    }
    // 沒被用掉的觸發器只保留一幀
    sm.triggers.clear();
  });
}
