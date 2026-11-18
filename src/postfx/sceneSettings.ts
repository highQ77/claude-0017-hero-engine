/**
 * 後製的場景設定（PostProcessingPlugin 安裝時登記）：
 *   "postfx": { "toneMapping": "aces", "exposure": 1.2, "bloom": { "enabled": true, "strength": 0.8 }, "vignette": { "enabled": true } }
 * 欄位和 PostFxSettings 一樣（只寫要改的），dof.focusOn 不能寫在檔案裡；卸載場景時恢復原本的設定。
 */
import type { SceneSettingHandler } from '../scene/SceneFile';
import type { PostFxSettings } from './PostProcessingPlugin';
import { isObject } from '../scene/json';

/** 檢查一個值的型別和預設值一樣（顏色可以是文字或數字） */
function check(path: string, value: unknown, def: unknown): void {
  if (isObject(def)) {
    if (!isObject(value)) throw new Error(`${path} 要是物件`);
    for (const [k, v] of Object.entries(value)) {
      if (!(k in def) || k === 'focusOn') throw new Error(`不認識的欄位「${path}.${k}」`);
      check(`${path}.${k}`, v, def[k]);
    }
    return;
  }
  const ok =
    typeof value === typeof def || (path.endsWith('.tint') && (typeof value === 'string' || typeof value === 'number'));
  if (!ok) throw new Error(`${path} 的型別不對，收到 ${JSON.stringify(value)}`);
}

export function postfxSettings(settings: () => PostFxSettings, defaults: () => PostFxSettings): SceneSettingHandler[] {
  return [
    {
      key: 'postfx',
      apply(value) {
        if (!isObject(value)) throw new Error('要是物件（例如 { "bloom": { "enabled": true } }）');
        const def = defaults() as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(value)) {
          if (!(k in def)) throw new Error(`不認識的欄位「${k}」`);
          check(k, v, def[k]);
        }
        const target = settings() as unknown as Record<string, unknown>;
        // 記下要改的欄位原本的值（巢狀的只記改到的那幾個）
        const before: [Record<string, unknown>, string, unknown][] = [];
        for (const [k, v] of Object.entries(value)) {
          if (isObject(v)) {
            const obj = target[k] as Record<string, unknown>;
            for (const [kk, vv] of Object.entries(v)) {
              before.push([obj, kk, obj[kk]]);
              obj[kk] = vv;
            }
          } else {
            before.push([target, k, target[k]]);
            target[k] = v;
          }
        }
        return () => {
          for (const [obj, k, v] of before.reverse()) obj[k] = v;
        };
      },
    },
  ];
}
