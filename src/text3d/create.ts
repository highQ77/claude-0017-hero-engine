/** text3d 的 create 分類（獨立的小檔案：總入口 hero.create 只會帶進這裡，不會包含整個 text3d 模組） */
import * as THREE from 'three';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';

/**
 * 文字的平面形狀（幾何）：用 3D 字型的輪廓產生，可以交給 create.mesh、spawn.mesh。
 * center 為 true（預設）時以文字中心為原點。
 * @param font 字型（load.builtinFont() 或 load.font(網址)）
 * @param text 文字
 * @param size 字的大小（公尺）
 * @param options 是否以中心為原點、曲線的分段數
 * @example
 * const geometry = create.textShape(await load.builtinFont(), 'HERO', 1);
 */
function createTextShape(
  font: Font,
  text: string,
  size = 1,
  options: {
    /** true（預設）：以文字中心為原點 */
    center?: boolean;
    /** 每段曲線切成幾段：越多越圓滑，三角形也越多 */
    curveSegments?: number;
  } = {},
): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(font.generateShapes(text, size), options.curveSegments ?? 8);
  if (options.center !== false) g.center();
  return g;
}

/** 建立物件：文字形狀（text3d 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 文字的平面形狀：create.textShape(font, 'HERO', 1) */
  textShape: createTextShape,
} as const;
