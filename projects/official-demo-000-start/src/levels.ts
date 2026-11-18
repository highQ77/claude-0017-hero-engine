/**
 * 場景：環繞軌道（orbit）、方塊雨（rain），以及場景之間的轉場。
 *
 * 場景的內容放在場景檔（可以用 3D 場景編輯器 /s3d-editor.html 編輯，存檔後遊戲會自動重新載入）：
 *   public/scenes/orbit.xml   玩家方塊、金字塔、金幣、球、3D 控制台、全像投影
 *   public/scenes/rain.xml    30 顆球、16 個箱子
 *   public/prefabs/stage.xml  舞台（兩個場景共用）：攝影機、燈光、地板、旗幟、立體標題、四面牆
 *
 * 場景檔只放「看得到、擺得出來」的東西；遊戲邏輯在這裡依 id 加上去：
 * 腳本、自訂元件、自訂著色器材質、動畫狀態機、AI 守衛。
 */
import { AnimationStateMachine, type AnimationStateMachineDef } from '@engine/animation';
import type { Entity, World } from '@engine/ecs';
import { type Material, MeshRenderer } from '@engine/render';
import { Transform, create, load, type Scene, type SpawnedScene } from '@engine/scene';
import { MinimapMarker, SceneTransition } from '@engine/ui2d';
import { Coin } from './coin';
import { Orbit, Player, PlayerSpawned, Spin, Toy } from './components';
import { assets, physicsPlugin, scenes, scripts, tweens, ui } from './engine';
import { ambientMotes, shaders } from './fx';
import { bakeNavGrid, spawnGuard } from './guards';
import { state } from './state';

// 場景檔（ScriptList）用名稱找腳本：在這裡登記（3D 場景編輯器「加入腳本」也會列出它們）
scripts.register({ Coin });

/** 金字塔的動畫狀態機：平常旋轉，觸發 bob 時跳一下，跳完回到旋轉 */
const pyramidStates: AnimationStateMachineDef = {
  initial: 'spin',
  states: {
    spin: { clip: 'Spin' },
    bob: { clip: 'Bob', loop: false, speed: 1.2 },
  },
  transitions: [
    { from: 'spin', to: 'bob', trigger: 'bob', fade: 0.1 },
    { from: 'bob', to: 'spin', onFinish: true, fade: 0.3 },
  ],
};

const find = (spawned: SpawnedScene, id: string): Entity | undefined => spawned.entities.get(id);

/** 把網格的材質換成自訂著色器（場景檔裡的材質是編輯器看的替代顏色） */
function useShader(world: World, e: Entity | undefined, material: Material): void {
  const mesh = e !== undefined ? world.get(e, MeshRenderer) : undefined;
  if (mesh) mesh.material = material;
}

/** 旗幟的波浪材質：兩個場景共用一份 */
let waveMaterial: Material | null = null;

/** 舞台（prefabs/stage.xml）：攝影機自動環繞、旗幟用波浪著色器、空中的光點 */
function setupStage(world: World, spawned: SpawnedScene): void {
  const camera = find(spawned, 'stage/camera');
  if (camera !== undefined) world.add(camera, Orbit);
  state.camera = camera ?? null;
  waveMaterial ??= shaders.createMaterial('wave');
  useShader(world, find(spawned, 'stage/flag'), waveMaterial);
  ambientMotes(world);
}

/** 球、箱子（ball-1、crate-1…）：加上 Toy；外觀從 0 彈出到原本的大小（每個稍微錯開） */
function setupToys(world: World, spawned: SpawnedScene): void {
  for (const [id, e] of spawned.entities) {
    if (!/^(ball|crate)-\d+$/.test(id)) continue;
    world.add(e, Toy);
    const visual = find(spawned, `${id}/visual`);
    const t = visual !== undefined ? world.get(visual, Transform) : undefined;
    if (!t) continue;
    const size = { x: t.scale.x, y: t.scale.y, z: t.scale.z };
    t.scale.set(0, 0, 0);
    tweens.to(t.scale, size, { duration: 0.5, delay: Math.random() * 0.4, easing: 'backOut', entity: visual });
  }
}

/** 玩家的方塊：鍵盤移動、自轉；材質換成溶解著色器（炸掉時用） */
function setupPlayer(world: World, cube: Entity): void {
  state.playerMaterial?.dispose();
  state.playerMaterial = shaders.createMaterial('dissolve', {}, { color: 0x4f9dff, roughness: 0.35, metalness: 0.1 });
  useShader(world, cube, state.playerMaterial);
  world.add(cube, Player);
  world.add(cube, Spin, { x: 0.4, y: 1.0 });
  state.player = cube;
  world.events.emit(PlayerSpawned, { entity: cube });
}

function setupOrbit(world: World, spawned: SpawnedScene): void {
  setupStage(world, spawned);
  setupToys(world, spawned);
  const cube = find(spawned, 'cube');
  if (cube !== undefined) setupPlayer(world, cube);

  // glTF 模型的動畫用狀態機播放（模型、低鳴聲、碰撞範圍、火焰與煙在場景檔裡）
  const pyramid = find(spawned, 'pyramid');
  if (pyramid !== undefined) world.add(pyramid, AnimationStateMachine, { definition: pyramidStates });
  useShader(world, find(spawned, 'pulse-ring'), shaders.createMaterial('pulseRing'));
  const holo = find(spawned, 'hologram');
  useShader(world, holo, shaders.createMaterial('hologram'));
  if (holo !== undefined) world.add(holo, Spin, { x: 0.3, y: 0.8 });

  // 金幣（prefabs/coin.xml 的實例）顯示在小地圖
  for (const [id, coin] of spawned.entities)
    if (/^coin-\d+$/.test(id)) world.add(coin, MinimapMarker, { color: '#ffd75e', shape: 'dot', size: 4 });

  state.kiosk = find(spawned, 'kiosk') ?? null;

  // 兩個巡邏的守衛
  spawnGuard(world, [
    [-6, -6],
    [6, -6],
    [6, -2],
    [-6, -2],
  ]);
  spawnGuard(world, [
    [6, 6],
    [-6, 6],
    [-6, 2],
    [6, 2],
  ]);
  // 所有碰撞體都建立好了：烘焙導航網格（守衛會避開金字塔）
  bakeNavGrid(world, physicsPlugin.debug);
}

/** 載入場景檔並登記兩個場景 */
export async function loadLevels(): Promise<void> {
  const [orbitFile, rainFile] = await Promise.all([
    load.sceneFile('scenes/orbit.xml'),
    load.sceneFile('scenes/rain.xml'),
  ]);
  const leave = () => {
    state.player = null;
    state.kiosk = null;
    state.camera = null;
  };
  const levels: Scene[] = [
    create.sceneFromFile('orbit', orbitFile, { setup: setupOrbit, teardown: leave }),
    create.sceneFromFile('rain', rainFile, {
      setup(world, spawned) {
        setupStage(world, spawned);
        setupToys(world, spawned);
      },
      teardown: leave,
    }),
  ];
  scenes.register(...levels);
}

/**
 * 轉場：淡出 → 載入頁面（下載下一個場景的資源）→ 切換 3D 場景與場景介面 → 淡入。
 * 每個場景的介面放在自己的資料夾（public/ui/orbit/、public/ui/rain/）。
 */
export const transition = new SceneTransition({ ui, scenes, assets }).defineAll({
  orbit: {
    title: '環繞軌道',
    loading: 'ui/orbit/loading.xml',
    hud: 'ui/orbit/hud.xml',
    ui: ['ui/inventory.xml', 'ui/leaderboard.xml'],
    assets: [
      { url: 'models/pyramid.gltf', type: 'gltf' },
      { url: 'sounds/hum.wav', type: 'audio' },
      { url: 'sounds/pop.wav', type: 'audio' },
      { url: 'textures/checker.png', type: 'texture' },
    ],
    tips: ['用 WASD 或方向鍵移動藍色方塊', '金幣被撿起後 3 秒會重生', '點擊金幣也能直接收集', '按 X 讓方塊溶解後爆炸'],
  },
  rain: {
    title: '方塊雨',
    loading: 'ui/rain/loading.xml',
    hud: 'ui/rain/hud.xml',
    assets: [
      { url: 'sounds/bounce.wav', type: 'audio' },
      { url: 'sounds/jump.wav', type: 'audio' },
    ],
    tips: ['點擊球或箱子把它踢飛', '按空白鍵讓所有物件跳起來', '按 G 顯示碰撞形狀'],
  },
});

/** 切換到另一個場景（轉場中再按一次，以正在進入的場景為準） */
export function nextLevel(): void {
  const at = transition.target ?? transition.current;
  void transition.go(at === 'orbit' ? 'rain' : 'orbit');
}
