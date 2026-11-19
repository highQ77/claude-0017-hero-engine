/**
 * 3D 控制台（ui/kiosk.xml，場景檔裡的 UIPanel3D）：在 3D 世界裡的介面，可以直接點。
 */
import type { UICanvas, UILabel } from '@engine/ui2d';
import { CoinCollected, Spin } from './components';
import { engine, ui3d, world } from './engine';
import { explodePlayer, jumpAll } from './gameplay';
import { state } from './state';

/** 控制台的介面（面板載入完成後才有） */
const panel = () => (state.kiosk !== null ? ui3d.uiOf(state.kiosk) : null);
const say = (text: string) => panel()?.get<UILabel>('info')?.setText(text);

/** 目前的轉速倍率（滑桿） */
let spinRate = 1;
let wavePhase = 0;

/** 在控制台的 <UICanvas id="spinWave"> 畫轉速波形：轉越快，波越密、跑越快 */
function drawSpinWave(dt: number): void {
  const canvas = panel()?.get<UICanvas>('spinWave');
  if (!canvas) return; // 面板還沒載入
  const ctx = canvas.getContext();
  const { width: w, height: h } = canvas;
  wavePhase += dt * spinRate * 6;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = spinRate > 0 ? '#9acd32' : 'rgba(184,192,174,0.5)';
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const y = h / 2 + Math.sin(x * 0.08 * (0.5 + spinRate) - wavePhase) * (h / 2 - 4) * Math.min(1, spinRate);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function installKiosk(): void {
  ui3d.setHandlers({
    panelJump: () => {
      jumpAll();
      say('物件跳起來了！');
    },
    panelExplode: () => say(explodePlayer() ? '碰！' : '方塊已經炸掉了（按 N 兩次重新開始）'),
    // 方塊的轉速倍率
    panelSpin: (e) => {
      const spin = state.player !== null ? world.get(state.player, Spin) : undefined;
      if (spin) spin.rate = e.value as number;
      spinRate = e.value as number;
    },
  });
  engine.timers.every(0.1, () => drawSpinWave(0.1));
  world.events.on(CoinCollected, () => panel()?.get<UILabel>('coins')?.setText(`金幣 ${state.score}`));
}
