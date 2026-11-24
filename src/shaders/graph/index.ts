/** 節點式著色器：節點定義、編譯器、節點圖檔（著色器編輯器存的 public/shaders/*.shader.json） */
export {
  NODE_DEFS,
  CATEGORIES,
  PALETTES,
  TYPE_COLOR,
  TYPE_DIM,
  defineShaderNode,
  convertType,
  widerType,
  hexColor,
} from './nodes';
export type {
  GraphType,
  PortType,
  NodeDef,
  NodeDefInput,
  NodeInput,
  NodeOutput,
  NodeParam,
  NodeContext,
  NodeBuiltin,
  CategoryId,
} from './nodes';
export {
  compileShaderGraph,
  analyzeShaderGraphTypes,
  upstreamHas,
  shaderGraphKind,
  shaderGraphParams,
  GRAPH_UNIFORMS,
} from './compile';
export type {
  ShaderGraph,
  ShaderGraphNode,
  ShaderGraphLink,
  CompiledShaderGraph,
  CompileOptions,
  ShaderGraphKind,
  ShaderGraphParam,
  ShaderGraphLighting,
  GraphEnv,
} from './compile';
export {
  SHADER_GRAPH_FORMAT,
  normalizeShaderGraph,
  parseShaderGraphFile,
  stringifyShaderGraphFile,
  shaderGraphDefinition,
  shaderGraphEffectDefinition,
  loadShaderGraph,
  loadShaderGraphEffect,
  builtinUVGrid,
  ShaderGraphTextures,
} from './file';
export type { ShaderGraphFile, ShaderGraphDefinitionOptions } from './file';
export { shaderGraphMaterial, reloadShaderGraphMaterials } from './material';
