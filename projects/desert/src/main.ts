/**
 * desert：沙漠展示。
 * 外掛設定在 engine.ts；這裡寫遊戲本身。引擎用 @engine/... 引用（例如 '@engine/render'），介面檔放在 public/ui。
 * 場景的內容（攝影機、燈光、幽靈船模型）在 public/scenes/main.xml，可以用 3D 場景編輯器（/s3d-editor.html）編輯。
 */
import { Color, Quaternion, Vector3 } from '@engine/math';
import { define, type Entity } from '@engine/ecs';
import { Transform, create, load, previewScene } from '@engine/scene';
import {
  MeshRenderer,
  OrbitControl,
  create as createRender,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from '@engine/render';
import { assets, ecs, engine, scenes } from './engine';
import { spawnDust } from './dust';
import { addGodrays } from './godrays';
import { spawnGhosts } from './ghosts';
import { animateSails } from './sails';
import { createSurface } from './ground';
import { syncFxPanel } from './postfx-panel';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import * as ui2d from '@engine/ui2d';

// ───────── 幽靈船：套用 Blender 烘焙好的光照貼圖（Lightmap）與環境遮蔽（AO） ─────────
// 最終顏色 = 底色 × 光照貼圖 × AO（和 Blender 的 build_baked_materials 相同），光影都已經烘焙好，不受場景燈光影響
// 底色用模型裡內嵌的貼圖；光照貼圖原本是 EXR，用 node tools/exr-to-hdr.mjs 轉成 .hdr（重新烘焙後要再轉一次）
const SHIP_DIR = 'models/ghost_ship_desert';
/** 光照貼圖的亮度倍率（1 = 和 Blender 烘焙的一樣） */
const LIGHTMAP_GAIN = 1;
/** AO 的強度（0 = 不套用、1 = 完整套用） */
const AO_STRENGTH = 1;
/** 月亮的亮度：超過光暈門檻（場景檔 bloom 的 threshold）的部分會向外發光，形成月暈 */
const MOON_BRIGHTNESS = 10;

async function bakedMaps(name: string): Promise<{ lightMap: Texture; aoMap: Texture }> {
  const [lightMap, aoMap] = await Promise.all([
    assets.load(`${SHIP_DIR}/baked/${name}_Lightmap.hdr`, 'hdr'),
    assets.load(`${SHIP_DIR}/baked/${name}_AO.png`, 'texture'),
  ]);
  // glTF 的 UV 是上下顛倒的慣例（和模型內嵌的貼圖一樣不翻轉）；.hdr 載入時預設是全景圖，要改回一般貼圖
  lightMap.mapping = aoMap.mapping; // 一般貼圖的對應方式（UV）
  lightMap.flipY = false;
  aoMap.flipY = false;
  aoMap.colorSpace = ''; // 不做色彩轉換（AO 是資料）
  lightMap.needsUpdate = aoMap.needsUpdate = true;
  return { lightMap, aoMap };
}

const ship = await assets.load(`${SHIP_DIR}/ghost_ship_desert.glb`, 'gltf');
const meshes: Mesh[] = [];
ship.scene.traverse((o) => {
  if ((o as Mesh).isMesh) meshes.push(o as Mesh);
});
// 每個物件（DesertTerrain、Ship_Body、Ship_Sails）各有自己的一組烘焙貼圖，檔名用物件名稱開頭
// （Ship_Body 有多個材質區塊，匯出後是 Ship_Body 底下的多個網格，名稱用最上層的節點）
const bakedName = (m: Object3D): string => {
  let o = m;
  while (o.parent && o.parent !== ship.scene) o = o.parent;
  return o.name;
};
const maps = new Map<string, Promise<{ lightMap: Texture; aoMap: Texture }>>();
await Promise.all(
  meshes.map(async (mesh) => {
    const name = bakedName(mesh);
    if (!maps.has(name)) maps.set(name, bakedMaps(name));
    const { lightMap, aoMap } = await maps.get(name)!;
    const old = mesh.material as MeshStandardMaterial;
    mesh.material = createRender.material({
      basic: {
        name: old.name,
        map: old.emissiveMap, // 匯出時把烘焙的底色放在自發光貼圖
        lightMap,
        lightMapIntensity: Math.PI * LIGHTMAP_GAIN, // three.js 的基本材質會把光照貼圖除以 π，這裡乘回來
        aoMap,
        aoMapIntensity: AO_STRENGTH,
        side: old.side,
      },
    });
    old.dispose();
  }),
);
// 船帆隨風擺動（sails.ts）
for (const mesh of meshes) if (bakedName(mesh) === 'Ship_Sails') animateSails(mesh);

// 場景：內容在場景檔 public/scenes/main.xml（攝影機、燈光、沙漠幽靈船模型 models/ghost_ship_desert/ghost_ship_desert.glb）；存檔後開著的遊戲會自動重新載入
// 地表射線（幽靈的影子用）：地形整理成高度圖，船身、船帆的三角形轉成世界座標（ground.ts）
const terrain = meshes.find((m) => bakedName(m) === 'DesertTerrain');
const castRay = terrain
  ? createSurface(
      terrain,
      meshes.filter((m) => m !== terrain),
    )
  : null;

// ───────── 月亮：永遠正對鏡頭的圓盤 ─────────
// 球體不在畫面中央時，透視會把它拉成橢圓；和鏡頭平行的圓盤投影到畫面上一定是正圓
/** 跟著鏡頭轉向、保持正對畫面（場景檔裡的月亮是圓盤 circle） */
const FaceCamera = define.component('FaceCamera', () => ({ camera: null as Entity | null }));
ecs.each(
  'face-camera',
  [Transform, FaceCamera],
  (_e, t, f) => {
    const cam = f.camera === null ? undefined : ecs.world.get(f.camera, Transform);
    if (cam) t.rotation.copy(cam.rotation);
  },
  { phase: 'lateUpdate', priority: 1000 }, // 在攝影機繞轉控制（900）之後，用這一幀最後的鏡頭方向
);

// 場景檔只放看得到、擺得出來的東西；遊戲邏輯在 setup 裡依 id 加上去
scenes.register(
  create.sceneFromFile('main', await load.sceneFile('scenes/main.xml'), {
    setup(world, spawned) {
      // 月亮：場景檔的顏色只能到 1，這裡換成很亮的顏色（高動態範圍），光暈才會只出現在月亮周圍
      const moon = spawned.entities.get('moon');
      const moonMesh = moon === undefined ? undefined : world.get(moon, MeshRenderer);
      if (moonMesh) {
        moonMesh.material = createRender.material({
          basic: {
            color: new Color('#fff4e0').multiplyScalar(MOON_BRIGHTNESS),
            fog: false, // 月亮在霧的範圍外，不能被霧蓋掉
          },
        });
        spawned.add('moon', FaceCamera, { camera: spawned.entities.get('camera') ?? null });
        // 月光光束：從船身、桅杆、船帆的縫隙透出來的放射狀光束（godrays.ts）
        addGodrays(world, moon!);
      }
      // 幽靈：在船的周圍飄來飄去（ghosts.ts）
      // 影子沿著場景的「太陽」平行光照射的方向（它的 -Z）投在地面、船身上；在場景編輯器轉動太陽，影子方向也會跟著變
      const sun = spawned.entities.get('sun');
      const sunTransform = sun === undefined ? undefined : world.get(sun, Transform);
      const lightDir = new Vector3(0, 0, -1).applyQuaternion(sunTransform?.rotation ?? new Quaternion());
      spawnGhosts(world, castRay ? { castRay, lightDir } : undefined);
      // 沙塵：風吹過的塵霧與貼地的沙粒（dust.ts）
      spawnDust(world);
      // 後製調控面板（postfx-panel.ts）：顯示場景檔套用後的設定
      syncFxPanel();
      // 用滑鼠拖曳轉動、滾輪縮放；繞著船身中央轉（目標點在初始視線上，所以第一幀就是場景檔的攝影機畫面）
      spawned.add('camera', OrbitControl, {
        target: new Vector3(1.67, 11.51, 0.37),
        minDistance: 15,
        maxDistance: 150,
      });
    },
  }),
);
// 3D 場景編輯器的「預覽」會指定正在編輯的場景；平常進入 main
scenes.load(previewScene() ?? 'main');

// 效能監視器（FPS 面板）：預設關閉，按 ` 鍵開關；放在左下角，不蓋住右上角的「後製調整」
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: false,
  position: { bottom: 16, left: 16 },
});

// 場景建好後才開始跑：第一幀就是完整的畫面
engine.start();
