/**
 * 後製的場景設定（PostProcessingPlugin 安裝時登記）：
 *   "postfx": { "toneMapping": "aces", "exposure": 1.2, "bloom": { "enabled": true, "strength": 0.8 }, "vignette": { "enabled": true } }
 * 欄位和 PostFxSettings 一樣（只寫要改的），dof.focusOn 不能寫在檔案裡；卸載場景時恢復原本的設定。
 * 自訂效果寫在 effects（整個清單替換）：
 *   "effects": ["pixelate", { "graph": "shaders/crt.shader.json", "uniforms": { "uMouse": [0.5, 0.5] } }]
 */
import type { SceneSettingHandler } from '../scene/SceneFile';
import type { PostFxSettings } from './PostProcessingPlugin';
import { isObject } from '../scene/json';

const EFFECT_KEYS = ['name', 'graph', 'uniforms', 'stage', 'enabled'];

/** 檢查 effects：效果名稱，或 { name、graph、uniforms、stage、enabled } */
function checkEffects(value: unknown): void {
  if (!Array.isArray(value))
    throw new Error('effects 要是陣列（例如 ["pixelate", { "graph": "shaders/crt.shader.json" }]）');
  value.forEach((e, i) => {
    const path = `effects[${i}]`;
    if (typeof e === 'string') return;
    if (!isObject(e)) throw new Error(`${path} 要是效果名稱或物件`);
    for (const k of Object.keys(e)) if (!EFFECT_KEYS.includes(k)) throw new Error(`不認識的欄位「${path}.${k}」`);
    if (e.name === undefined && e.graph === undefined) throw new Error(`${path} 需要 name 或 graph`);
    if (e.name !== undefined && typeof e.name !== 'string') throw new Error(`${path}.name 要是文字`);
    if (e.graph !== undefined && typeof e.graph !== 'string')
      throw new Error(`${path}.graph 要是文字（節點圖檔的路徑）`);
    if (e.uniforms !== undefined && !isObject(e.uniforms)) throw new Error(`${path}.uniforms 要是物件`);
    if (e.stage !== undefined && e.stage !== 'scene' && e.stage !== 'display')
      throw new Error(`${path}.stage 要是 "scene" 或 "display"`);
    if (e.enabled !== undefined && typeof e.enabled !== 'boolean')
      throw new Error(`${path}.enabled 要是 true 或 false`);
  });
}

/** 檢查一個值的型別和預設值一樣（顏色可以是文字或數字） */
function check(path: string, value: unknown, def: unknown): void {
  if (path === 'effects') return checkEffects(value);
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
