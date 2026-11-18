/**
 * official-demo-000-start：用到引擎所有功能的完整範例遊戲。
 *
 * 核心、ECS、場景檔與預製物件、繪製、後製、自訂著色器與節點圖、資源載入、輸入、動畫（補間、時間軸、狀態機）、
 * 音效（3D 音效）、物理、粒子、腳本、AI（行為樹、找路）、2D 介面（HUD、選單、多個介面檔、RWD）、
 * 3D 介面、3D 文字、小地圖、場景轉場、多人連線、套件（效能監視器）。
 *
 * 檔案：
 *   engine.ts      外掛設定                     state.ts       遊戲狀態（共用的數值）
 *   components.ts  元件與事件                   fx.ts          著色器、粒子、浮出的文字
 *   levels.ts      場景與轉場                   gameplay.ts    系統與遊戲動作
 *   coin.ts        金幣（腳本）                 guards.ts      守衛（AI）
 *   hud.ts         HUD                          menu.ts        動作總表、選單
 *   controls.ts    按鍵                         screens.ts     疊加的介面檔
 *   visuals.ts     畫面設定（後製、效果）       kiosk.ts       3D 控制台
 *   network.ts     多人連線
 */
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { previewScene } from '@engine/scene';
import * as ui2d from '@engine/ui2d';
import { audio, engine } from './engine';
import { installControls } from './controls';
import { applyCameraMode, installSystems } from './gameplay';
import { installHud, syncFpsButton } from './hud';
import { installKiosk } from './kiosk';
import { loadLevels, transition } from './levels';
import { installMenu } from './menu';
import { installNetwork } from './network';
import { installScreens, screens } from './screens';
import { applyPreset, refocus } from './visuals';

// 遊戲邏輯
installSystems();
installControls();

// 介面：HUD 是基本畫面，其他介面檔疊在上面
installScreens();
await screens.show('hud');
installHud(); // 要在 kiosk 之前：撿到金幣時先加分，控制台再顯示新的分數
installMenu();
installKiosk();
installNetwork();
applyPreset('標準');

// 音效：常用的先載入，背景音樂在第一次點擊或按鍵後才會出聲（瀏覽器限制）
void audio.preload(['sounds/jump.wav', 'sounds/bounce.wav', 'sounds/pop.wav']);
audio.playMusic('sounds/music.wav', { volume: 0.3, fade: 2 });

// 效能監視器套件（` 鍵）：手機（寬度 < 768）預設關閉，避免蓋住畫面
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: matchMedia('(min-width: 768px)').matches,
});
syncFpsButton();

// 場景
await loadLevels();
transition.onChange((c) => {
  if (c.type !== 'enter') return;
  applyCameraMode(); // 每個場景的攝影機是新的：套用目前的攝影機模式
  refocus(); // 景深對焦在新的方塊
});

// 3D 場景編輯器的「預覽」：直接進入正在編輯的場景
const preview = previewScene();
if (preview) void transition.go(preview);
// 平常：經過載入頁面進入第一個場景；標題畫面在淡入前（畫面還是黑的）就打開，淡入時已經在上面
else
  void transition.go('orbit', {
    beforeReveal: async () => {
      await screens.preload();
      await screens.open('title');
    },
  });

engine.start();
