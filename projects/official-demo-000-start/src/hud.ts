/**
 * HUD（ui/scene.xml）：分數、金幣進度、體力、FPS 按鈕、玩家資訊、開場導覽。
 * 數值改變的地方呼叫這裡的函式；文字、進度條沒變時不會重畫。
 */
import { PerfMonitorKey, PerfStatsKey } from '@engine/packages/perf-monitor';
import type { UIButton, UIDialogue, UIIcon, UILabel, UIProgressBar } from '@engine/ui2d';
import { CoinCollected, PlayerSpawned } from './components';
import { engine, ui, world } from './engine';
import { myColor, client } from './network-client';
import { COINS_PER_SCENE, state } from './state';

/** 體力條（整數改變才更新） */
export function showEnergy(): void {
  const bar = ui.get<UIProgressBar>('energy');
  if (bar) bar.value = Math.round(state.energy);
}

function showCoins(): void {
  ui.get<UILabel>('score')?.setText(state.score);
  const bar = ui.get<UIProgressBar>('coinBar');
  if (bar) bar.value = state.coinsThisScene;
}

/** 效能面板（` 鍵）的開關：按鈕顯示 FPS，面板開著時亮綠色 */
export function toggleFps(): void {
  world.getResource(PerfMonitorKey)?.toggle();
  syncFpsButton();
}

export function syncFpsButton(): void {
  const on = world.getResource(PerfMonitorKey)?.visible ?? false;
  ui.get('fpsToggle')
    ?.set('background', on ? 'rgba(154,205,50,0.2)' : null)
    .set('border', on ? '1 rgba(154,205,50,0.6)' : null)
    .set('color', on ? '#d6f59a' : null);
  ui.get<UIIcon>('fpsIcon')?.set('color', on ? '#9acd32' : '#838b78');
}

/** 開場導覽的選項 */
export function introChoice(value: unknown): void {
  if (value === 'multi') {
    ui.get<UIDialogue>('introDialog')?.say(
      '再開一個[b]瀏覽器分頁[/b]打開這個遊戲，就會看到其他玩家的[color=#9acd32]半透明方塊[/color]與名牌。跨電腦連線請執行 [bg=rgba(255,255,255,0.12)] npm run relay [/bg]。',
      { choices: [{ value: 'start', label: '了解，開始遊戲' }] },
    );
    return;
  }
  ui.require('intro').visible = false;
  ui.toast('祝你玩得開心！', { icon: 'star', duration: 1.8 });
}

/** HUD 顯示後呼叫：玩家資訊、事件收聽、定期更新 */
export function installHud(): void {
  ui.get<UILabel>('playerName')?.setText(String(client.meta.name));
  ui.get('avatar')?.set('border', `2 ${myColor}`);
  ui.get<UIIcon>('avatarIcon')?.set('color', myColor);

  world.events.on(CoinCollected, ({ value }) => {
    state.score += value;
    state.coinsThisScene = Math.min(COINS_PER_SCENE, state.coinsThisScene + 1);
    showCoins();
    const done = state.coinsThisScene === COINS_PER_SCENE;
    ui.toast(done ? '這個場景的金幣全部收集完成！' : `獲得金幣　${state.coinsThisScene} / ${COINS_PER_SCENE}`, {
      icon: done ? 'trophy' : 'coin',
      color: '#ffd75e',
      duration: 1.6,
    });
  });
  world.events.on(PlayerSpawned, () => {
    state.coinsThisScene = 0;
    showCoins();
  });

  // 右上：實體數量；FPS 按鈕顯示目前的 FPS（效能面板隱藏時也會持續量測）。realtime：暫停、慢動作時照常更新
  engine.timers.every(
    0.5,
    () => {
      ui.get<UILabel>('worldInfo')?.setText(`實體 ${world.entityCount}`);
      const fps = world.getResource(PerfStatsKey)?.fps ?? 0;
      ui.get<UIButton>('fpsToggle')?.setText(fps > 0 ? `FPS ${Math.round(fps)}` : 'FPS --');
    },
    { realtime: true },
  );
  showCoins();
  showEnergy();
  syncFpsButton();
}
