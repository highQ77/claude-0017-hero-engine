import { arrive, evade, flee, pursue, seek, separation, truncate, wander } from './steering';
import { canSee, distanceBetween } from './perception';
export { StateMachine } from './StateMachine';
export type { FsmState } from './StateMachine';
export { BehaviorTree, BTNode, BT, Sequence, Selector, Parallel } from './BehaviorTree';
export type { BTStatus, BTContext } from './BehaviorTree';
export { NavGrid } from './NavGrid';
export { navGridToFile, navGridFromFile, encodeWalkable, decodeWalkable } from './sceneSettings';
export type { NavGridFile } from './sceneSettings';
export type { NavGridOptions, BakeOptions, PathOptions } from './NavGrid';

export { SteeringAgent, PathFollower, Brain } from './components';
export type { SteeringAgentData, SteeringMode, PathFollowerData, PathStatus, BrainData } from './components';

export type { SightOptions } from './perception';
export { AIPlugin, NavGridKey, BRAIN_PRIORITY, PATH_PRIORITY, STEERING_PRIORITY } from './AIPlugin';

// ───────── 小工具函式（依用途分類）─────────

/** 轉向：計算讓角色移動的力（seek 前往、flee 逃離、arrive 抵達、pursue 追擊、wander 漫步…） */
export const steer = {
  /** 朝目標前進的轉向力 */
  seek: seek,
  /** 遠離威脅的轉向力 */
  flee: flee,
  /** 前往目標並在接近時減速 */
  arrive: arrive,
  /** 預測目標的位置追過去 */
  pursue: pursue,
  /** 預測威脅的位置躲開 */
  evade: evade,
  /** 隨機漫步 */
  wander: wander,
  /** 和鄰居保持距離 */
  separation: separation,
  /** 限制向量長度 */
  truncate: truncate,
} as const;

/** 感知：視線判斷、實體之間的距離 */
export const sense = {
  /** 視線判斷（距離、視角、遮擋） */
  canSee: canSee,
  /** 兩個實體之間的距離 */
  distance: distanceBetween,
} as const;
