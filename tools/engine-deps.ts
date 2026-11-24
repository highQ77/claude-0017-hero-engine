/**
 * 引擎、編輯器、遊戲專案用到的第三方套件：開發伺服器啟動時就先預先打包（optimizeDeps.include）。
 * 遊戲專案的設定（tools/project.ts）與使用手冊（doc/vite.config.ts）共用。
 *
 * 為什麼要列出來：沒列出的套件要等頁面用到時才被發現，Vite 會重新打包、要求頁面重新整理。
 * 入口頁沒有 Vite 的用戶端（切換專案時不會跳），收不到重新整理的通知就會停在空白畫面；
 * 重新打包到一半時開發伺服器又重新啟動（切換專案、改 tools/），快取也會壞掉。
 * 引擎新增套件時記得加在這裡（tests/engine-deps.test.ts 會檢查有沒有漏掉）。
 */
export const ENGINE_DEPS = [
  'three',
  // WebGPURenderer、節點材質（TSL）：RenderPlugin 預設用 WebGPU
  'three/webgpu',
  'three/tsl',
  'yoga-layout/load',
  'lil-gui',
  'tone',
  '@dimforge/rapier3d-compat',
  // d3.js（套件 @engine/packages/d3-chart 與範例專案用的資訊視覺化）
  'd3',
  'd3-zoom',
  ...[
    'controls/OrbitControls.js',
    'controls/TransformControls.js',
    // 3D 網頁面板（@engine/web3d）
    'renderers/CSS3DRenderer.js',
    'geometries/TextGeometry.js',
    'loaders/FontLoader.js',
    'loaders/GLTFLoader.js',
    'loaders/DRACOLoader.js',
    'loaders/HDRLoader.js',
    'loaders/TTFLoader.js',
    'libs/meshopt_decoder.module.js',
    'utils/SkeletonUtils.js',
    // 後製（TSL 節點）
    'tsl/display/BloomNode.js',
    'tsl/display/DepthOfFieldNode.js',
    'tsl/display/FilmNode.js',
    'tsl/display/FXAANode.js',
    'tsl/display/GTAONode.js',
    'tsl/display/SMAANode.js',
  ].map((p) => `three/examples/jsm/${p}`),
];
