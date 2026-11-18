/** 資源元件的場景檔存讀規則：Model（AssetPlugin 安裝時登記） */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { Model } from './Model';

/** Model：{ url: 'models/tree.glb', castShadow, receiveShadow }（網址相對於頁面，也就是專案的 public/） */
export const modelCodec = plainCodec(Model, { skip: ['status', 'error', 'animations'] });

/** 資源模組提供的所有存讀規則 */
export const assetCodecs: readonly ComponentCodec<never>[] = [modelCodec] as unknown as ComponentCodec<never>[];
