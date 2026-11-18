/** 節點式著色器：節點定義、編譯器、節點圖檔（著色器編輯器存的 public/shaders/*.shader.json） */
export {
  NODE_DEFS,
  CATEGORIES,
  PALETTES,
  HELPERS,
  TYPE_COLOR,
  TYPE_DIM,
  CENTERED_UV,
  defineShaderNode,
  convertType,
  widerType,
  glslFloat,
  hexToVec3,
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
  CategoryId,
} from './nodes';
export { compileShaderGraph, analyzeShaderGraphTypes, upstreamHas, GRAPH_UNIFORMS } from './compile';
export type { ShaderGraph, ShaderGraphNode, ShaderGraphLink, CompiledShaderGraph, CompileOptions } from './compile';
export {
  SHADER_GRAPH_FORMAT,
  normalizeShaderGraph,
  parseShaderGraphFile,
  stringifyShaderGraphFile,
  shaderGraphDefinition,
  loadShaderGraph,
  builtinUVGrid,
  ShaderGraphTextures,
} from './file';
export type { ShaderGraphFile, ShaderGraphDefinitionOptions } from './file';
export { shaderGraphMaterial, reloadShaderGraphMaterials } from './material';
