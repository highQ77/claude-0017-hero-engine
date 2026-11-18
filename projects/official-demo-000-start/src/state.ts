/**
 * 遊戲狀態：跨檔案共用、會改變的數值。只有資料，不引用引擎（engine.ts 也可以安心引用它）。
 * 改數值的地方各自負責更新畫面（hud.ts 的函式）。
 */
import type { Entity } from '@engine/ecs';
import type { CustomMaterial } from '@engine/shaders';

/** 每個場景有幾枚金幣 */
export const COINS_PER_SCENE = 8;
/** 跳躍消耗的體力 */
export const JUMP_COST = 25;
/** 每秒回復的體力 */
export const ENERGY_REGEN = 18;

export const state = {
  /** 玩家的方塊（炸掉或離開場景時是 null） */
  player: null as Entity | null,
  /** 方塊的溶解材質：每次建立方塊都換新的，溶解進度才不會殘留 */
  playerMaterial: null as CustomMaterial | null,
  /** 舞台的攝影機（每個場景重新建立） */
  camera: null as Entity | null,
  /** 3D 控制台面板 */
  kiosk: null as Entity | null,
  /** 攝影機跟隨方塊（C 鍵切換；false 是自動環繞） */
  followCamera: false,
  /** 總分 */
  score: 0,
  /** 這個場景撿了幾枚金幣 */
  coinsThisScene: 0,
  /** 體力（0～100） */
  energy: 100,
};
