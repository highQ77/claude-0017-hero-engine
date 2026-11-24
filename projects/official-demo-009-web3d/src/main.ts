/**
 * official-demo-009-web3d：把真正的網頁放進 3D 場景（WebPanel3D，@engine/web3d）。
 *
 * - 左邊的看板：iframe 網頁（public/pages/news.html），可以捲動、選取文字、點連結，網頁裡的程式照常執行
 * - 右邊的表單：直接給 HTML（和遊戲同一份文件），點顏色改變球的顏色、送出留言在遊戲裡跳出通知；輸入框可以打中文
 * - 繞圈的球：飛到網頁前面時蓋住網頁、飛到後面時被網頁擋住（畫布在網頁的位置挖洞）
 * - 左邊的 2D 介面也蓋在網頁上面；滑鼠移到露出的網頁上才交給網頁
 * - YouTube 影片：「影片」分頁的 <UIWeb>（2D）與場景後面的電視（WebPanel3D，3D）；用 postMessage 控制播放
 * Web3DPlugin 在 engine.ts 安裝。
 */
import { define, type Entity } from '@engine/ecs';
import { Transform, create, load, previewScene } from '@engine/scene';
import { Vector3 } from '@engine/math';
import { MeshRenderer, OrbitControl, spawn } from '@engine/render';
import type { UILabel, UIWeb } from '@engine/ui2d';
import { WebPanel3D } from '@engine/web3d';
import { ecs, engine, scenes, ui, web3d } from './engine';

/** 右邊表單的 HTML（樣式寫在裡面；和遊戲在同一份文件，class 名稱加前綴避免和頁面衝突） */
const FORM_HTML = `
<style>
  .d9-form { box-sizing: border-box; height: 100%; padding: 28px 32px; font-family: -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
    background: linear-gradient(160deg, #1d2416, #12160f); color: #e9f6d2; display: flex; flex-direction: column; gap: 14px; }
  .d9-form h2 { margin: 0; font-size: 30px; color: #c8f07a; }
  .d9-form p { margin: 0; color: #c6cdbb; font-size: 17px; line-height: 1.6; }
  .d9-form label { font-size: 16px; color: #8f9884; }
  .d9-form input, .d9-form textarea { font: inherit; font-size: 20px; padding: 10px 14px; border-radius: 10px; border: 2px solid #37402f; background: #0e110c; color: #fff; outline: none; }
  .d9-form input:focus, .d9-form textarea:focus { border-color: #9acd32; }
  .d9-form textarea { height: 110px; resize: none; }
  .d9-swatches { display: flex; gap: 12px; }
  .d9-swatches button { width: 52px; height: 52px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; }
  .d9-swatches button:hover { border-color: #fff; }
  .d9-send { font: inherit; font-size: 20px; font-weight: bold; padding: 12px; border-radius: 10px; border: 0; background: #9acd32; color: #141a07; cursor: pointer; }
  .d9-send:hover { background: #b5e350; }
</style>
<div class="d9-form">
  <h2>留言板（HTML）</h2>
  <p>這是一段 HTML，和遊戲在同一份文件：可以打中文、選字，按鈕直接呼叫遊戲的程式。</p>
  <label>球的顏色</label>
  <div class="d9-swatches">
    <button data-color="#ffd166" style="background:#ffd166" title="黃"></button>
    <button data-color="#ff6b8b" style="background:#ff6b8b" title="紅"></button>
    <button data-color="#3dd6c6" style="background:#3dd6c6" title="青"></button>
    <button data-color="#7aa2ff" style="background:#7aa2ff" title="藍"></button>
    <button data-color="#c79bff" style="background:#c79bff" title="紫"></button>
  </div>
  <label>名字</label>
  <input class="d9-name" placeholder="你的名字" value="旅人">
  <label>留言</label>
  <textarea class="d9-message" placeholder="想說什麼？"></textarea>
  <button class="d9-send">送出留言</button>
</div>`;

/** 繞圈的球：以 center 為圓心、在水平面上繞圈（會從網頁前後飛過） */
const Orbit = define.component('Orbit', () => ({ radius: 2.2, speed: 0.6, height: 1.4, centerX: 0.2, centerZ: -0.3 }));
ecs.each('orbit', [Transform, Orbit], (_e, t, o, time) => {
  const a = time.elapsed * o.speed;
  t.position.set(
    o.centerX + Math.cos(a) * o.radius,
    o.height + Math.sin(a * 2) * 0.25,
    o.centerZ + Math.sin(a) * o.radius,
  );
});

let orb: Entity | undefined;
/** 改變球的顏色（換 MeshRenderer 的材質） */
function setOrbColor(color: string): void {
  const mesh = orb === undefined ? undefined : ecs.world.get(orb, MeshRenderer);
  if (mesh) mesh.material = { standard: { color, roughness: 0.3, emissive: color, emissiveIntensity: 0.25 } };
}

/** 表單面板：元素（WebPanel3D.element）在第一幀之後才建立，出現後加上事件（只做一次） */
const FormPanel = define.tag('FormPanel');
ecs.each('form-panel', [WebPanel3D, FormPanel], (e, panel) => {
  const root = panel.element;
  if (!root) return;
  for (const b of root.querySelectorAll<HTMLButtonElement>('.d9-swatches button'))
    b.addEventListener('click', () => setOrbColor(b.dataset.color ?? '#ffd166'));
  const name = root.querySelector<HTMLInputElement>('.d9-name')!;
  const message = root.querySelector<HTMLTextAreaElement>('.d9-message')!;
  root.querySelector('.d9-send')!.addEventListener('click', () => {
    const text = message.value.trim();
    if (!text) return void message.focus();
    const who = name.value.trim() || '旅人';
    ui.toast(`${who}：${text}`, { icon: 'chat' });
    ui.get<UILabel>('lastMessage')?.setText(`${who}：${text}`);
    message.value = '';
  });
  ecs.world.remove(e, FormPanel);
});

// ───────── YouTube：網址加上 enablejsapi=1，就能用 postMessage 送指令（播放、暫停…）給播放器 ─────────

/** 送指令給 YouTube 播放器（iframe） */
function youtube(iframe: HTMLIFrameElement | null | undefined, command: 'playVideo' | 'pauseVideo'): void {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), '*');
}
const VIDEO_TAB = 4;
let tv: Entity | undefined;
/** 電視（3D 網頁面板）的 iframe */
const tvIframe = () => (tv === undefined ? null : ecs.world.get(tv, WebPanel3D)?.iframe);
ui.setHandlers({
  play2d: () => youtube(ui.get<UIWeb>('video2d')?.iframe, 'playVideo'),
  pause2d: () => youtube(ui.get<UIWeb>('video2d')?.iframe, 'pauseVideo'),
  play3d: () => youtube(tvIframe(), 'playVideo'),
  pause3d: () => youtube(tvIframe(), 'pauseVideo'),
  // 切到別的分頁：2D 影片看不到了（元素只是隱藏），聲音還會繼續，先暫停
  tab: (e) => {
    if (e.value !== VIDEO_TAB) youtube(ui.get<UIWeb>('video2d')?.iframe, 'pauseVideo');
  },
});

/** 面板的名稱（顯示「滑鼠目前在」） */
const names = new Map<Entity, string>();
let lastActive: Entity | null | undefined;
ecs.addSystem({
  name: 'active-panel-label',
  run: () => {
    const active = web3d.activePanel;
    if (active === lastActive) return;
    lastActive = active;
    ui.get<UILabel>('active')?.setText(active === null ? '遊戲畫面' : (names.get(active) ?? '網頁'));
  },
});

scenes.register(
  create.sceneFromFile('main', await load.sceneFile('scenes/main.xml'), {
    setup(world, spawned) {
      const turn = (e: Entity, angle: number) =>
        world.require(e, Transform).rotation.setFromAxisAngle(new Vector3(0, 1, 0), angle);
      // 左：iframe 網頁（同網域的網頁最穩定）
      const news = world.spawn(
        Transform.at(-0.75, 1.45, 0),
        WebPanel3D.with({ src: 'pages/news.html', width: 1024, height: 720, worldWidth: 2.4 }),
      );
      turn(news, 0.28);
      names.set(news, '新聞網頁（iframe）');
      // 右：HTML 表單
      const form = world.spawn(
        Transform.at(1.75, 1.35, 0.1),
        WebPanel3D.with({ html: FORM_HTML, width: 560, height: 700, worldWidth: 1.35, background: '#12160f' }),
        FormPanel,
      );
      turn(form, -0.3);
      names.set(form, '留言板（HTML）');
      // 後面的電視：外框（方塊）＋ YouTube 影片（16:9）
      spawn.mesh(world, {
        geometry: { box: [2.5, 1.48, 0.08] },
        material: { standard: { color: '#16191f', roughness: 0.5 } },
        position: [0.45, 2.95, -2.08], // 正面在 z = -2.04，比影片（z = -2）後面一點，深度才不會打架
      });
      tv = world.spawn(
        Transform.at(0.45, 2.95, -2),
        WebPanel3D.with({
          src: 'https://www.youtube.com/embed/M7lc1UVf-VE?enablejsapi=1&rel=0',
          width: 1280,
          height: 720,
          worldWidth: 2.36,
          background: '#000',
        }),
      );
      names.set(tv, '電視（YouTube）');
      orb = spawned.add('orb', Orbit);
      // 拖曳網頁以外的地方轉動視角
      spawned.add('camera', OrbitControl, {
        target: new Vector3(-0.55, 1.3, 0),
        minDistance: 2.5,
        maxDistance: 12,
        maxPolarAngle: Math.PI / 2 - 0.05,
        damping: 0.08,
      });
    },
  }),
);
// 3D 場景編輯器的「預覽」會指定正在編輯的場景；平常進入 main
scenes.load(previewScene() ?? 'main');

engine.start();
