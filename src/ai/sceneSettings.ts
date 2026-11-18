/**
 * 導航網格的場景設定（AIPlugin 安裝時登記）：
 *   "navGrid": { "min": [-10, -10], "max": [10, 10], "cellSize": 0.5, "y": 0, "walkable": [120, 4, 36, …] }
 * walkable 是「可走、擋住、可走、擋住…」交替的格數（從第一格開始、一列一列），省略代表全部可走。
 */
import type { SceneSettingHandler } from '../scene/SceneFile';
import { NavGrid } from './NavGrid';

/** 場景檔裡的導航網格 */
export interface NavGridFile {
  /** 範圍的最小角 [x, z] */
  min: [number, number];
  /** 範圍的最大角 [x, z] */
  max: [number, number];
  /** 格子大小（預設 0.5） */
  cellSize?: number;
  /** 路徑點的高度（預設 0） */
  y?: number;
  /** 可走、擋住交替的格數（第一個是可走的格數，可以是 0） */
  walkable?: number[];
}

/** 0/1 陣列 → 可走、擋住交替的格數 */
export function encodeWalkable(walkable: ArrayLike<number>): number[] {
  const runs: number[] = [];
  let want = 1;
  let count = 0;
  for (let i = 0; i < walkable.length; i++) {
    if ((walkable[i] ? 1 : 0) === want) count++;
    else {
      runs.push(count);
      want = 1 - want;
      count = 1;
    }
  }
  runs.push(count);
  return runs;
}

/** 可走、擋住交替的格數 → 0/1（長度 length；不夠的補可走） */
export function decodeWalkable(runs: readonly number[], length: number): Uint8Array {
  const out = new Uint8Array(length).fill(1);
  let i = 0;
  runs.forEach((n, k) => {
    const v = k % 2 === 0 ? 1 : 0;
    for (let j = 0; j < n && i < length; j++) out[i++] = v;
  });
  return out;
}

/** 導航網格 → 場景檔寫法 */
export function navGridToFile(grid: NavGrid): NavGridFile {
  const out: NavGridFile = {
    min: [grid.min.x, grid.min.z],
    max: [grid.min.x + grid.cols * grid.cellSize, grid.min.z + grid.rows * grid.cellSize],
    cellSize: grid.cellSize,
  };
  if (grid.y !== 0) out.y = grid.y;
  if (grid.walkable.some((v) => v === 0)) out.walkable = encodeWalkable(grid.walkable);
  return out;
}

/** 場景檔寫法 → 導航網格（格式錯誤時拋出錯誤） */
export function navGridFromFile(value: unknown): NavGrid {
  const v = value as Partial<NavGridFile> | null;
  const pair = (p: unknown, name: string) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n)))
      throw new Error(`${name} 要是 [x, z]`);
    return { x: p[0] as number, z: p[1] as number };
  };
  if (!v || typeof v !== 'object') throw new Error('要是物件 { min, max, cellSize, walkable }');
  const min = pair(v.min, 'min');
  const max = pair(v.max, 'max');
  if (max.x <= min.x || max.z <= min.z) throw new Error('max 要比 min 大');
  if (v.cellSize !== undefined && !(typeof v.cellSize === 'number' && v.cellSize > 0))
    throw new Error('cellSize 要大於 0');
  if (v.y !== undefined && typeof v.y !== 'number') throw new Error('y 要是數字');
  const grid = new NavGrid({ min, max, cellSize: v.cellSize, y: v.y });
  if (grid.cols * grid.rows > 4_000_000) throw new Error(`格子太多（${grid.cols} × ${grid.rows}），請加大 cellSize`);
  if (v.walkable !== undefined) {
    if (!Array.isArray(v.walkable) || !v.walkable.every((n) => Number.isInteger(n) && n >= 0))
      throw new Error('walkable 要是格數的陣列（可走、擋住交替）');
    grid.walkable.set(decodeWalkable(v.walkable, grid.walkable.length));
  }
  return grid;
}

/** 依 AI 外掛建立設定的處理方式（設定 plugin.navGrid，卸載時恢復原本的網格） */
export function aiSettings(plugin: { navGrid: NavGrid | null }): SceneSettingHandler[] {
  return [
    {
      key: 'navGrid',
      apply(value) {
        const prev = plugin.navGrid;
        plugin.navGrid = value === null ? null : navGridFromFile(value);
        return () => {
          plugin.navGrid = prev;
        };
      },
    },
  ];
}
