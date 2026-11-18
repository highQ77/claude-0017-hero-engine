/**
 * 操作：動作綁定（鍵盤、手把）與快捷鍵。
 */
import { GamepadAxis } from '@engine/input';
import type { UISlider } from '@engine/ui2d';
import { ecs, engine, input, ui } from './engine';
import { syncFpsButton } from './hud';
import { type ActionName, actions, isMenuOpen, setMenuOpen } from './menu';
import { screens } from './screens';

/** 快捷鍵 → 動作 */
const SHORTCUTS: Record<string, ActionName> = {
  KeyN: 'scene',
  KeyX: 'explode',
  KeyV: 'effect',
  KeyG: 'debug',
  KeyF: 'postfx',
  KeyM: 'music',
  KeyC: 'camera',
};
/** 數字鍵 → 遊戲速度 */
const SPEEDS: Record<string, number> = { Digit1: 0.25, Digit2: 1, Digit3: 2 };

export function installControls(): void {
  input.actions
    .bind('jump', ['Space', 'Pad:A'])
    .bindAxis('moveX', {
      negative: ['KeyA', 'ArrowLeft'],
      positive: ['KeyD', 'ArrowRight'],
      padAxis: GamepadAxis.LeftX,
    })
    .bindAxis('moveZ', { negative: ['KeyW', 'ArrowUp'], positive: ['KeyS', 'ArrowDown'], padAxis: GamepadAxis.LeftY });

  ecs.addSystem({
    name: 'shortcuts',
    phase: 'input',
    run() {
      for (const [key, action] of Object.entries(SHORTCUTS)) if (input.wasPressed(key)) actions[action]();
      for (const [key, speed] of Object.entries(SPEEDS)) {
        if (!input.wasPressed(key)) continue;
        engine.time.timeScale = speed;
        const slider = ui.get<UISlider>('speed');
        if (slider) slider.value = speed;
      }
    },
  });

  // 暫停中主迴圈（包含輸入系統）不會執行：暫停、關閉介面、效能面板這幾個鍵直接聽瀏覽器的按鍵事件
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyP' && !isMenuOpen()) engine.state === 'running' ? engine.pause() : engine.resume();
    if (e.code === 'Escape') {
      if (isMenuOpen()) setMenuOpen(false);
      else screens.back(); // 關閉最上層的介面（標題、背包…）
    }
    if (e.code === 'Backquote') queueMicrotask(syncFpsButton); // 效能監視器切換面板後，按鈕跟著更新
  });
}
