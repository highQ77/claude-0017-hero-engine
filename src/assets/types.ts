import type { DataTexture, Texture } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';

/**
 * 資源類型 → 資料型別。
 * 自訂載入器可以用「宣告合併」擴充：
 * @example
 * declare module './assets/types' { interface AssetTypeMap { level: LevelData } }
 */
export interface AssetTypeMap {
  /** glTF 模型（.gltf、.glb） */
  gltf: GLTF;
  /** 圖片貼圖（.png、.jpg、.webp） */
  texture: Texture;
  /** HDR 環境貼圖（.hdr） */
  hdr: DataTexture;
  /** JSON 資料 */
  json: unknown;
  /** 純文字 */
  text: string;
  /** 音效（.mp3、.ogg、.wav） */
  audio: AudioBuffer;
  /** 3D 文字的字型（three.js 的 typeface JSON） */
  font: Font;
  /** 3D 文字的字型（.ttf） */
  ttf: Font;
}

export type { GLTF, Font };
