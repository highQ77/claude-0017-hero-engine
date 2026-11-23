/**
 * __PROJECT_NAME__：用 Hero Engine 建立的空專案。
 * 外掛設定在 engine.ts；這裡寫遊戲本身。引擎用 @engine/... 引用（例如 '@engine/render'），介面檔放在 public/ui。
 * 場景的內容（攝影機、燈光、方塊）在 public/scenes/main.xml，可以用 3D 場景編輯器（/s3d-editor.html）編輯；
 * 地面格線與攝影機的滑鼠控制在下面的 setup 裡加上。
 */
import { define } from '@engine/ecs';
import { Transform, create, load, math, previewScene } from '@engine/scene';
import { Vector3 } from '@engine/math';
import { OrbitControl, spawn } from '@engine/render';
import type { UILabel } from '@engine/ui2d';
import { ecs, engine, scenes, ui } from './engine';

/** 會自己旋轉的物件（每秒幾弧度） */
const Spin = define.component('Spin', () => ({ speed: 1 }));

// 系統：每幀讓有 Transform 和 Spin 的實體旋轉
ecs.each('spin', [Transform, Spin], (_e, t, s, time) => math.rotate(t, [0, s.speed * time.delta, 0]));

// 2D 介面：ui/scene.xml 裡的 onClick="hello" 對應這個函式
let clicks = 0;
ui.setHandlers({ hello: () => ui.get<UILabel>('clicks')?.setText(`點了 ${++clicks} 次`) });

/** 攝影機繞著轉的點：方塊的中心（場景檔裡攝影機一開始就看著這裡，所以第一幀和場景檔一樣） */
const LOOK_AT = new Vector3(0, 0.5, 0);

// 場景：內容在場景檔 public/scenes/main.xml（攝影機、燈光、一個方塊）；存檔後開著的遊戲會自動重新載入
// 場景檔只放看得到、擺得出來的東西；遊戲邏輯在 setup 裡依 id 加上去（setup 建立的實體也跟著場景，切換場景時一起移除）
scenes.register(
  create.sceneFromFile('main', await load.sceneFile('scenes/main.xml'), {
    setup(world, spawned) {
      // 地面格線：10 × 10 公尺、每格 1 公尺，放在 y = 0（方塊就擺在上面）。不需要時刪掉這一行
      spawn.grid(world, { size: 10, divisions: 10, color: '#3a4232', centerColor: '#5a6a48' });

      // 攝影機的滑鼠控制（OrbitControl）：
      //   左鍵拖曳／單指拖曳　　　　　　　　繞著 target 轉動
      //   滾輪／雙指捏合　　　　　　　　　　拉近、拉遠
      //   右鍵、Shift＋左鍵拖曳／雙指拖曳　平移
      // 不需要時刪掉這一段；只想看不想動時把 enabled 改成 false
      spawned.add('camera', OrbitControl, {
        target: LOOK_AT, // 繞著轉的點
        minDistance: 2, // 最近能拉到幾公尺
        maxDistance: 12, // 最遠能拉到幾公尺
        maxPolarAngle: Math.PI / 2 - 0.05, // 最低只能轉到接近水平（不會鑽到地面下）
        damping: 0.08, // 慣性（秒）：放開後慢慢停下；0 為沒有慣性
        // rotate: true, zoom: true, pan: true, // 個別關掉轉動、縮放、平移
        // autoRotate: 0.3, // 沒操作時自動繞著轉（弧度／秒）
      });

      spawned.add('box', Spin, { speed: 0.8 });
    },
  }),
);
// 3D 場景編輯器的「預覽」會指定正在編輯的場景；平常進入 main
scenes.load(previewScene() ?? 'main');

// 場景建好後才開始跑：第一幀就是完整的畫面
engine.start();
