/**
 * Hero Engine 的總入口：所有模組的 API 都可以從這裡取得。
 *
 *   import * as hero from '@engine';
 *   const engine = new hero.Engine();
 *   const camera = hero.spawn.camera(world, { position: [0, 2, 6] });
 *
 * 也可以照樣分模組引用（import { Engine } from '@engine/core'），兩種寫法拿到的是同一個東西。
 * 打包時只會包含用到的部分；不過分類物件是整組一起的（例如用了 hero.create.geometry，hero.create 裡其他函式也會包含，都很小）。
 *
 * 小工具函式依用途分類：hero.spawn.camera、hero.create.geometry、hero.math.lookAt、hero.steer.seek…
 * 元件可以用 元件.with(初始值) 指定初始值：world.spawn(hero.Camera.with({ fov: 50 }))
 *
 * 不包含：套件（@engine/packages/…，用 PluginManager 安裝）與 UI 編輯器（開發工具）。
 */
import { create as core_create } from './core';
import { define as ecs_define } from './ecs';
import { create as scene_create, load as scene_load, math as scene_math, tick as scene_tick } from './scene';
import { create as render_create, math as render_math } from './render';
import {
  create as animation_create,
  math as animation_math,
  tick as animation_tick,
  play as animation_play,
} from './animation';
import { load as physics_load } from './physics';
import { create as particles_create, play as particles_play } from './particles';
import { play as audio_play } from './audio';
import { register as assets_register } from './assets';
import { load as ui2d_load } from './ui2d';
import { load as text3d_load } from './text3d';
import { create as text3d_create } from './text3d/create';
import { create as postfx_create } from './postfx';
import { register as shaders_register } from './shaders';
import { define as plugins_define } from './plugins';
export * from './core';
export * from './math';
export * from './ecs';
export * from './scene';
export * from './input';
export * from './render';
export * from './scripts';
export * from './animation';
export * from './physics';
export * from './particles';
export * from './audio';
export * from './assets';
export * from './ui2d';
export * from './ui3d';
export * from './text3d';
export * from './postfx';
export * from './shaders';
export * from './ai';
export * from './network';
export * from './plugins';

// 名稱重複：Binding 是繪製的綁定類別；輸入的按鍵字串型別改叫 InputBinding
export { Binding } from './render';
export type { Binding as InputBinding } from './input';

// ───────── 小工具函式的分類 ─────────
// 各模組有自己的那一部分（例如 '@engine/render' 的 create 只有 geometry、material），
// 總入口把同名的分類合在一起：hero.create.geometry、hero.create.particleTexture、hero.create.config…
// /* @__PURE__ */：沒用到的分類打包時整個去掉（物件展開 ... 本身打包工具無法確定沒有副作用）
//   spawn（建立實體）  define（定義元件、資源、套件）  create（建立物件）  math（數學）
//   tick（立刻更新）   play（播放）  load（載入）  register（註冊）  collision（碰撞）
//   steer（轉向）  sense（感知）  uiXml（介面檔）  parse（解析）  draw（2D 繪圖）
//   measure（文字量測）  env（環境）  glsl（著色器）  object3d（three.js 物件）
//   entityId（實體編號）  semver（版本號）  integrity（完整性驗證）  sceneFile（場景檔）

/** 定義：元件、標籤、資源、套件 */
export const define = /* @__PURE__ */ (() => ({ ...ecs_define, ...plugins_define }) as const)();
/** 建立物件：幾何、材質、貼圖、設定… */
export const create = /* @__PURE__ */ (() =>
  ({
    ...core_create,
    ...scene_create,
    ...render_create,
    ...animation_create,
    ...particles_create,
    ...postfx_create,
    ...text3d_create,
  }) as const)();
/** 數學小工具：朝向、世界座標、向量轉換、緩動曲線 */
export const math = /* @__PURE__ */ (() => ({ ...scene_math, ...render_math, ...animation_math }) as const)();
/** 立刻更新（平常由外掛每幀自動更新；需要馬上拿到結果時用） */
export const tick = /* @__PURE__ */ (() => ({ ...scene_tick, ...animation_tick }) as const)();
/** 播放：動畫、觸發器、音效、粒子爆發 */
export const play = /* @__PURE__ */ (() => ({ ...animation_play, ...particles_play, ...audio_play }) as const)();
/** 載入：場景檔、物理引擎、排版引擎、內建字型（外掛建立時會自動載入） */
export const load = /* @__PURE__ */ (() =>
  ({ ...scene_load, ...physics_load, ...ui2d_load, ...text3d_load }) as const)();
/** 註冊：內建載入器、著色器片段 */
export const register = /* @__PURE__ */ (() => ({ ...assets_register, ...shaders_register }) as const)();
