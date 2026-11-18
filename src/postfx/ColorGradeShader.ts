import { Color } from 'three';

/**
 * 調色 + 暗角（合併成一次全螢幕繪製）。
 * 放在色調映射之後，作用在最終顯示的顏色上。
 */
export const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    gradeEnabled: { value: true },
    brightness: { value: 0 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    tint: { value: new Color(1, 1, 1) },
    vignetteEnabled: { value: true },
    vignetteOffset: { value: 1 },
    vignetteDarkness: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform bool gradeEnabled;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    uniform vec3 tint;
    uniform bool vignetteEnabled;
    uniform float vignetteOffset;
    uniform float vignetteDarkness;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      if (gradeEnabled) {
        color += brightness;
        color = (color - 0.5) * contrast + 0.5;
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, saturation);
        color *= tint;
      }
      if (vignetteEnabled) {
        vec2 uv = (vUv - vec2(0.5)) * vec2(vignetteOffset);
        color = mix(color, vec3(1.0 - vignetteDarkness), dot(uv, uv));
      }
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};
