/**
 * 引擎與外掛設定：要用哪些外掛、建立時的設定都在這裡。遊戲程式用 import { engine, world, ui, audio } from './engine' 取用。
 *
 * - 一行一個外掛，照順序安裝（有相依的在後面，例如介面要在繪製之後；不要調換順序）
 * - 不用的外掛把那一行註解掉（連同 import）：引擎不會安裝，打包時也不會包含它
 * - 「建立時就決定」的設定（例如陰影、物理的初始設定）要改這裡；
 *   執行中可以改的（背景顏色、後製效果、音量、介面的事件處理…）在 main.ts 改就好，例如：
 *     render.scene.background = new Color('#203040');   ui.setHandlers({ start: () => … });
 */
import { Engine, type Plugin } from '@engine/core';
import { EcsPlugin } from '@engine/ecs';
import { ScenePlugin } from '@engine/scene';
import { RenderPlugin } from '@engine/render';
import { AssetPlugin } from '@engine/assets';
import { AnimationPlugin } from '@engine/animation';
import { ParticlePlugin } from '@engine/particles';
import { AudioPlugin } from '@engine/audio';
import { ScriptPlugin } from '@engine/scripts';
import { AIPlugin } from '@engine/ai';
import { UIPlugin } from '@engine/ui2d';
import { InputPlugin } from '@engine/input';
// 預設關閉的外掛：取消註解時連同下面安裝的那一行
// import { ShaderPlugin } from '@engine/shaders';
// import { PostProcessingPlugin } from '@engine/postfx';
// import { Text3DPlugin } from '@engine/text3d';
// import { PhysicsPlugin } from '@engine/physics';
// import { UI3DPlugin } from '@engine/ui3d';

export const engine = new Engine();

/** 安裝外掛並回傳它（一行就能建立、安裝、匯出） */
function use<T extends Plugin>(plugin: T): T {
  engine.use(plugin);
  return plugin;
}

// ───────── 外掛（照安裝順序；前面加 // 的是預設關閉的，需要時取消註解，連同上面的 import） ─────────
// 外掛叫 xxxPlugin（很少直接用）；常用的物件另外匯出短名稱，例如 ui（介面）、audio（音效）、scenes（場景管理）

/** 實體、元件、系統：ecs.each(…)、ecs.addSystem(…) */
export const ecs = use(new EcsPlugin());
/** 自訂著色器（溶解、全像投影…）：shaders.define(…) */
// export const shaderPlugin = use(new ShaderPlugin());
// export const shaders = shaderPlugin.library;
/** 父子關係、Transform、場景管理 */
export const scenePlugin = use(new ScenePlugin());
/** 場景管理：scenes.register(…)、scenes.load('…') */
export const scenes = scenePlugin.scenes;
/** 父子關係：hierarchy.setParent(子, 父) */
export const hierarchy = scenePlugin.hierarchy;
/** 繪製：攝影機、燈光、網格（background、shadows 等建立時的設定）；render.scene、render.raycast(…) */
export const render = use(new RenderPlugin({ background: 0x15181f, shadows: true }));
/** 後製特效：光暈、暗角、調色（postfx.settings.bloom.strength = 1）。裝了之後畫面會套用色調映射（預設 ACES），色調會和沒裝時不同 */
// export const postfx = use(new PostProcessingPlugin({ bloom: { enabled: true } }));
/** 資源載入：模型（Model 元件）、貼圖、音效檔 */
export const assetPlugin = use(new AssetPlugin());
/** 資源管理：assets.load('models/tree.glb')、assets.get(…) */
export const assets = assetPlugin.assets;
/** 3D 文字（Text3D 元件） */
// export const text3dPlugin = use(new Text3DPlugin());
/** 動畫：補間、模型動畫、狀態機 */
export const animationPlugin = use(new AnimationPlugin());
/** 補間：tweens.to(…) */
export const tweens = animationPlugin.tweens;
/** 音效與背景音樂（第一次點擊或按鍵後才會出聲，瀏覽器的限制） */
export const audioPlugin = use(new AudioPlugin());
/** 音效：audio.play('sounds/jump.wav')、audio.playMusic(…) */
export const audio = audioPlugin.audio;
/** 物理（Rapier）：剛體、碰撞。要多下載約 2 MB，啟動時要等它初始化 */
// export const physicsPlugin = use(await PhysicsPlugin.create({ gravity: { x: 0, y: -9.81, z: 0 } }));
// export const physics = physicsPlugin.physics;
/** 粒子特效：火、煙、火花（ParticleEmitter 元件） */
export const particlePlugin = use(new ParticlePlugin());
/** 腳本（Script 類別掛在實體上） */
export const scriptPlugin = use(new ScriptPlugin());
/** 腳本：scripts.add(實體, 腳本類別)、scripts.find('名稱') */
export const scripts = scriptPlugin.runner;
/** AI：行為樹、轉向、尋路（ai.navGrid = …） */
export const ai = use(new AIPlugin());
/** 3D 空間裡的介面面板（UIPanel3D 元件；ui3d.setHandlers(…)；要放在 2D 介面之前，2D 介面在最上層、先處理滑鼠） */
// export const ui3d = use(new UI3DPlugin());
/** 2D 介面（public/ui 的介面檔） */
export const uiPlugin = use(await UIPlugin.create({ scene: 'ui/scene.xml' }));
/** 介面：ui.setHandlers({ … })、ui.get<UILabel>('id')、ui.toast(…) */
export const ui = uiPlugin.ui;
/** 鍵盤、滑鼠、手把、觸控（放在最後：指標座標以畫布為準，點到介面的不會傳給遊戲） */
export const inputPlugin = use(new InputPlugin());
/** 輸入：input.isDown('KeyW')、input.actions.bind(…)、input.pointer */
export const input = inputPlugin.input;

// 多人連線（NetworkPlugin，放在場景之後）需要連線用戶端、小地圖（MinimapPlugin，放在 2D 介面之後）需要介面裡的元件 id：
// 用法見使用手冊「開始使用」

/** 遊戲世界（最常用，直接匯出） */
export const world = ecs.world;
