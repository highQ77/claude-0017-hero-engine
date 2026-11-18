import * as THREE from 'three';
import type { Entity } from '../ecs';
import { defineComponent } from '../ecs/Component';
import type { BehaviorTree } from './BehaviorTree';

/** 轉向行為：停止、前往、抵達（接近時減速）、逃離、追擊、躲避、漫步 */
export type SteeringMode = 'idle' | 'seek' | 'arrive' | 'flee' | 'pursue' | 'evade' | 'wander';

/**
 * 轉向移動的角色。設定 mode 與 target（或 targetEntity），系統會讓它平滑地移動與轉向。
 * - 沒有剛體或運動學剛體：直接移動 Transform
 * - 動態剛體：設定物理速度（建議鎖住 x、z 旋轉）
 */
export interface SteeringAgentData {
  /** 目前的轉向行為 */
  mode: SteeringMode;
  /** 目標位置（seek、arrive、flee） */
  target: { x: number; y: number; z: number } | null;
  /** 目標實體（優先於 target；pursue、evade 會預測它的移動） */
  targetEntity: Entity | null;
  /** 最快速度（公尺／秒） */
  maxSpeed: number;
  /** 轉向力上限：越大轉彎越靈活 */
  maxForce: number;
  /** arrive：開始減速的距離 */
  slowRadius: number;
  /** 離目標多近算抵達 */
  stopDistance: number;
  /** 與其他角色保持距離的權重（0 為關閉） */
  separation: number;
  /** 和其他角色保持的距離（公尺） */
  separationRadius: number;
  /** 朝向移動方向（-Z 為前方） */
  faceMovement: boolean;
  /** 轉身速度 */
  turnSpeed: number;
  /** 只在 XZ 平面移動 */
  planar: boolean;

  // ── 由系統填寫 ──
  /** 目前的速度（每幀更新） */
  velocity: THREE.Vector3;
  /** 已抵達目標（arrive、seek） */
  arrived: boolean;
  /** wander 的內部狀態 */
  wanderAngle: number;
}

/** 轉向角色元件：依轉向行為移動實體（AIPlugin 每幀更新） */
export const SteeringAgent = defineComponent<SteeringAgentData>('SteeringAgent', () => ({
  mode: 'idle',
  target: null,
  targetEntity: null,
  maxSpeed: 3,
  maxForce: 10,
  slowRadius: 1.5,
  stopDistance: 0.15,
  separation: 1,
  separationRadius: 1,
  faceMovement: true,
  turnSpeed: 10,
  planar: true,
  velocity: new THREE.Vector3(),
  arrived: false,
  wanderAngle: Math.random() * Math.PI * 2,
}));

/** 找路狀態：沒有目的地、移動中、已抵達、到不了 */
export type PathStatus = 'idle' | 'moving' | 'arrived' | 'unreachable';

/**
 * 沿著導航網格找路並移動（需要同一實體上有 SteeringAgent，以及已設定的 NavGrid）。
 * 設定 destination 或 targetEntity 即可；目標移動時會自動重新找路。
 */
export interface PathFollowerData {
  /** 目的地（世界座標）；設定後自動找路 */
  destination: { x: number; y: number; z: number } | null;
  /** 跟隨實體（優先於 destination） */
  targetEntity: Entity | null;
  /** 至少隔多久重新找路（秒） */
  repathInterval: number;
  /** 目標移動超過這個距離才重新找路 */
  repathDistance: number;
  /** 離路徑點多近算經過 */
  waypointRadius: number;

  // ── 由系統填寫 ──
  /** 找到的路徑（經過的點） */
  path: THREE.Vector3[];
  /** 目前走到第幾個點 */
  index: number;
  /** 目前的狀態 */
  status: PathStatus;
}

/** 找路元件：在導航網格上找路並沿著路徑走（需要 SteeringAgent） */
export const PathFollower = defineComponent<PathFollowerData>('PathFollower', () => ({
  destination: null,
  targetEntity: null,
  repathInterval: 0.5,
  repathDistance: 0.75,
  waypointRadius: 0.4,
  path: [],
  index: 0,
  status: 'idle',
}));

/**
 * 大腦：每幀執行一次行為樹。每個實體要有自己的一棵樹（請用函式建立）。
 */
export interface BrainData {
  /** 行為樹（每幀執行） */
  tree: BehaviorTree<object> | null;
  /** 行為樹的記憶（節點之間共用的資料，例如巡邏點、目標） */
  blackboard: Record<string, unknown>;
  /** 每秒思考幾次（0 為每幀）；思考頻率低一點可以省效能 */
  tickRate: number;
  /** 是否啟用 */
  enabled: boolean;
  /** 由系統填寫 */
  status: 'success' | 'failure' | 'running' | null;
  /** 內部計時 */
  accumulator: number;
}

/** 大腦元件：每幀執行實體的行為樹 */
export const Brain = defineComponent<BrainData>('Brain', () => ({
  tree: null,
  blackboard: {},
  tickRate: 0,
  enabled: true,
  status: null,
  accumulator: 0,
}));
