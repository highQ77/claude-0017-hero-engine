import { Color } from 'three';
import type { EffectDefinition } from '../shaders/ShaderLibrary';

/**
 * 調色 + 暗角（合併成一次全螢幕繪製），放在色調映射之後，作用在最終顯示的顏色上。
 *
 * 和自訂效果一樣是 ShaderLibrary 的全螢幕效果（後製外掛建立時註冊，名稱 postfx.colorGrade）：
 * 可以用引擎內建的 uniform（uTime、uResolution）、#include 共用的著色器片段，
 * 也可以在執行中用 shaders.update('postfx.colorGrade', { fragment }) 修改。
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
  fragment: /* glsl */ `
    vec3 c = color.rgb;
    if (gradeEnabled) {
      c += brightness;
      c = (c - 0.5) * contrast + 0.5;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      c *= tint;
    }
    if (vignetteEnabled) {
      vec2 d = (uv - vec2(0.5)) * vec2(vignetteOffset);
      c = mix(c, vec3(1.0 - vignetteDarkness), dot(d, d));
    }
    color = vec4(clamp(c, 0.0, 1.0), color.a);
  `,
};
