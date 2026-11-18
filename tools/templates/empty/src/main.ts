/**
 * __PROJECT_NAME__：用 Hero Engine 建立的空專案。
 * 外掛設定在 engine.ts；這裡寫遊戲本身。引擎用 @engine/... 引用（例如 '@engine/render'），介面檔放在 public/ui。
 * 場景的內容（攝影機、燈光、方塊）在 public/scenes/main.xml，可以用 3D 場景編輯器（/s3d-editor.html）編輯。
 */
import { define } from '@engine/ecs';
import { Transform, create, load, math, previewScene } from '@engine/scene';
import { OrbitControl } from '@engine/render';
import type { UILabel } from '@engine/ui2d';
import { ecs, engine, scenes, ui } from './engine';

/** 會自己旋轉的物件（每秒幾弧度） */
const Spin = define.component('Spin', () => ({ speed: 1 }));

// 系統：每幀讓有 Transform 和 Spin 的實體旋轉
ecs.each('spin', [Transform, Spin], (_e, t, s, time) => math.rotate(t, [0, s.speed * time.delta, 0]));

// 2D 介面：ui/scene.xml 裡的 onClick="hello" 對應這個函式
let clicks = 0;
ui.setHandlers({ hello: () => ui.get<UILabel>('clicks')?.setText(`點了 ${++clicks} 次`) });

// 場景：內容在場景檔 public/scenes/main.xml（攝影機、燈光、一個方塊）；存檔後開著的遊戲會自動重新載入
// 場景檔只放看得到、擺得出來的東西；遊戲邏輯在 setup 裡依 id 加上去
scenes.register(
  create.sceneFromFile('main', await load.sceneFile('scenes/main.xml'), {
    setup(_world, spawned) {
      spawned.add('camera', OrbitControl, { minDistance: 2, maxDistance: 12 }); // 用滑鼠拖曳轉動、滾輪縮放
      spawned.add('box', Spin, { speed: 0.8 });
    },
  }),
);
// 3D 場景編輯器的「預覽」會指定正在編輯的場景；平常進入 main
scenes.load(previewScene() ?? 'main');

// 場景建好後才開始跑：第一幀就是完整的畫面
engine.start();
