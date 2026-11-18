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
  version: ENGINE_VERSION,
  THREE,
  core,
  ecs,
  scene,
  render,
  assets,
  input,
  animation,
  audio,
  physics,
  particles,
  shaders,
  scripts,
  ai,
  ui2d,
  text3d,
};

/** 完整引擎 API 的型別 */
export type EngineApi = typeof engineApi;

/** PluginManager 的 api 選項：要給套件使用的模組（version、THREE 會自動加上） */
export type EngineApiModules = Partial<Omit<EngineApi, 'version' | 'THREE'>>;
