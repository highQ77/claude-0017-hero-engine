import * as THREE from 'three';
import type { AssetLoader, AssetManager } from './AssetManager';
import { disposeObject3D } from './dispose';
import type { Font, GLTF } from './types';

/** 內建載入器的設定（例如 glTF 的 Draco 解碼器位置） */
export interface DefaultLoaderOptions {
  /**
   * Draco 解碼器所在路徑（例如 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'）。
   * 沒給就不支援 Draco 壓縮的模型。
   */
  dracoDecoderPath?: string;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** 內建載入器。three.js 的進階載入器用動態匯入，用到時才下載 */
export function registerDefaultLoaders(manager: AssetManager, options: DefaultLoaderOptions = {}): void {
  manager.registerLoader('texture', {
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'],
    async load(url) {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      // 預設當作顏色貼圖；法線、粗糙度等資料貼圖請改回 NoColorSpace
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    },
    dispose: (t) => t.dispose(),
  });

  manager.registerLoader('hdr', {
    extensions: ['.hdr'],
    async load(url) {
      const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
      const texture = await new RGBELoader().loadAsync(url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      return texture;
    },
    dispose: (t) => t.dispose(),
  });

  manager.registerLoader('gltf', createGltfLoader(options));

  manager.registerLoader('font', {
    extensions: ['.typeface.json'],
    async load(url): Promise<Font> {
      const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
      return new FontLoader().loadAsync(url);
    },
  });

  // TrueType / OpenType 字型：轉成 three.js 的 Font（可以用來產生立體文字，包含中文字型）
  manager.registerLoader('ttf', {
    extensions: ['.ttf', '.otf'],
    async load(url): Promise<Font> {
      const [{ TTFLoader }, { Font: FontClass }] = await Promise.all([
        import('three/examples/jsm/loaders/TTFLoader.js'),
        import('three/examples/jsm/loaders/FontLoader.js'),
      ]);
      const buffer = await (await fetchOk(url)).arrayBuffer();
      return new FontClass(new TTFLoader().parse(buffer) as never);
    },
  });

  manager.registerLoader('json', {
    extensions: ['.json'],
    load: async (url) => (await fetchOk(url)).json(),
  });

  manager.registerLoader('text', {
    extensions: ['.txt', '.glsl', '.vert', '.frag', '.wgsl', '.csv'],
    load: async (url) => (await fetchOk(url)).text(),
  });

  manager.registerLoader('audio', {
    extensions: ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac'],
    load: (url) => new THREE.AudioLoader().loadAsync(url),
  });
}

function createGltfLoader(options: DefaultLoaderOptions): AssetLoader<GLTF> {
  // 載入器建立一次重複使用（Draco 解碼器的工作執行緒可以共用）
  let loaderPromise: Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader> | null = null;

  const getLoader = () =>
    (loaderPromise ??= (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      if (options.dracoDecoderPath) {
        const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
        loader.setDRACOLoader(new DRACOLoader().setDecoderPath(options.dracoDecoderPath));
      }
      return loader;
    })());

  return {
    extensions: ['.gltf', '.glb'],
    async load(url) {
      return (await getLoader()).loadAsync(url);
    },
    dispose: (gltf) => disposeObject3D(gltf.scene),
  };
}
