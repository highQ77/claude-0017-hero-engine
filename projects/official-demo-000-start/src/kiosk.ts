/**
 * 3D 控制台（ui/kiosk.xml，場景檔裡的 UIPanel3D）：在 3D 世界裡的介面，可以直接點。
 */
import type { UILabel } from '@engine/ui2d';
import { CoinCollected, Spin } from './components';
import { ui3d, world } from './engine';
import { explodePlayer, jumpAll } from './gameplay';
import { state } from './state';

/** 控制台的介面（面板載入完成後才有） */
const panel = () => (state.kiosk !== null ? ui3d.uiOf(state.kiosk) : null);
const say = (text: string) => panel()?.get<UILabel>('info')?.setText(text);

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
    },
  });
  world.events.on(CoinCollected, () => panel()?.get<UILabel>('coins')?.setText(`金幣 ${state.score}`));
}
