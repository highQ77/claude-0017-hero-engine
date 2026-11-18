import * as THREE from 'three';

/**
 * 內建的共用程式片段，在著色器中用 #include <名稱> 引用。
 */
export const BUILTIN_CHUNKS: Record<string, string> = {
  /** 雜訊：hash、值雜訊、碎形雜訊（2D / 3D） */
  engine_noise: /* glsl */ `
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float hash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
                 mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
            mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
        mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
            mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
        u.z);
    }
    float fbm2(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise2(p); p *= 2.02; a *= 0.5; }
      return v / 0.9375;
    }
    float fbm3(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.02; a *= 0.5; }
      return v / 0.9375;
    }
  `,
  /** 常用工具：重新映射、菲涅耳（邊緣光） */
  engine_utils: /* glsl */ `
    float remap(float v, float inMin, float inMax, float outMin, float outMax) {
      return outMin + (v - inMin) * (outMax - outMin) / (inMax - inMin);
    }
    // 視線與法線越垂直越接近 1（物體邊緣）
    float fresnel(vec3 viewDir, vec3 normal, float power) {
      return pow(1.0 - clamp(dot(normalize(viewDir), normalize(normal)), 0.0, 1.0), power);
    }
  `,
};

/**
 * 註冊共用程式片段，之後所有著色器都可以 #include <name>。
 * 已存在的名稱會被覆蓋（three.js 內建的片段請勿覆蓋）。
 */
export function registerChunk(name: string, code: string): void {
  if (!/^\w+$/.test(name)) throw new Error(`片段名稱只能包含英數字與底線：${name}`);
  (THREE.ShaderChunk as Record<string, string>)[name] = code;
}

let builtinsRegistered = false;
export function registerBuiltinChunks(): void {
  if (builtinsRegistered) return;
  for (const [name, code] of Object.entries(BUILTIN_CHUNKS)) registerChunk(name, code);
  builtinsRegistered = true;
}
