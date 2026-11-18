/**
 * 尋路格子（場景設定 navGrid）的編輯：畫格子、從碰撞體產生。都是純資料運算，回傳新的場景檔寫法。
 */
import type * as THREE from 'three';
import { NavGrid, decodeWalkable, encodeWalkable, navGridFromFile, navGridToFile, type NavGridFile } from '../../ai';

/** 新的尋路格子：預設 20 × 20 公尺、格子 0.5 */
export function newNavGrid(): NavGridFile {
  return { min: [-10, -10], max: [10, 10], cellSize: 0.5 };
}

/** 格數資訊（面板顯示用） */
export function navGridStats(file: NavGridFile): { cols: number; rows: number; blocked: number } {
  const g = navGridFromFile(file);
  let blocked = 0;
  for (const v of g.walkable) if (v === 0) blocked++;
  return { cols: g.cols, rows: g.rows, blocked };
}

/** 把格子設成擋住（walkable false）或可走 */
export function paintCells(file: NavGridFile, cells: readonly [number, number][], walkable: boolean): NavGridFile {
  const g = navGridFromFile(file);
  for (const [c, r] of cells) g.setWalkable(c, r, walkable);
  return withWalkable(file, g.walkable);
}

/** 全部改成可走 */
export function clearCells(file: NavGridFile): NavGridFile {
  const { walkable: _, ...rest } = file;
  return rest;
}

/**
 * 改範圍或格子大小：保留原本擋住的位置（依格子中心換算），超出新範圍的丟掉。
 */
export function resizeNavGrid(file: NavGridFile, patch: Partial<NavGridFile>): NavGridFile {
  const old = navGridFromFile(file);
  const next = { ...file, ...patch };
  const g = new NavGrid({
    min: { x: next.min[0], z: next.min[1] },
    max: { x: next.max[0], z: next.max[1] },
    cellSize: next.cellSize,
    y: next.y,
  });
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      // 只搬原本範圍裡擋住的格子（新加的範圍是可走的）
      const cell = old.cellOf(g.cellCenter(c, r));
      if (cell && old.walkable[cell.row * old.cols + cell.col] === 0) g.setWalkable(c, r, false);
    }
  const { walkable: _, ...rest } = next;
  return withWalkable(rest, g.walkable);
}

/**
 * 從碰撞體產生：格子中心落在碰撞體範圍內（往外加 margin，預設半格），
 * 而且碰撞體高於地面 0.1、低於 height（預設 1.8，角色的高度）的，就是擋住的。
 * 地板（頂端不高於格子高度 + 0.1）不算。
 */
export function bakeFromBoxes(
  file: NavGridFile,
  boxes: readonly THREE.Box3[],
  options: { height?: number; margin?: number } = {},
): NavGridFile {
  const g = navGridFromFile(clearCells(file));
  const height = options.height ?? 1.8;
  const margin = options.margin ?? g.cellSize / 2;
  const obstacles = boxes.filter((b) => b.max.y > g.y + 0.1 && b.min.y < g.y + height);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const p = g.cellCenter(c, r);
      const hit = obstacles.some(
        (b) => p.x >= b.min.x - margin && p.x <= b.max.x + margin && p.z >= b.min.z - margin && p.z <= b.max.z + margin,
      );
      if (hit) g.setWalkable(c, r, false);
    }
  return withWalkable(file, g.walkable);
}

/** 換掉可走資料（全部可走時省略 walkable） */
function withWalkable(file: NavGridFile, walkable: Uint8Array): NavGridFile {
  const { walkable: _, ...rest } = file;
  return walkable.some((v) => v === 0) ? { ...rest, walkable: encodeWalkable(walkable) } : rest;
}

export { decodeWalkable, navGridToFile };
