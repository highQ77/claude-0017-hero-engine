/** 3D 文字的場景檔存讀規則：Text3D（Text3DPlugin 安裝時登記） */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { Text3D } from './Text3D';

/**
 * Text3D：{ text, mode, size, color: '#rrggbb', emissive, … }（欄位見 Text3DData）。
 * 自訂材質（material）是程式建立的 three.js 物件，不會存。
 */
export const text3dCodec = plainCodec(Text3D, {
  colors: ['color'],
  nullable: ['background'],
  choices: { mode: ['extrude', 'flat'], align: ['left', 'center', 'right'], anchorY: ['top', 'middle', 'bottom'] },
  skip: ['material', 'status'],
});

/** 3D 文字模組提供的所有存讀規則 */
export const text3dCodecs: readonly ComponentCodec<never>[] = [text3dCodec] as unknown as ComponentCodec<never>[];
