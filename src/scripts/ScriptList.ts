/**
 * 場景檔裡的腳本（ScriptList）：在 3D 場景編輯器替物件掛腳本、填參數，存進場景檔。
 *
 *   <Entity id="coin-1">
 *     <ScriptList>
 *       <Coin value="2"/>          腳本名稱 → 參數（覆蓋腳本類別裡的預設值）
 *     </ScriptList>
 *   </Entity>
 *
 * 遊戲要先用名稱登記腳本類別：scripts.register({ Coin, Rotator })。
 * 用名稱登記（不是 Coin.name）：打包壓縮後類別名稱會變，物件的鍵不會。
 * 載入場景檔時，ScriptList 列出的腳本會自動加上（在這一幀的腳本執行之前；這時其他元件都已經加好）。
 */
import { defineComponent } from '../ecs/Component';
import type { ComponentCodec } from '../scene/SceneFile';
import { isPlainObject as isPlain } from '../scene/json';

/** ScriptList 的資料 */
export interface ScriptListData {
  /** 腳本名稱 → 參數（只寫和預設值不同的） */
  scripts: Record<string, Record<string, unknown>>;
}

/** 要掛在這個物件上的腳本（場景檔用；實際的腳本實例在 Scripts 元件） */
export const ScriptList = defineComponent<ScriptListData>('ScriptList', () => ({ scripts: {} }));

/** 腳本名稱：英文字母開頭的英數字（和類別名稱一樣） */
const VALID_NAME = /^[A-Za-z_$][\w$]*$/;

/** ScriptList 的存讀規則：檔案裡是 { 腳本名稱: { 參數… } } */
export const scriptListCodec: ComponentCodec<ScriptListData> = {
  type: ScriptList,
  read(data) {
    if (data === null || data === undefined) return {};
    if (!isPlain(data)) throw new Error('要是物件 { 腳本名稱: { 參數… } }');
    const scripts: Record<string, Record<string, unknown>> = {};
    for (const [name, props] of Object.entries(data)) {
      if (!VALID_NAME.test(name))
        throw new Error(`腳本名稱「${name}」不合法（要和類別名稱一樣：英文字母開頭的英數字）`);
      if (props !== null && props !== undefined && !isPlain(props))
        throw new Error(`腳本「${name}」的參數要是物件，收到 ${JSON.stringify(props)}`);
      scripts[name] = { ...((props as Record<string, unknown>) ?? {}) };
    }
    return { scripts };
  },
  write(value) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, props] of Object.entries(value.scripts)) out[name] = { ...props };
    return out;
  },
};
