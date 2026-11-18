/** 3D 介面面板的場景檔存讀規則：UIPanel3D（UI3DPlugin 安裝時登記） */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { UIPanel3D } from './UI3D';

/**
 * UIPanel3D：{ src: 'ui/kiosk.xml', worldWidth, billboard, resolution, … }（欄位見 UIPanel3DData）。
 * 事件處理函式（handlers）是程式碼，不會存：用 ui3d.setHandlers 註冊共用的處理函式。
 */
export const uiPanel3dCodec = plainCodec(UIPanel3D, { skip: ['handlers', 'status', 'ui'] });

/** 3D 介面模組提供的所有存讀規則 */
export const ui3dCodecs: readonly ComponentCodec<never>[] = [uiPanel3dCodec] as unknown as ComponentCodec<never>[];
