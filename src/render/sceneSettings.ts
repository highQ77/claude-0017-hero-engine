/**
 * 繪製的場景設定（RenderPlugin 安裝時登記）：
 *   "background": "#223344"（null 代表透明，不清除背景）
 *   "fog": { "color": "#aabbcc", "near": 10, "far": 60 }   線性霧
 *   "fog": { "color": "#aabbcc", "density": 0.03 }         指數霧（越遠越濃）
 */
import * as THREE from 'three';
import type { SceneSettingHandler } from '../scene/SceneFile';
import { isObject } from '../scene/json';

const isColor = (v: unknown) => typeof v === 'string' || typeof v === 'number';

/** 依繪製外掛的 three.js 場景建立設定的處理方式 */
export function renderSettings(scene: () => THREE.Scene): SceneSettingHandler[] {
  return [
    {
      key: 'background',
      apply(value) {
        if (value !== null && !isColor(value))
          throw new Error(`要是顏色（'#rrggbb'）或 null，收到 ${JSON.stringify(value)}`);
        const s = scene();
        const prev = s.background;
        s.background = value === null ? null : new THREE.Color(value as string);
        return () => {
          s.background = prev;
        };
      },
    },
    {
      key: 'fog',
      apply(value) {
        const s = scene();
        const prev = s.fog;
        if (value === null) s.fog = null;
        else {
          if (!isObject(value) || !isColor(value.color))
            throw new Error('要是 { color, near, far } 或 { color, density }');
          const num = (k: string, d: number) => {
            const v = value[k] ?? d;
            if (typeof v !== 'number' || !(v >= 0)) throw new Error(`${k} 要是 0 以上的數字`);
            return v;
          };
          for (const k of Object.keys(value))
            if (!['color', 'near', 'far', 'density'].includes(k)) throw new Error(`不認識的欄位「${k}」`);
          s.fog =
            value.density !== undefined
              ? new THREE.FogExp2(value.color as string, num('density', 0.02))
              : new THREE.Fog(value.color as string, num('near', 1), num('far', 100));
        }
        return () => {
          s.fog = prev;
        };
      },
    },
  ];
}
