import { Vector3 } from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { Transform } from '../scene';
import { getWorldPosition } from '../scene/Transform';
import type { UIPlugin } from './UIPlugin';
import { UIMinimap, type MinimapMarker } from './widgets';

/**
 * 小地圖標記：有這個元件（加上 Transform）的實體會顯示在小地圖上。
 * @example world.add(enemy, MinimapMarker, { color: '#ff5a5a', shape: 'dot' })
 */
export interface MinimapMarkerData {
  /** 標記的顏色 */
  color: string;
  /** 標記的形狀 */
  shape: NonNullable<MinimapMarker['shape']>;
  /** 標記的大小（像素） */
  size: number;
  /** 箭頭跟著實體的方向轉 */
  showHeading: boolean;
  /** 超出範圍時貼在小地圖邊緣（任務目標） */
  pin: boolean;
}

/** 小地圖標記元件：有這個元件的實體會出現在小地圖上 */
export const MinimapMarkerComponent = defineComponent<MinimapMarkerData>('MinimapMarker', () => ({
  color: '#ffb347',
  shape: 'dot',
  size: 6,
  showHeading: false,
  pin: false,
}));

/** MinimapPlugin 的設定 */
export interface MinimapPluginOptions {
  /** 介面裡 <UIMinimap> 的 id（可以給好幾個，例如 HUD 和手機版面各一個） */
  minimap: string | string[];
  /** 小地圖中心跟著哪個實體（通常是玩家）；不給時以原點為中心 */
  follow?: Entity | (() => Entity | null);
  /** 每秒更新幾次（預設 15） */
  rate?: number;
}

const _p = new Vector3();
const _f = new Vector3();

/** 實體面向（弧度，0 = 朝 -Z，順時針為正） */
function headingOf(worldMatrix: { elements: number[] }): number {
  const e = worldMatrix.elements;
  // 前方 = -Z 軸
  _f.set(-e[8], -e[9], -e[10]);
  return Math.atan2(_f.x, -_f.z);
}

/**
 * 小地圖外掛：每幀（節流）把有 MinimapMarker 的實體位置送到介面上的 <UIMinimap>，
 * 並以 follow 實體為中心。需先安裝 EcsPlugin、ScenePlugin 與 UIPlugin。
 */
export class MinimapPlugin implements Plugin {
  readonly name = 'minimap';
  readonly dependencies = ['ecs', 'scene', 'ui2d'] as const;
  private ecs: EcsPlugin | null = null;
  private acc = 0;

  /**
   * @param options 介面裡小地圖的 id、中心跟著哪個實體、每秒更新幾次
   */
  constructor(private readonly options: MinimapPluginOptions) {}

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = (this.ecs = engine.getPlugin<EcsPlugin>('ecs')!);
    const ui = engine.getPlugin<UIPlugin>('ui2d')!.ui;
    const interval = 1 / (this.options.rate ?? 15);
    ecs.addSystem({
      name: 'minimap',
      phase: 'lateUpdate',
      priority: 1100, // 變換計算之後
      run: (world, time) => {
        this.acc += time.realDelta || time.unscaledDelta;
        if (this.acc < interval) return;
        this.acc %= interval;
        const ids = Array.isArray(this.options.minimap) ? this.options.minimap : [this.options.minimap];
        const maps = ids.map((id) => ui.get(id)).filter((m): m is UIMinimap => m instanceof UIMinimap && m.visible);
        if (maps.length === 0) return;
        const f = this.options.follow;
        const followed = typeof f === 'function' ? f() : (f ?? null);
        const ft = followed !== null && world.isAlive(followed) ? world.get(followed, Transform) : undefined;
        if (ft) {
          getWorldPosition(ft, _p);
          const heading = headingOf(ft.worldMatrix);
          for (const map of maps) map.setView(_p.x, _p.z, heading);
        }
        const markers: MinimapMarker[] = [];
        world.query([Transform, MinimapMarkerComponent]).each((e, t, m) => {
          if (e === followed) return;
          getWorldPosition(t, _p);
          markers.push({
            x: _p.x,
            z: _p.z,
            color: m.color,
            shape: m.shape,
            size: m.size,
            pin: m.pin,
            heading: m.showHeading ? headingOf(t.worldMatrix) : undefined,
          });
        });
        for (const map of maps) map.setMarkers(markers);
      },
    });
  }

  uninstall(): void {
    this.ecs?.removeSystem('minimap');
    this.ecs = null;
  }
}
