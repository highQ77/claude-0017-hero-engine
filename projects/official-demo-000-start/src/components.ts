/**
 * 遊戲的元件與事件。
 */
import { type Entity, define } from '@engine/ecs';

/** 自轉（弧度／秒）；rate 是倍率（3D 控制台的滑桿調整玩家方塊的轉速） */
export const Spin = define.component('Spin', () => ({ x: 0, y: 0, rate: 1 }));
/** 會被踢、會跳的物理物件（球與箱子） */
export const Toy = define.tag('Toy');
/** 可用鍵盤／手把／搖桿移動 */
export const Player = define.component('Player', () => ({ speed: 3.2 }));
/** 繞著場地中心自動環繞的攝影機 */
export const Orbit = define.component('Orbit', () => ({ radius: 7.5, height: 3.2, speed: 0.18, angle: 0 }));

/** 撿到金幣（coin.ts 發出；hud.ts 收聽） */
export const CoinCollected = define.event<{ value: number }>('CoinCollected');
/** 玩家的方塊建立好了（levels.ts 發出；hud.ts 重設金幣進度、network.ts 同步給其他玩家） */
export const PlayerSpawned = define.event<{ entity: Entity }>('PlayerSpawned');
