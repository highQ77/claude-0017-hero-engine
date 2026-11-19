import { registerChunk } from './chunks';
import { glslType } from './ShaderLibrary';
export { ShaderLibrary } from './ShaderLibrary';
export type {
  ShaderDefinition,
  EffectDefinition,
  ShaderBase,
  UniformInput,
  CustomMaterial,
  CustomEffect,
} from './ShaderLibrary';
export { BUILTIN_CHUNKS } from './chunks';
export { ShaderPresets, EffectPresets } from './presets';
export { ShaderPlugin, ShadersKey } from './ShaderPlugin';
export {
  compileShaderGraph,
  shaderGraphDefinition,
  shaderGraphEffectDefinition,
  loadShaderGraph,
  loadShaderGraphEffect,
  parseShaderGraphFile,
  stringifyShaderGraphFile,
  defineShaderNode,
  SHADER_GRAPH_FORMAT,
} from './graph';
export type { ShaderGraph, ShaderGraphFile, ShaderGraphNode, ShaderGraphLink, CompiledShaderGraph } from './graph';

// ───────── 小工具函式（依用途分類）─────────

/** 註冊：內建載入器、著色器片段（shaders 模組的部分；總入口 hero.register 有全部） */
export const register = {
  /** 註冊著色器片段（在自訂著色器裡用 #include 引用） */
  shaderChunk: registerChunk,
} as const;

/** GLSL：JavaScript 值對應的著色器型別 */
export const glsl = {
  /** JavaScript 值對應的 GLSL 型別（例如 THREE.Color → vec3） */
  typeOf: glslType,
} as const;
