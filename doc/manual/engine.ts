/**
 * 使用手冊範例共用的 engine.ts：範例用 import { engine, world, ui, … } from './engine' 取用（和遊戲專案的寫法一樣）。
 * 每次按「執行」都是新的預覽框，這個檔案會重新執行一次，範例之間不會互相影響。
 *
 * 和 node hero create 產生的 engine.ts 一樣的命名；為了讓所有章節的範例都能直接用，這裡把外掛全部裝上
 * （多人連線、小地圖需要額外設定，不在這裡）。和專案的差別：
 * - 後製特效已經安裝，但色調映射預設不使用（畫面和沒裝後製時一樣）；要光暈時寫 postfx.settings.bloom.enabled = true
 * - 2D 介面沒有預先載入介面檔：範例用 ui.loadString(`<UI>…</UI>`) 載入
 * - 攝影機繞轉控制預設開啟（手冊的執行環境設定的）
 */
import { Engine, type Plugin } from '@engine/core';
import { EcsPlugin } from '@engine/ecs';
import { ShaderPlugin } from '@engine/shaders';
import { ScenePlugin } from '@engine/scene';
import { RenderPlugin } from '@engine/render';
import { PostProcessingPlugin } from '@engine/postfx';
import { AssetPlugin } from '@engine/assets';
import { Text3DPlugin } from '@engine/text3d';
import { AnimationPlugin } from '@engine/animation';
import { AudioPlugin } from '@engine/audio';
import { PhysicsPlugin } from '@engine/physics';
import { ParticlePlugin } from '@engine/particles';
import { ScriptPlugin } from '@engine/scripts';
import { AIPlugin } from '@engine/ai';
import { UI3DPlugin } from '@engine/ui3d';
import { UIPlugin } from '@engine/ui2d';
import { InputPlugin } from '@engine/input';

export const engine = new Engine();

/** 安裝外掛並回傳它 */
function use<T extends Plugin>(plugin: T): T {
  engine.use(plugin);
  return plugin;
}

/** 實體、元件、系統：ecs.each(…)、ecs.addSystem(…) */
export const ecs = use(new EcsPlugin());
/** 自訂著色器 */
export const shaderPlugin = use(new ShaderPlugin());
/** 著色器庫：shaders.define(…)、shaders.createMaterial(…) */
export const shaders = shaderPlugin.library;
/** 父子關係、Transform、場景管理 */
export const scenePlugin = use(new ScenePlugin());
/** 場景管理：scenes.register(…)、scenes.load('…') */
export const scenes = scenePlugin.scenes;
/** 父子關係：hierarchy.setParent(子, 父) */
export const hierarchy = scenePlugin.hierarchy;
/** 繪製：render.scene（背景：render.scene.background = new Color('#203040')）、render.pick(…) */
export const render = use(new RenderPlugin({ background: 0x15181f, shadows: true }));
/** 後製特效：postfx.settings.bloom.enabled = true（色調映射預設不使用，畫面和沒裝時一樣） */
export const postfx = use(new PostProcessingPlugin({ toneMapping: 'none' }));
/** 資源載入 */
export const assetPlugin = use(new AssetPlugin());
/** 資源管理：assets.load(…) */
export const assets = assetPlugin.assets;
/** 3D 文字（Text3D 元件） */
export const text3dPlugin = use(new Text3DPlugin());
/** 動畫：補間、模型動畫、狀態機 */
export const animationPlugin = use(new AnimationPlugin());
/** 補間：tweens.to(…) */
export const tweens = animationPlugin.tweens;
/** 音效 */
export const audioPlugin = use(new AudioPlugin());
/** 音效：audio.play(…)、audio.playMusic(…) */
export const audio = audioPlugin.audio;
/** 物理（physicsPlugin.debug = true 顯示碰撞形狀） */
export const physicsPlugin = use(await PhysicsPlugin.create());
/** 物理世界：physics.applyImpulse(…)、physics.onCollision(…) */
export const physics = physicsPlugin.physics;
/** 粒子特效（ParticleEmitter 元件） */
export const particlePlugin = use(new ParticlePlugin());
/** 腳本 */
export const scriptPlugin = use(new ScriptPlugin());
/** 腳本：scripts.add(實體, 腳本類別)、scripts.find('名稱') */
export const scripts = scriptPlugin.runner;
/** AI：行為樹、轉向、尋路（ai.navGrid = …） */
export const ai = use(new AIPlugin());
/** 3D 介面面板（UIPanel3D 元件；ui3d.setHandlers(…)） */
export const ui3d = use(new UI3DPlugin());
/** 2D 介面 */
export const uiPlugin = use(await UIPlugin.create());
/** 介面：ui.loadString(…)、ui.setHandlers({ … })、ui.get<UILabel>('id') */
export const ui = uiPlugin.ui;
/** 輸入 */
export const inputPlugin = use(new InputPlugin());
/** 輸入：input.isDown('KeyW')、input.mouse.wasPressed('Left')、input.actions、input.pointer */
export const input = inputPlugin.input;

/** 遊戲世界 */
export const world = ecs.world;
