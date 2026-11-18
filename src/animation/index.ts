import { playAnimation } from './Animator';
import { triggerAnimation, updateStateMachines } from './StateMachine';
import { resolveEasing } from './Easing';
import { createClip } from './clips';
export type { ClipTrack } from './clips';
// 模型動畫片段的型別（Animator.clips、Model.animations），遊戲程式不用 import three
export type { AnimationClip } from 'three';
export { Easing } from './Easing';
export type { EasingFn, EasingName } from './Easing';
export { Timeline, Tween, TweenManager } from './Tween';
export type { TweenOptions, StepOptions, PlayOptions, TweenProps, TweenState } from './Tween';
export { Animator, AnimatorController } from './Animator';
export { animatorCodec } from './sceneCodecs';
export type { AnimatorData, PlayAnimationOptions } from './Animator';
export { AnimationStateMachine } from './StateMachine';
export type {
  AnimationStateMachineData,
  AnimationStateMachineDef,
  AnimationStateDef,
  AnimationTransitionDef,
  AnimationParams,
} from './StateMachine';
export {
  AnimationPlugin,
  TweensKey,
  TWEEN_PRIORITY,
  STATE_MACHINE_PRIORITY,
  ANIMATOR_PRIORITY,
} from './AnimationPlugin';

// ───────── 小工具函式（依用途分類）─────────

/** 建立物件：模型動畫片段（animation 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 用資料建立模型動畫片段：create.clip('wave', { 'arm.rotation': { times: [0, 1], values: [[0, 0, 0], [0, 0, 1]] } }) */
  clip: createClip,
} as const;

/** 播放：動畫、觸發器、音效、粒子爆發（animation 模組的部分；總入口 hero.play 有全部） */
export const play = {
  /** 播放模型動畫（Animator） */
  animation: playAnimation,
  /** 觸發動畫狀態機的觸發器 */
  trigger: triggerAnimation,
} as const;

/** 數學小工具：朝向、世界座標、向量轉換、緩動曲線（animation 模組的部分；總入口 hero.math 有全部） */
export const math = {
  /** 取得緩動函式：math.easing('quadOut')(0.5) */
  easing: resolveEasing,
} as const;

/** 立刻更新（平常由外掛每幀自動更新；需要馬上拿到結果時用）（animation 模組的部分；總入口 hero.tick 有全部） */
export const tick = {
  /** 立刻更新所有動畫狀態機（平常由動畫外掛每幀自動更新） */
  stateMachines: updateStateMachines,
} as const;
