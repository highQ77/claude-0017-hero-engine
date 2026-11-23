/**
 * 引擎與外掛設定：這個範例用到引擎的所有外掛。
 * 其他檔案用 import { engine, world, ui, audio, … } from './engine' 取用。
 *
 * - 一行一個外掛，照順序安裝（有相依的在後面；不要調換順序）
 * - 「建立時就決定」的設定（陰影、動態解析度、物理…）改這裡；執行中可以改的在各自的檔案改
 */
import { AIPlugin } from '@engine/ai';
import { AnimationPlugin } from '@engine/animation';
import { AssetPlugin } from '@engine/assets';
import { AudioPlugin } from '@engine/audio';
import { Engine, type Plugin } from '@engine/core';
import { EcsPlugin } from '@engine/ecs';
import { InputPlugin } from '@engine/input';
import { NetworkPlugin } from '@engine/network';
import { ParticlePlugin } from '@engine/particles';
import { PhysicsPlugin } from '@engine/physics';
import { PostProcessingPlugin } from '@engine/postfx';
import { RenderPlugin } from '@engine/render';
import { ScenePlugin } from '@engine/scene';
import { ScriptPlugin } from '@engine/scripts';
import { ShaderPlugin } from '@engine/shaders';
import { Text3DPlugin } from '@engine/text3d';
import { MinimapPlugin, UIPlugin } from '@engine/ui2d';
import { UI3DPlugin } from '@engine/ui3d';
import { client } from './network-client';
import { state } from './state';

/** 開發時多一些檢查與錯誤訊息；正式打包時關閉 */
export const engine = new Engine({ debug: import.meta.env.DEV });

function use<T extends Plugin>(plugin: T): T {
  engine.use(plugin);
  return plugin;
}

/** 實體、元件、系統 */
export const ecs = use(new EcsPlugin());
/** 自訂著色器（定義在 fx.ts） */
export const shaderPlugin = use(new ShaderPlugin());
export const shaders = shaderPlugin.library;
/** 父子關係、Transform、場景管理 */
export const scenePlugin = use(new ScenePlugin());
export const scenes = scenePlugin.scenes;
export const hierarchy = scenePlugin.hierarchy;
/**
 * 繪製。動態解析度：跟不上 60 FPS 時自動降低 3D 的繪製解析度（介面不受影響）
 */
export const render = use(
  new RenderPlugin({
    shadows: true,
    background: 0x12151c,
    adaptiveResolution: { targetFps: 60, minPixelRatio: 0.75 },
  }),
);
/** 後製特效（風格預設在 visuals.ts） */
export const postfx = use(new PostProcessingPlugin());
/** 資源載入：模型、貼圖、音效檔 */
export const assetPlugin = use(new AssetPlugin());
export const assets = assetPlugin.assets;
/** 3D 文字：立體標題、名牌、撿到金幣時浮出的分數 */
export const text3dPlugin = use(new Text3DPlugin());
/** 動畫：補間、模型動畫、狀態機 */
export const animationPlugin = use(new AnimationPlugin());
export const tweens = animationPlugin.tweens;
/** 音效與背景音樂 */
export const audioPlugin = use(new AudioPlugin());
export const audio = audioPlugin.audio;
/** 物理（Rapier 需要先非同步初始化；physicsPlugin.debug 顯示碰撞形狀） */
export const physicsPlugin = use(await PhysicsPlugin.create());
export const physics = physicsPlugin.physics;
/** 粒子特效 */
export const particlePlugin = use(new ParticlePlugin());
/** 腳本（金幣） */
export const scriptPlugin = use(new ScriptPlugin());
export const scripts = scriptPlugin.runner;
/** AI：守衛的行為樹、找路 */
export const ai = use(new AIPlugin());
/** 多人連線（連線用戶端在 network-client.ts；其他玩家的方塊在 network.ts） */
export const net = use(new NetworkPlugin(client, { sendRate: 20 }));
/** 3D 介面面板（要放在 2D 介面之前） */
export const ui3d = use(new UI3DPlugin());
/** 2D 介面（各個介面檔由 screens.ts 的 UIScreenManager 載入） */
export const uiPlugin = use(await UIPlugin.create());
export const ui = uiPlugin.ui;
/** 小地圖：以玩家的方塊為中心，顯示金幣與守衛 */
export const minimap = use(new MinimapPlugin({ minimap: ['minimap', 'mobileMap'], follow: () => state.player }));
/** 輸入（放在最後：指標座標以畫布為準，點到介面的不會傳給遊戲） */
export const inputPlugin = use(new InputPlugin());
export const input = inputPlugin.input;

export const world = ecs.world;
