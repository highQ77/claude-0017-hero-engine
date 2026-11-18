/**
 * 多人連線：其他玩家的方塊（半透明、玩家的顏色、頭上有名牌），以及 HUD 上的連線狀態。
 */
import { MeshRenderer, spawn } from '@engine/render';
import { Text3D } from '@engine/text3d';
import type { UILabel } from '@engine/ui2d';
import { PlayerSpawned } from './components';
import { engine, net, scenes, ui, world } from './engine';
import { client } from './network-client';

export function installNetwork(): void {
  // 其他玩家的方塊：只建立遠端的複本（自己的方塊在場景檔裡，用 makeNetworked 同步出去）
  net.registerPrefab('avatar', ({ world: w, entity, data, local }) => {
    if (local) return;
    const { name, color } = data as { name: string; color: string };
    w.add(entity, MeshRenderer, {
      geometry: { box: 1 },
      material: { standard: { color, transparent: true, opacity: 0.55, roughness: 0.3 } },
    });
    const tag = spawn.entity(
      w,
      { position: [0, 0.9, 0], parent: entity },
      Text3D.with({
        mode: 'flat',
        text: name,
        size: 0.24,
        billboard: true,
        anchorY: 'bottom',
        color: 0xffffff,
        background: 'rgba(10,14,22,0.7)',
        padding: 0.3,
      }),
    );
    scenes.persist(tag); // 遠端的方塊不屬於任何場景，名牌也一樣
  });

  // 自己的方塊（每次進入有方塊的場景都會重新建立）同步給其他玩家
  world.events.on(PlayerSpawned, ({ entity }) => net.makeNetworked(entity, 'avatar', client.meta));

  client.onStatus(updateStatus);
  client.onPeerJoin(updateStatus);
  client.onPeerLeave(updateStatus);
  engine.timers.every(2, updateStatus, { realtime: true }); // 延遲（rtt）會變，定期更新
  client.connect().catch((error) => ui.toast(`多人連線失敗：${(error as Error).message}`, { icon: 'warning' }));
  updateStatus();
}

/** HUD 左上的連線狀態（文字沒變時不會重畫） */
function updateStatus(): void {
  const label = ui.get<UILabel>('net');
  if (!label) return;
  if (client.status !== 'connected') {
    label.setText(client.status === 'connecting' ? '連線中…' : '離線（重新連線中）');
    return;
  }
  const rtts = [...client.peers.values()].map((p) => p.rtt).filter((r): r is number => r !== null);
  const ping = rtts.length ? `　${Math.round(Math.max(...rtts))}ms` : '';
  label.setText(`線上 ${client.peers.size + 1} 人${ping}`);
}
