/**
 * 提供給第三方套件的完整引擎 API（所有模組）。
 * PluginManager 不會自動帶入它：要讓套件使用全部模組時寫 new PluginManager(engine, { api: engineApi })，
 * 或只給需要的模組 new PluginManager(engine, { api: { ui2d, render } })，打包時只包含給的模組。
 * 套件透過 ctx.api 取得 three.js 與各模組，不需要（也不應該）自己打包一份：
 * 同一個 three.js 才能讓 instanceof 判斷正確，也避免檔案變大。
 */
import * as THREE from 'three';
import * as core from '../core';
import * as ecs from '../ecs';
import * as scene from '../scene';
import * as render from '../render';
import * as assets from '../assets';
import * as input from '../input';
import * as animation from '../animation';
import * as audio from '../audio';
import * as physics from '../physics';
import * as particles from '../particles';
import * as shaders from '../shaders';
import * as scripts from '../scripts';
import * as ai from '../ai';
import * as ui2d from '../ui2d';
import * as text3d from '../text3d';

import { ENGINE_VERSION } from '../core/version';

export { ENGINE_VERSION };

/** 給第三方套件的完整引擎 API（所有模組）：new PluginManager(engine, { api: engineApi }) */
export const engineApi = {
  /** 引擎版本 */
  version: ENGINE_VERSION,
  /** three.js（和引擎用的是同一份，不要另外 import 一份） */
  THREE,
  /** 核心：Engine、Plugin、時間、計時器、記錄、存檔 */
  core,
  /** ECS：World、元件、系統、查詢 */
  ecs,
  /** 場景：Transform、階層、場景檔、SceneManager */
  scene,
  /** 繪製：攝影機、燈光、網格、spawn、create */
  render,
  /** 資源：下載、快取、模型 */
  assets,
  /** 輸入：鍵盤、滑鼠、觸控、手把、動作綁定 */
  input,
  /** 動畫：補間（Tween、Timeline）、模型動畫（Animator）、狀態機 */
  animation,
  /** 音效：音效、音樂、3D 音源 */
  audio,
  /** 物理：剛體、碰撞體、射線 */
  physics,
  /** 粒子特效 */
  particles,
  /** 著色器：自訂材質、全螢幕效果、節點圖 */
  shaders,
  /** 腳本元件 */
  scripts,
  /** AI：行為樹、狀態機、尋路、操控行為 */
  ai,
  /** 2D 介面（XML） */
  ui2d,
  /** 3D 文字 */
  text3d,
};

/** 完整引擎 API 的型別 */
export type EngineApi = typeof engineApi;

/** PluginManager 的 api 選項：要給套件使用的模組（version、THREE 會自動加上） */
export type EngineApiModules = Partial<Omit<EngineApi, 'version' | 'THREE'>>;
