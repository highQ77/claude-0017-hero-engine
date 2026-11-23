import { Color } from 'three';
import type { EffectDefinition } from '../shaders/ShaderLibrary';
import { tsl } from '../shaders/tsl';

const { clamp, dot, float, mix, select, vec2, vec3, vec4 } = tsl;

/**
 * 調色 + 暗角（合併成一個效果），放在色調映射之後，作用在最終顯示的顏色上。
 *
 * 和自訂效果一樣是 ShaderLibrary 的全螢幕效果（後製外掛建立時註冊，名稱 postfx.colorGrade），
 * 也可以在執行中用 shaders.update('postfx.colorGrade', { color }) 修改。
 * 參數由 postfx.settings.color、postfx.settings.vignette 控制（每幀寫進 uniform）。
 */
export const ColorGradeEffect: EffectDefinition = {
  name: 'postfx.colorGrade',
  uniforms: {
    gradeEnabled: true,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    tint: new Color(1, 1, 1),
    vignetteEnabled: true,
    vignetteOffset: 1,
    vignetteDarkness: 1,
  },
  color: (c) => {
    const u = c.uniforms;
    // 調色：亮度 → 對比 → 飽和度 → 色調
    let graded = c.color.rgb.add(u.brightness);
    graded = graded.sub(0.5).mul(u.contrast).add(0.5);
    const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
    graded = mix(vec3(luma), graded, u.saturation).mul(u.tint);
    let rgb = select(u.gradeEnabled.greaterThan(0.5), graded, c.color.rgb);
    // 暗角：離中心越遠越接近 (1 - darkness)
    const d = c.uv.sub(vec2(0.5)).mul(u.vignetteOffset);
    const vignetted = mix(rgb, vec3(float(1).sub(u.vignetteDarkness)), dot(d, d));
    rgb = select(u.vignetteEnabled.greaterThan(0.5), vignetted, rgb);
    return vec4(clamp(rgb, 0, 1), c.color.a);
  },
};
