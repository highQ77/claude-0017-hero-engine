import * as THREE from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import GTAONode from 'three/examples/jsm/tsl/display/GTAONode.js';
import { NodeMaterial } from 'three/webgpu';
import DepthOfFieldNode from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { film } from 'three/examples/jsm/tsl/display/FilmNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity, World } from '../ecs';
import type { OverlayCompositor, RenderPlugin } from '../render/RenderPlugin';
import { Transform } from '../scene';
import { ColorGradeEffect } from './ColorGradeEffect';
import { ShaderLibrary, type CustomEffect, type PostFxPass } from '../shaders/ShaderLibrary';
import { ShadersKey } from '../shaders/keys';
import { type ShaderNode, tsl } from '../shaders/tsl';
import { createLogger } from '../core/Logger';
import { PostFxKey } from './keys';
import { registerSceneSettings } from '../scene/SceneFile';
import { postfxSettings } from './sceneSettings';
export { PostFxKey } from './keys';

/** 色調映射：把亮度很高的顏色壓回螢幕能顯示的範圍（aces 電影感、agx、neutral…） */
export type ToneMappingName = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces' | 'agx' | 'neutral';
/** 反鋸齒：auto（依螢幕自動選）、msaa、fxaa、smaa、none */
export type AntialiasMode = 'auto' | 'none' | 'msaa' | 'fxaa' | 'smaa';

/** 後製設定（修改後下一幀生效） */
export interface PostFxSettings {
  /** 色調映射：把高亮度的顏色壓回可顯示範圍（不需要開任何效果也會生效） */
  toneMapping: ToneMappingName;
  /** 曝光 */
  exposure: number;
  /** 光暈：亮的地方向外發光 */
  bloom: {
    /** 是否開啟 */
    enabled: boolean;
    /** 強度：光暈有多亮，預設 0.6 */
    strength: number;
    /** 擴散範圍 0~1：越大光暈散得越開，預設 0.4 */
    radius: number;
    /** 亮度門檻：比這個亮的地方才發光（0~1，越低越多地方發光），預設 0.85 */
    threshold: number;
  };
  /** 環境光遮蔽：角落、縫隙變暗，增加立體感（較耗效能） */
  ao: {
    /** 是否開啟 */
    enabled: boolean;
    /** 取樣半徑（世界單位）：多遠以內的物體會互相遮蔽，預設 0.5 */
    radius: number;
    /** 強度：遮蔽處變暗的程度，預設 1 */
    intensity: number;
  };
  /** 景深：對焦距離以外變模糊 */
  dof: {
    /** 是否開啟 */
    enabled: boolean;
    /** 對焦距離（世界單位）；設定 focusOn 時會自動計算 */
    focus: number;
    /** 光圈：越大，離對焦距離越近就開始模糊（完全模糊的距離約是 0.02 / aperture 世界單位） */
    aperture: number;
    /** 最大模糊：模糊半徑約是畫面高度的 maxBlur × 0.2（0.01 時約 2%；和解析度、像素比無關） */
    maxBlur: number;
    /** 自動對焦到這個實體 */
    focusOn: Entity | null;
  };
  /** 底片顆粒 */
  film: {
    /** 是否開啟 */
    enabled: boolean;
    /** 顆粒強度 0~1，預設 0.35 */
    intensity: number;
    /** true：畫面變成黑白 */
    grayscale: boolean;
  };
  /** 暗角：畫面四周變暗 */
  vignette: {
    /** 是否開啟 */
    enabled: boolean;
    /** 暗角的範圍：越大，暗角越往中央延伸、四角也越暗，預設 1 */
    offset: number;
    /** 變暗的程度：1 時畫面四角大約暗一半，預設 1.1 */
    darkness: number;
  };
  /** 調色 */
  color: {
    /** 是否開啟 */
    enabled: boolean;
    /** 亮度：加在每個顏色上，0 不變（-1~1） */
    brightness: number;
    /** 對比：1 不變，大於 1 對比更強，0 變成一片灰 */
    contrast: number;
    /** 飽和度：1 不變，0 黑白，大於 1 更鮮豔 */
    saturation: number;
    /** 色調：乘在畫面上的顏色，白色（預設）不變，例如 '#ffe0c0' 偏暖 */
    tint: THREE.ColorRepresentation;
  };
  /**
   * 反鋸齒：
   * - auto（預設）：像素比 1.25 以下用 msaa，高解析度螢幕用 fxaa
   *   （後製畫布是半精度浮點，Retina 上的 4 倍 MSAA 會把 FPS 從 60 拖到 30）
   * - msaa：多重取樣，品質好；高解析度螢幕上成本很高（見 msaaSamples）。開了環境光遮蔽（ao）時改用 fxaa
   * - fxaa：最便宜，邊緣略糊
   * - smaa：比 fxaa 銳利
   */
  antialias: AntialiasMode;
  /** MSAA 取樣數（2 或 4，預設 4）。後製用半精度浮點畫布，Retina 螢幕上 4 倍取樣非常耗頻寬 */
  msaaSamples: number;
  /**
   * 自訂的全螢幕效果（依順序套用），每一項可以是：
   * - 效果名稱：shaders.defineEffect 註冊的，或內建的 EffectPresets（chromaticAberration、rainOnWindow、pixelate…，會自動註冊）
   * - { graph: 'shaders/crt.shader.json' }：著色器編輯器做的全螢幕效果，自動載入；開發時存檔後立刻更新
   * 物件寫法還可以加 uniforms（每幀寫入，隨時可以改）、stage（預設 display）、enabled: false（暫時關閉）。
   * 載入中的效果先不套用，載入完成後自動加進來
   */
  effects: PostFxEffect[];
}

/** 後製設定裡的一個自訂效果（見 PostFxSettings.effects） */
export type PostFxEffect =
  | string
  | {
      /** 效果名稱（已註冊的、EffectPresets 的）；有 graph 時是註冊用的名稱（省略時用檔名） */
      name?: string;
      /** 著色器編輯器的全螢幕效果節點圖檔（相對於 public，例如 'shaders/crt.shader.json'） */
      graph?: string;
      /** uniform 的值（每幀寫入）：數字、布林、顏色（'#ff0000'）、向量（[x, y]） */
      uniforms?: Record<string, unknown>;
      /** 放在哪個階段：display（預設，色調映射之後、畫面上的顏色）或 scene（之前，線性、高動態範圍） */
      stage?: PassStage;
      /** false：暫時不套用 */
      enabled?: boolean;
    };

const log = createLogger('postfx');

/** 節點圖網址整理成相對於 public 的寫法（shaders/crt.shader.json） */
const normalizeUrl = (url: string) => url.replace(/^\.?\//, '');

/** 安裝中的後製外掛（開發時節點圖存檔後通知它們重新載入） */
const installed = new Set<PostProcessingPlugin>();
if (import.meta.hot) {
  import.meta.hot.on('hero:file-changed', (data: { path: string }) => {
    if (data.path.endsWith('.shader.json')) for (const p of installed) p.reloadGraph(data.path);
  });
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

export function defaultPostFxSettings(): PostFxSettings {
  return {
    toneMapping: 'aces',
    exposure: 1,
    bloom: { enabled: false, strength: 0.6, radius: 0.4, threshold: 0.85 },
    ao: { enabled: false, radius: 0.5, intensity: 1 },
    dof: { enabled: false, focus: 10, aperture: 0.002, maxBlur: 0.01, focusOn: null },
    film: { enabled: false, intensity: 0.35, grayscale: false },
    vignette: { enabled: false, offset: 1, darkness: 1.1 },
    color: { enabled: false, brightness: 0, contrast: 1, saturation: 1, tint: 0xffffff },
    antialias: 'auto',
    msaaSamples: 4,
    effects: [],
  };
}

const TONE_MAPPING: Record<ToneMappingName, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

/** 自訂效果放在哪個階段：scene 為色調映射前（線性、高動態範圍），display 為之後（最終顏色） */
export type PassStage = 'scene' | 'display';

/** 一條建好的後製管線（效果組合改變時重建；數值每幀寫進 uniform） */
interface Chain {
  signature: string;
  pipeline: RenderPipeline;
  scenePass: ShaderNode;
  bloom: ShaderNode | null;
  ao: ShaderNode | null;
  /** 這條管線自己的 uniform */
  u: Record<'aoIntensity' | 'focus' | 'focalLength' | 'bokeh' | 'filmIntensity' | 'filmGray', ShaderNode>;
  grade: CustomEffect | null;
  /** settings.effects 建立的效果：第幾項 → 效果 */
  effects: { index: number; pass: CustomEffect }[];
  /** 釋放管線時要一起釋放的節點 */
  owned: { dispose?: () => void }[];
  /** 色調映射前的中間貼圖（效果之間的顏色先畫成貼圖）：解析度跟著 3D 畫面 */
  sceneTextures: ShaderNode[];
}

/** 環境光遮蔽的解析度（相對於 3D 畫面）：遮蔽是柔和的明暗，一半解析度看不出差別，成本只有四分之一 */
const AO_RESOLUTION = 0.5;

// biome-ignore lint/suspicious/noExplicitAny: mixin 的建構子參數必須是 any[]
type EffectNodeClass = new (...args: any[]) => ShaderNode;

/**
 * three.js 的效果節點（環境光遮蔽 GTAO、景深）被重新 setup 時（例如同一個效果在不同的繪製層級畫），
 * 每次都重新產生它們內部的著色器（還會產生新的 uniform 名稱）並標記材質要更新；
 * Safari（WebGL 2）因此要重新編譯（一次幾百毫秒，畫面會頓一下）。
 * 這裡第一次 setup 之後，沿用已經編譯好的材質：新產生的著色器設定在用完即丟的材質上
 */
function stableSetup<T extends EffectNodeClass>(Base: T): T {
  return class extends Base {
    private setUpOnce = false;

    setup(builder: unknown): unknown {
      if (!this.setUpOnce) {
        this.setUpOnce = true;
        return super.setup(builder);
      }
      const self = this as unknown as Record<string, unknown>;
      const keep: [string, unknown][] = [];
      for (const key of Object.keys(self))
        if (key.endsWith('Material') && self[key] instanceof NodeMaterial) {
          keep.push([key, self[key]]);
          self[key] = new NodeMaterial();
        }
      try {
        return super.setup(builder);
      } finally {
        for (const [key, material] of keep) {
          (self[key] as NodeMaterial).dispose();
          self[key] = material;
        }
      }
    }
  };
}

/** 環境光遮蔽（重新 setup 時沿用已經編譯好的材質，見 stableSetup） */
const StableGTAONode = stableSetup(GTAONode as unknown as EffectNodeClass);
/** 景深（重新 setup 時沿用已經編譯好的材質，見 stableSetup） */
const StableDepthOfFieldNode = stableSetup(DepthOfFieldNode as unknown as EffectNodeClass);

/** 保留幾條用過的管線（切換回來時不用重建） */
const MAX_CACHED_CHAINS = 6;
/** 放到一旁、預先編譯時的解析度（只是為了編譯著色器、縮小緩衝區） */
const TINY_SCALE = 0.1;

/** 合併設定：每一組效果的欄位各自合併 */
function mergeSettings(base: PostFxSettings, settings: DeepPartial<PostFxSettings>): PostFxSettings {
  return {
    ...base,
    ...settings,
    bloom: { ...base.bloom, ...settings.bloom },
    ao: { ...base.ao, ...settings.ao },
    dof: { ...base.dof, ...settings.dof },
    film: { ...base.film, ...settings.film },
    vignette: { ...base.vignette, ...settings.vignette },
    color: { ...base.color, ...settings.color },
    effects: [...((settings.effects as PostFxEffect[] | undefined) ?? base.effects)],
  } as PostFxSettings;
}

/** 釋放一條管線 */
function releaseChain(c: Chain): void {
  for (const node of c.owned) node.dispose?.();
  c.pipeline.dispose();
}

/** 景深模糊大小的基準畫面高度（像素）：maxBlur 在這個高度時，模糊半徑是 maxBlur × 100 像素 */
const DOF_REFERENCE_HEIGHT = 500;

const _pos = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/**
 * 後製外掛：光暈、環境光遮蔽、景深、底片顆粒、暗角、調色、反鋸齒、色調映射。
 * 需先安裝 RenderPlugin。設定可以在執行中隨時修改，下一幀生效。
 *
 * 全部效果都關閉時直接繪製，不會有額外成本。
 */
export class PostProcessingPlugin implements Plugin {
  readonly name = 'postfx';
  readonly dependencies = ['render'] as const;
  /** 目前的後製設定（直接修改欄位即可，例如 settings.bloom.enabled = false） */
  readonly settings: PostFxSettings;
  private render: RenderPlugin | null = null;
  private world: World | null = null;
  private chain: Chain | null = null;
  /**
   * 用過的管線（識別字串 → 管線）：切換回同樣的效果組合時直接用，不用重建。
   * 重建會產生新的著色器程式碼，Safari（WebGL 2）每次都要重新編譯（一次幾百毫秒，畫面會頓一下）。
   * 放回這裡時先縮到很小的解析度，不佔記憶體
   */
  private readonly cache = new Map<string, Chain>();
  /** 等著預先建立的效果組合（每幀在繪製時處理一個） */
  private readonly prewarmQueue: { variant: DeepPartial<PostFxSettings>; done: () => void }[] = [];
  private readonly custom: { pass: PostFxPass; stage: PassStage; id: number }[] = [];
  private nextId = 1;
  private offResize: (() => void) | null = null;
  /** 沒有 ShaderPlugin 時，後製自己的著色器庫 */
  private ownLibrary: ShaderLibrary | null = null;
  /** settings.effects 的節點圖：網址 → 載入狀態與註冊的名稱 */
  private readonly graphs = new Map<string, { status: 'loading' | 'ready' | 'error'; name: string }>();
  /** 已經試過從 EffectPresets 註冊的名稱（找不到的只警告一次） */
  private readonly presetTried = new Set<string>();
  /** 取消登記場景設定 */
  private offSettings: () => void = () => {};

  /**
   * @param settings 一開始的後製設定（沒給的用預設值）
   */
  constructor(settings: DeepPartial<PostFxSettings> = {}) {
    this.settings = mergeSettings(defaultPostFxSettings(), settings);
  }

  /**
   * 全螢幕效果用的著色器庫：有安裝 ShaderPlugin 時就是它（和 shaders.defineEffect、shaders.createEffect 同一個），
   * 沒有時是後製自己的。內建的調色（postfx.colorGrade）與 settings.effects 都在這裡註冊
   */
  get shaderLibrary(): ShaderLibrary {
    return this.world?.getResource(ShadersKey) ?? (this.ownLibrary ??= new ShaderLibrary());
  }

  /**
   * 重新載入 settings.effects 裡的節點圖（開發時存檔後自動呼叫）
   * @param url 節點圖檔的網址
   */
  reloadGraph(url: string): void {
    const key = normalizeUrl(url);
    const st = this.graphs.get(key);
    if (!st || st.status === 'loading') return;
    void this.loadGraph(key, st.name);
  }

  /** 目前的效果清單（除錯用），例如 ['render', 'bloom', 'output', 'grade']；直接繪製時為空 */
  get passNames(): string[] {
    if (!this.chain) return [];
    // 識別字串裡有定義的版本（重建用）：顯示時拿掉
    return this.chain.signature
      .split('|')[0]
      .split(',')
      .map((n) => n.replace(/^(fx:\d+:.*|custom\d+|grade):\d+$/, '$1').replace(/^overlay:.*$/, 'overlay'));
  }

  /**
   * 加入自訂效果：shaders.createEffect 建立的效果，或自己實作 PostFxPass（apply 拿到前一個效果的顏色節點，回傳新的）。
   * stage：scene（預設，色調映射之前，線性、高動態範圍）或 display（之後，畫面上的顏色）
   * @param pass 效果（shaders.createEffect 建立的，或自己實作 PostFxPass）
   * @param stage display（預設，色調映射之後）或 scene（之前，線性、高動態範圍）
   */
  addPass(pass: PostFxPass, stage: PassStage = 'scene'): void {
    this.custom.push({ pass, stage, id: this.nextId++ });
  }

  /**
   * 移除自訂效果（不會釋放它，由加入者負責）
   * @param pass 要移除的效果
   */
  removePass(pass: PostFxPass): void {
    const i = this.custom.findIndex((c) => c.pass === pass);
    if (i !== -1) this.custom.splice(i, 1);
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    installed.add(this);
    const render = engine.getPlugin<RenderPlugin>('render')!;
    this.render = render;
    // 介面由後製最後輸出時一起疊上去（省下一次全螢幕的合成）
    render.setDrawHandler((scene, camera, overlay) => this.draw(scene, camera, overlay ?? null), {
      compositesOverlays: true,
    });
    this.offResize = render.onResize(() => {});
    const ecs = engine.getPlugin<EcsPlugin>('ecs');
    if (ecs) {
      this.world = ecs.world;
      ecs.world.setResource(PostFxKey, this);
      this.offSettings = registerSceneSettings(
        ecs.world,
        postfxSettings(() => this.settings, defaultPostFxSettings),
      );
    }
  }

  uninstall(): void {
    installed.delete(this);
    this.offSettings();
    this.offSettings = () => {};
    this.render?.setDrawHandler(null);
    this.offResize?.();
    this.offResize = null;
    this.disposeChain();
    for (const job of this.prewarmQueue.splice(0)) job.done();
    if (this.world?.getResource(PostFxKey) === this) this.world.removeResource(PostFxKey);
    this.render = null;
    this.world = null;
  }

  // ───────── 繪製 ─────────

  /**
   * 繪製一幀（畫到目前的繪製目標）。有後製效果時回傳 'encoded'：已經做過色調映射、轉成 sRGB；
   * 有 overlay 時把介面一起疊上去、直接畫到畫布，回傳 'composited'
   */
  private draw(
    scene: THREE.Scene,
    camera: THREE.Camera,
    overlay: OverlayCompositor | null = null,
  ): 'encoded' | 'composited' | undefined {
    const render = this.render!;
    const renderer = render.renderer as WebGPURenderer;
    const s = this.settings;
    renderer.toneMapping = TONE_MAPPING[s.toneMapping];
    renderer.toneMappingExposure = s.exposure;
    // 預先建立（每幀一個）：畫到和這一幀相同的地方（畫布），接著這一幀的繪製會整個蓋掉
    const job = this.prewarmQueue.shift();
    if (job) {
      try {
        this.prewarmOne(job.variant, scene, camera, overlay);
      } finally {
        job.done();
      }
    }
    const signature = this.signature(camera, overlay);
    if (signature === null) {
      // 沒有任何效果：直接繪製（色調映射由繪製器處理）
      if (this.chain) this.park(this.chain);
      this.chain = null;
      renderer.toneMapping = TONE_MAPPING[s.toneMapping];
      renderer.render(scene, camera);
      return undefined;
    }
    if (this.chain?.signature !== signature) {
      if (this.chain) this.park(this.chain);
      const cached = this.cache.get(signature);
      this.cache.delete(signature);
      this.chain = cached ?? this.build(signature, scene, camera, overlay);
      renderer.toneMapping = TONE_MAPPING[s.toneMapping];
    }
    const c = this.chain!;
    this.update(camera);
    // 動態解析度：3D 場景的解析度比例（介面維持完整解析度）
    const scale = render.pixelRatio / Math.max(renderer.getPixelRatio(), 1e-6);
    c.scenePass.setResolutionScale(scale);
    // 環境光遮蔽：three.js 的 GTAO 依畫布大小配置（不跟著 3D 畫面的解析度），這裡自己跟著，再減半
    if (c.ao) c.ao.resolutionScale = AO_RESOLUTION * scale;
    for (const t of c.sceneTextures) t.setResolutionScale(scale);
    c.pipeline.render();
    // 介面：有 overlay 時已經在管線最後疊上去；沒有時由 RenderPlugin 最後疊上去（不受色調映射、後製影響）
    return overlay ? 'composited' : 'encoded';
  }

  /** 實際使用的反鋸齒方式（auto 依像素比決定） */
  get resolvedAntialias(): Exclude<AntialiasMode, 'auto'> {
    const mode = this.settings.antialias;
    const pr = this.render?.pixelRatio ?? 1;
    const resolved = mode === 'auto' ? (pr <= 1.25 ? 'msaa' : 'fxaa') : mode;
    // 環境光遮蔽要讀深度貼圖：多重取樣（MSAA）的深度貼圖不能讀，改用 FXAA
    return resolved === 'msaa' && this.settings.ao.enabled ? 'fxaa' : resolved;
  }

  /** 效果組合的識別字串；組合改變時才重建管線。沒有任何效果時回傳 null */
  private signature(camera: THREE.Camera, overlay: OverlayCompositor | null = null): string | null {
    const s = { ...this.settings, antialias: this.resolvedAntialias };
    const lib = this.shaderLibrary;
    const names = ['render'];
    if (s.ao.enabled) names.push('ao');
    if (s.dof.enabled) names.push('dof');
    if (s.bloom.enabled) names.push('bloom');
    const effects = this.readyEffects();
    const fx = (e: { index: number; name: string }) => `fx:${e.index}:${e.name}:${lib.version(e.name)}`;
    const custom = (c: { id: number; pass: PostFxPass }) => `custom${c.id}:${c.pass.version ?? 0}`;
    for (const e of effects) if (e.stage === 'scene') names.push(fx(e));
    for (const c of this.custom) if (c.stage === 'scene' && c.pass.enabled !== false) names.push(custom(c));
    names.push('output');
    if (s.film.enabled) names.push('film');
    if (s.color.enabled || s.vignette.enabled) {
      if (!lib.has(ColorGradeEffect.name)) lib.defineEffect(ColorGradeEffect);
      names.push(`grade:${lib.version(ColorGradeEffect.name)}`);
    }
    for (const e of effects) if (e.stage === 'display') names.push(fx(e));
    for (const c of this.custom) if (c.stage === 'display' && c.pass.enabled !== false) names.push(custom(c));
    if (s.antialias === 'fxaa') names.push('fxaa');
    if (s.antialias === 'smaa') names.push('smaa');
    // 只有 render + output（以及 msaa / 無反鋸齒）等同直接繪製；要疊介面時還是用管線（介面在最後一起輸出）
    if (names.length === 2 && !overlay) return null;
    if (overlay) names.push(`overlay:${overlay.key}`);
    const msaa = s.antialias === 'msaa' ? `msaa${s.msaaSamples}` : 'single';
    return `${names.join(',')}|${msaa}|${s.toneMapping}|${camera.uuid}`;
  }

  private build(
    signature: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    overlay: OverlayCompositor | null = null,
  ): Chain {
    const render = this.render!;
    const renderer = render.renderer as WebGPURenderer;
    const s = { ...this.settings, antialias: this.resolvedAntialias };
    const { pass, renderOutput, rtt, uniform } = tsl;
    const { vec4, mix, dot, vec3, float } = tsl;
    const owned: { dispose?: () => void }[] = [];
    const u = {
      aoIntensity: uniform(s.ao.intensity),
      focus: uniform(s.dof.focus),
      focalLength: uniform(0),
      bokeh: uniform(0),
      filmIntensity: uniform(s.film.intensity),
      filmGray: uniform(s.film.grayscale ? 1 : 0),
    };
    const names = signature.split('|')[0].split(',');
    const samples = s.antialias === 'msaa' ? Math.max(0, Math.round(s.msaaSamples)) : 0;
    const scenePass = pass(scene, camera, { samples });
    owned.push(scenePass);
    // 環境光遮蔽的法線由深度重建（不另外輸出法線）：半透明的東西（沙塵、煙霧粒子）不寫深度，
    // 如果也輸出法線，它們會蓋掉後面物體的法線，畫面出現一塊塊奇怪的圓形陰影
    let color: ShaderNode = scenePass.getTextureNode('output');
    const chain: Chain = {
      signature,
      pipeline: new RenderPipeline(renderer),
      scenePass,
      bloom: null,
      ao: null,
      u,
      grade: null,
      effects: [],
      owned,
      sceneTextures: [],
    };

    // 色調映射前的效果要讀「前一步的顏色」時，先畫成貼圖：解析度跟著 3D 畫面（動態解析度）。
    // 不這樣做的話 three.js 會自動用整個畫布大小的貼圖，後面的效果（景深、光暈…）都以完整解析度跑
    let beforeOutput = true;
    const sceneTexture = (n: ShaderNode): ShaderNode => {
      if (!beforeOutput || n.isTextureNode || n.isSampleNode) return n;
      const t = rtt(n);
      chain.sceneTextures.push(t);
      owned.push(t);
      return t;
    };

    for (const name of names.slice(1)) {
      if (name === 'dof' || name === 'bloom' || name.startsWith('fx:') || name.startsWith('custom'))
        color = sceneTexture(color);
      if (name === 'ao') {
        const aoNode = new StableGTAONode(scenePass.getTextureNode('depth'), null, camera) as ShaderNode;
        aoNode.radius.value = s.ao.radius;
        chain.ao = aoNode;
        owned.push(aoNode);
        const occlusion = (aoNode as ShaderNode).getTextureNode().r;
        color = vec4(color.rgb.mul(mix(float(1), occlusion, u.aoIntensity)), color.a);
      } else if (name === 'dof') {
        const node = new StableDepthOfFieldNode(
          tsl.convertToTexture(color),
          scenePass.getViewZNode(),
          u.focus,
          u.focalLength,
          u.bokeh,
        ) as ShaderNode;
        owned.push(node as ShaderNode);
        color = node;
      } else if (name === 'bloom') {
        const node = bloom(color, s.bloom.strength, s.bloom.radius, s.bloom.threshold);
        chain.bloom = node;
        owned.push(node);
        color = color.add(node);
      } else if (name === 'output') {
        // 色調映射、轉成 sRGB：之後的效果處理的是畫面上的顏色
        color = renderOutput(color);
        beforeOutput = false;
      } else if (name === 'film') {
        const node = film(color, u.filmIntensity);
        const rgb = (node as ShaderNode).rgb;
        color = vec4(mix(rgb, vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722))), u.filmGray), color.a);
      } else if (name.startsWith('grade:')) {
        const lib = this.shaderLibrary;
        if (!lib.has(ColorGradeEffect.name)) lib.defineEffect(ColorGradeEffect);
        chain.grade = lib.createEffect(ColorGradeEffect.name);
        color = chain.grade.apply(color);
      } else if (name === 'fxaa') {
        color = fxaa(color);
      } else if (name === 'smaa') {
        color = smaa(color);
      } else if (name.startsWith('fx:')) {
        // settings.effects：fx:<第幾項>:<註冊的名稱>:<版本>
        const [, index, registered] = /^fx:(\d+):(.*):\d+$/.exec(name)!;
        const effect = this.shaderLibrary.createEffect(registered);
        chain.effects.push({ index: Number(index), pass: effect });
        color = effect.apply(color);
      } else if (name.startsWith('overlay:') && overlay) {
        // 介面（最後一步：反鋸齒之後，介面不會被模糊）
        color = overlay.composite(color);
      } else if (name.startsWith('custom')) {
        const id = Number(/^custom(\d+):/.exec(name)![1]);
        const custom = this.custom.find((c) => c.id === id);
        if (custom) color = custom.pass.apply(color);
      }
    }

    chain.pipeline.outputNode = color;
    // 色調映射與顏色轉換已經在 renderOutput 做過了
    chain.pipeline.outputColorTransform = false;
    return chain;
  }

  /** 每幀把設定值寫進效果 */
  private update(camera: THREE.Camera, c: Chain = this.chain!): void {
    const s = this.settings;
    if (c.bloom) {
      c.bloom.strength.value = s.bloom.strength;
      c.bloom.radius.value = s.bloom.radius;
      c.bloom.threshold.value = s.bloom.threshold;
    }
    if (c.ao) c.ao.radius.value = s.ao.radius;
    c.u.aoIntensity.value = s.ao.intensity;
    c.u.focus.value = this.focusDistance(camera);
    // 舊的景深參數換算：aperture 越大越快變模糊（多遠完全模糊，世界單位）、maxBlur 是模糊程度
    c.u.focalLength.value = 0.02 / Math.max(s.dof.aperture, 1e-5);
    // three.js 景深的模糊半徑是「像素」：依實際繪製的高度換算，畫面多大、像素比多少看起來都一樣
    // （以 500 像素高為基準；否則 2 倍像素比的螢幕、全螢幕時模糊只剩一半以下，幾乎看不出來）
    const heightPx = (this.render?.size.height ?? DOF_REFERENCE_HEIGHT) * (this.render?.pixelRatio ?? 1);
    c.u.bokeh.value = s.dof.maxBlur * 100 * (heightPx / DOF_REFERENCE_HEIGHT);
    c.u.filmIntensity.value = s.film.intensity;
    c.u.filmGray.value = s.film.grayscale ? 1 : 0;
    if (c.grade) {
      const u = c.grade.uniforms;
      u.gradeEnabled.value = s.color.enabled ? 1 : 0;
      u.brightness.value = s.color.brightness;
      u.contrast.value = s.color.contrast;
      u.saturation.value = s.color.saturation;
      (u.tint.value as THREE.Color).set(s.color.tint);
      u.vignetteEnabled.value = s.vignette.enabled ? 1 : 0;
      u.vignetteOffset.value = s.vignette.offset;
      u.vignetteDarkness.value = s.vignette.darkness;
    }
    for (const { index, pass } of c.effects) {
      const e = s.effects[index];
      if (e && typeof e === 'object' && e.uniforms) setUniforms(pass, e.uniforms);
    }
  }

  /** 釋放目前的管線與所有保留的管線 */
  private disposeChain(): void {
    if (this.chain) releaseChain(this.chain);
    this.chain = null;
    for (const c of this.cache.values()) releaseChain(c);
    this.cache.clear();
  }

  /** 管線先放到一旁（之後切換回這個組合時直接用）：縮到很小的解析度；保留太多時釋放最久沒用的 */
  private park(c: Chain, shrink = true): void {
    if (shrink) this.renderTiny(c);
    this.cache.delete(c.signature);
    this.cache.set(c.signature, c);
    while (this.cache.size > MAX_CACHED_CHAINS) {
      const [key, old] = this.cache.entries().next().value as [string, Chain];
      this.cache.delete(key);
      releaseChain(old);
    }
  }

  /**
   * 以很小的 3D 解析度畫一次，把管線的緩衝區縮小（放到一旁時）。
   * 畫到目前的繪製目標（在繪製中呼叫：這一幀接著畫的畫面會整個蓋掉）：和實際繪製相同的條件，不會多編譯著色器
   */
  private renderTiny(c: Chain): void {
    const renderer = this.render!.renderer as WebGPURenderer;
    const toneMapping = renderer.toneMapping;
    // 色調映射的方式寫在識別字串裡（和建立時一樣，才不會產生不同的著色器）
    const name = c.signature.split('|')[2] as ToneMappingName;
    if (name in TONE_MAPPING) renderer.toneMapping = TONE_MAPPING[name];
    try {
      c.scenePass.setResolutionScale(TINY_SCALE);
      for (const t of c.sceneTextures) t.setResolutionScale(TINY_SCALE);
      if (c.ao) c.ao.resolutionScale = TINY_SCALE;
      c.pipeline.render();
    } finally {
      renderer.toneMapping = toneMapping;
    }
  }

  // ───────── 預先編譯 ─────────

  /**
   * 預先編譯效果組合的著色器。第一次開啟某個組合時（例如切換風格預設）要先編譯著色器，畫面會頓一下；
   * 遊戲載入完成後呼叫，把之後會用到的組合先畫一次（每幀一個，分散成本；畫完立刻被那一幀的畫面蓋掉，看不到）。
   * 每一項是要和目前設定合併的設定（寫法和 settings 一樣）。建好的管線會保留起來，切換到這個組合時直接用
   * （最多保留 6 條，縮到很小的解析度，不佔記憶體）。
   * @param variants 之後會用到的設定組合（各自和目前的設定合併）
   * @example
   * await postfx.prewarm([{ bloom: { enabled: true } }, { dof: { enabled: true }, film: { enabled: true } }]);
   */
  async prewarm(variants: DeepPartial<PostFxSettings>[]): Promise<void> {
    await Promise.all(
      variants.map((variant) => new Promise<void>((done) => this.prewarmQueue.push({ variant, done }))),
    );
  }

  /**
   * 預先建立一個效果組合的管線，畫一次（編譯著色器），放進保留區。
   * 畫到目前的繪製目標（和實際繪製時相同的條件，最後一步的著色器才會共用；3D 場景用很小的解析度）
   */
  private prewarmOne(
    variant: DeepPartial<PostFxSettings>,
    scene: THREE.Scene,
    camera: THREE.Camera,
    overlay: OverlayCompositor | null,
  ): void {
    const renderer = this.render!.renderer as WebGPURenderer;
    const self = this as unknown as { settings: PostFxSettings };
    const saved = this.settings;
    const toneMapping = renderer.toneMapping;
    self.settings = mergeSettings(saved, variant);
    try {
      const signature = this.signature(camera, overlay);
      if (signature === null || signature === this.chain?.signature || this.cache.has(signature)) return;
      const chain = this.build(signature, scene, camera, overlay);
      this.update(camera, chain);
      chain.scenePass.setResolutionScale(TINY_SCALE);
      for (const t of chain.sceneTextures) t.setResolutionScale(TINY_SCALE);
      if (chain.ao) chain.ao.resolutionScale = TINY_SCALE;
      renderer.toneMapping = TONE_MAPPING[this.settings.toneMapping];
      // 畫兩次：有些效果（環境光遮蔽）第一次畫完才決定最終的著色器，第二次才編譯到最後的版本
      chain.pipeline.render();
      chain.pipeline.render();
      this.park(chain, false);
    } finally {
      self.settings = saved;
      renderer.toneMapping = toneMapping;
    }
  }

  // ───────── settings.effects ─────────

  /** settings.effects 裡已經可以用的效果（還在載入的先略過；第一次遇到時開始載入） */
  private readyEffects(): { index: number; name: string; stage: PassStage }[] {
    const out: { index: number; name: string; stage: PassStage }[] = [];
    this.settings.effects.forEach((e, index) => {
      const obj = typeof e === 'string' ? { name: e } : e;
      if (!obj || obj.enabled === false) return;
      const name = obj.graph ? this.graphEffect(obj.graph, obj.name) : obj.name ? this.namedEffect(obj.name) : null;
      if (name) out.push({ index, name, stage: obj.stage === 'scene' ? 'scene' : 'display' });
    });
    return out;
  }

  /** 已註冊的效果名稱；沒有時試著從 EffectPresets 註冊（非同步，完成後管線自動重建） */
  private namedEffect(name: string): string | null {
    const lib = this.shaderLibrary;
    if (lib.has(name)) return name;
    if (this.presetTried.has(name)) return null;
    this.presetTried.add(name);
    // 用到時才載入內建效果（沒用的遊戲不會打包進來）
    void import('../shaders/presets').then(({ EffectPresets }) => {
      const make = (EffectPresets as Record<string, (() => Parameters<ShaderLibrary['defineEffect']>[0]) | undefined>)[
        name
      ];
      if (!make) {
        log.warn(
          `找不到效果「${name}」：先用 shaders.defineEffect 註冊，或用內建的 ${Object.keys(EffectPresets).join('、')}`,
        );
        return;
      }
      if (!lib.has(name)) lib.defineEffect({ ...make(), name });
    });
    return null;
  }

  /** 節點圖效果註冊的名稱；第一次遇到時開始載入（完成後管線自動重建） */
  private graphEffect(url: string, name?: string): string | null {
    const key = normalizeUrl(url);
    const st = this.graphs.get(key);
    if (st) return st.status === 'ready' ? st.name : null;
    const fileName = key
      .split('/')
      .pop()!
      .replace(/(\.shader)?\.json$/, '');
    void this.loadGraph(key, name ?? fileName);
    return null;
  }

  private async loadGraph(url: string, name: string): Promise<void> {
    const prev = this.graphs.get(url);
    this.graphs.set(url, { status: 'loading', name });
    try {
      // 節點圖的編譯器很大：用到時才載入
      const { loadShaderGraphEffect } = await import('../shaders/graph/file');
      const def = await loadShaderGraphEffect(url, name);
      const lib = this.shaderLibrary;
      if (lib.has(name)) lib.update(name, def);
      else lib.defineEffect(def);
      this.graphs.set(url, { status: 'ready', name });
      // 重新載入：重建管線，效果用新的貼圖、uniform 預設值重新建立
      if (prev?.status === 'ready') this.disposeChain();
    } catch (error) {
      this.graphs.set(url, { status: 'error', name });
      log.warn(`後製效果 ${url} 載入失敗：${(error as Error).message}`);
    }
  }

  /** 景深對焦距離：有 focusOn 時為攝影機到該實體的距離 */
  private focusDistance(camera: THREE.Camera): number {
    const s = this.settings.dof;
    const t = s.focusOn !== null ? this.world?.get(s.focusOn, Transform) : undefined;
    if (!t) return s.focus;
    _pos.setFromMatrixPosition(t.worldMatrix);
    // 管線在這之後才繪製：先更新攝影機的世界矩陣（第一幀還沒更新過）
    camera.updateMatrixWorld();
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    return _pos.distanceTo(_camPos);
  }
}

/** 把設定裡的 uniform 值寫進效果（顏色可以是文字、數字；向量可以是陣列） */
function setUniforms(pass: CustomEffect, values: Record<string, unknown>): void {
  const u = pass.uniforms as Record<string, { value: unknown }>;
  for (const [key, value] of Object.entries(values)) {
    const target = u[key];
    if (!target) continue;
    const cur = target.value as {
      isColor?: boolean;
      set?: (...a: unknown[]) => void;
      fromArray?: (a: number[]) => void;
    };
    if (cur?.isColor && (typeof value === 'string' || typeof value === 'number')) cur.set!(value);
    else if (Array.isArray(value) && cur?.fromArray) cur.fromArray(value as number[]);
    else target.value = value;
  }
}
