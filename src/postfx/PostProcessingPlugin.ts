import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import { Transform } from '../scene';
import { ColorGradeShader } from './ColorGradeShader';
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
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
  /** 環境光遮蔽：角落、縫隙變暗，增加立體感（較耗效能） */
  ao: { enabled: boolean; radius: number; intensity: number };
  /** 景深：對焦距離以外變模糊 */
  dof: {
    enabled: boolean;
    /** 對焦距離（世界單位）；設定 focusOn 時會自動計算 */
    focus: number;
    aperture: number;
    maxBlur: number;
    /** 自動對焦到這個實體 */
    focusOn: Entity | null;
  };
  /** 底片顆粒 */
  film: { enabled: boolean; intensity: number; grayscale: boolean };
  /** 暗角：畫面四周變暗 */
  vignette: { enabled: boolean; offset: number; darkness: number };
  /** 調色 */
  color: {
    enabled: boolean;
    brightness: number;
    contrast: number;
    saturation: number;
    tint: THREE.ColorRepresentation;
  };
  /**
   * 反鋸齒：
   * - auto（預設）：像素比 1.25 以下用 msaa，高解析度螢幕用 fxaa
   *   （後製畫布是半精度浮點，Retina 上的 4 倍 MSAA 會把 FPS 從 60 拖到 30）
   * - msaa：多重取樣，品質好；高解析度螢幕上成本很高（見 msaaSamples）
   * - fxaa：最便宜，邊緣略糊
   * - smaa：比 fxaa 銳利
   */
  antialias: AntialiasMode;
  /** MSAA 取樣數（2 或 4，預設 4）。後製用半精度浮點畫布，Retina 螢幕上 4 倍取樣非常耗頻寬 */
  msaaSamples: number;
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

interface Chain {
  signature: string;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass | null;
  dof: BokehPass | null;
  ao: GTAOPass | null;
  aoRadius: number;
  film: FilmPass | null;
  grade: ShaderPass | null;
  fxaa: ShaderPass | null;
  /** 這條管線裡由外掛建立、需要釋放的效果 */
  owned: Pass[];
}

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
  private engine: Engine | null = null;
  private world: World | null = null;
  private chain: Chain | null = null;
  private readonly custom: { pass: Pass; stage: PassStage; id: number }[] = [];
  private nextId = 1;
  private offResize: (() => void) | null = null;
  /** 取消登記場景設定 */
  private offSettings: () => void = () => {};

  constructor(settings: DeepPartial<PostFxSettings> = {}) {
    const d = defaultPostFxSettings();
    this.settings = {
      ...d,
      ...settings,
      bloom: { ...d.bloom, ...settings.bloom },
      ao: { ...d.ao, ...settings.ao },
      dof: { ...d.dof, ...settings.dof },
      film: { ...d.film, ...settings.film },
      vignette: { ...d.vignette, ...settings.vignette },
      color: { ...d.color, ...settings.color },
    } as PostFxSettings;
  }

  /** 目前的效果清單（除錯用），例如 ['render', 'bloom', 'output', 'grade']；直接繪製時為空 */
  get passNames(): string[] {
    return this.chain ? this.chain.signature.split('|')[0].split(',') : [];
  }

  /** 加入自訂效果（例如自己寫的 ShaderPass） */
  addPass(pass: Pass, stage: PassStage = 'scene'): void {
    this.custom.push({ pass, stage, id: this.nextId++ });
  }

  /** 移除自訂效果（不會釋放它，由加入者負責） */
  removePass(pass: Pass): void {
    const i = this.custom.findIndex((c) => c.pass === pass);
    if (i !== -1) this.custom.splice(i, 1);
  }

  install(engine: Engine): void {
    const render = engine.getPlugin<RenderPlugin>('render')!;
    this.render = render;
    this.engine = engine;
    render.setDrawHandler((scene, camera) => this.draw(scene, camera));
    this.offResize = render.onResize((w, h) => this.resize(w, h));
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
    this.offSettings();
    this.offSettings = () => {};
    this.render?.setDrawHandler(null);
    this.offResize?.();
    this.offResize = null;
    this.disposeChain();
    if (this.world?.getResource(PostFxKey) === this) this.world.removeResource(PostFxKey);
    this.render = null;
    this.engine = null;
    this.world = null;
  }

  // ───────── 繪製 ─────────

  private draw(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.render!.renderer;
    const s = this.settings;
    renderer.toneMapping = TONE_MAPPING[s.toneMapping];
    renderer.toneMappingExposure = s.exposure;

    const signature = this.signature(camera);
    if (signature === null) {
      // 沒有任何效果：直接繪製（色調映射由繪製器處理）
      this.disposeChain();
      renderer.render(scene, camera);
      return;
    }
    if (this.chain?.signature !== signature) this.build(signature, scene, camera);
    this.update(camera);
    this.chain!.composer.render(this.engine?.time.delta ?? 1 / 60);
  }

  /** 實際使用的反鋸齒方式（auto 依像素比決定） */
  get resolvedAntialias(): Exclude<AntialiasMode, 'auto'> {
    const mode = this.settings.antialias;
    if (mode !== 'auto') return mode;
    const pr = this.render?.pixelRatio ?? 1;
    return pr <= 1.25 ? 'msaa' : 'fxaa';
  }

  /** 效果組合的識別字串；組合改變時才重建管線。沒有任何效果時回傳 null */
  private signature(camera: THREE.Camera): string | null {
    const s = { ...this.settings, antialias: this.resolvedAntialias };
    const names = ['render'];
    if (s.ao.enabled) names.push('ao');
    if (s.dof.enabled) names.push('dof');
    if (s.bloom.enabled) names.push('bloom');
    for (const c of this.custom) if (c.stage === 'scene') names.push(`custom${c.id}`);
    names.push('output');
    if (s.film.enabled) names.push('film');
    if (s.color.enabled || s.vignette.enabled) names.push('grade');
    for (const c of this.custom) if (c.stage === 'display') names.push(`custom${c.id}`);
    if (s.antialias === 'fxaa') names.push('fxaa');
    if (s.antialias === 'smaa') names.push('smaa');
    // 只有 render + output（以及 msaa / 無反鋸齒）等同直接繪製
    if (names.length === 2) return null;
    return `${names.join(',')}|${s.antialias === 'msaa' ? `msaa${s.msaaSamples}` : 'single'}|${camera.uuid}`;
  }

  private build(signature: string, scene: THREE.Scene, camera: THREE.Camera): void {
    this.disposeChain();
    const render = this.render!;
    const renderer = render.renderer;
    const { width, height } = render.size;
    // 3D 場景的像素比：動態解析度降低時緩衝區變小，最後一個效果畫到畫布時自動放大（介面維持清晰）
    const pixelRatio = render.pixelRatio;
    const s = { ...this.settings, antialias: this.resolvedAntialias };

    const target = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: s.antialias === 'msaa' ? Math.max(0, Math.round(s.msaaSamples)) : 0,
    });
    const composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);

    const owned: Pass[] = [];
    const add = <P extends Pass>(pass: P): P => {
      composer.addPass(pass);
      owned.push(pass);
      return pass;
    };
    const names = signature.split('|')[0].split(',');
    const chain: Chain = {
      signature,
      composer,
      renderPass: add(new RenderPass(scene, camera)),
      bloom: null,
      dof: null,
      ao: null,
      aoRadius: s.ao.radius,
      film: null,
      grade: null,
      fxaa: null,
      owned,
    };

    for (const name of names.slice(1)) {
      switch (name) {
        case 'ao':
          chain.ao = add(new GTAOPass(scene, camera, width, height));
          chain.ao.updateGtaoMaterial({ radius: s.ao.radius });
          break;
        case 'dof':
          chain.dof = add(
            new BokehPass(scene, camera, { focus: s.dof.focus, aperture: s.dof.aperture, maxblur: s.dof.maxBlur }),
          );
          break;
        case 'bloom':
          chain.bloom = add(
            new UnrealBloomPass(new THREE.Vector2(width, height), s.bloom.strength, s.bloom.radius, s.bloom.threshold),
          );
          break;
        case 'output':
          add(new OutputPass());
          break;
        case 'film':
          chain.film = add(new FilmPass(s.film.intensity, s.film.grayscale));
          break;
        case 'grade':
          chain.grade = add(new ShaderPass(ColorGradeShader));
          break;
        case 'fxaa':
          chain.fxaa = add(new ShaderPass(FXAAShader));
          break;
        case 'smaa':
          add(new SMAAPass(width * pixelRatio, height * pixelRatio));
          break;
        default: {
          // 自訂效果：不由外掛釋放
          const custom = this.custom.find((c) => `custom${c.id}` === name);
          if (custom) composer.addPass(custom.pass);
        }
      }
    }
    this.chain = chain;
    this.resize(width, height);
  }

  /** 每幀把設定值寫進效果 */
  private update(camera: THREE.Camera): void {
    const c = this.chain!;
    const s = this.settings;
    c.renderPass.camera = camera;
    if (c.bloom) {
      c.bloom.strength = s.bloom.strength;
      c.bloom.radius = s.bloom.radius;
      c.bloom.threshold = s.bloom.threshold;
    }
    if (c.dof) {
      const u = c.dof.uniforms as Record<string, THREE.IUniform>;
      u.focus.value = this.focusDistance(camera);
      u.aperture.value = s.dof.aperture;
      u.maxblur.value = s.dof.maxBlur;
    }
    if (c.ao) {
      c.ao.blendIntensity = s.ao.intensity;
      if (c.aoRadius !== s.ao.radius) {
        c.aoRadius = s.ao.radius;
        c.ao.updateGtaoMaterial({ radius: s.ao.radius });
      }
    }
    if (c.film) {
      const u = c.film.uniforms as Record<string, THREE.IUniform>;
      u.intensity.value = s.film.intensity;
      u.grayscale.value = s.film.grayscale;
    }
    if (c.grade) {
      const u = c.grade.uniforms as Record<string, THREE.IUniform>;
      u.gradeEnabled.value = s.color.enabled;
      u.brightness.value = s.color.brightness;
      u.contrast.value = s.color.contrast;
      u.saturation.value = s.color.saturation;
      (u.tint.value as THREE.Color).set(s.color.tint);
      u.vignetteEnabled.value = s.vignette.enabled;
      u.vignetteOffset.value = s.vignette.offset;
      u.vignetteDarkness.value = s.vignette.darkness;
    }
  }

  /** 景深對焦距離：有 focusOn 時為攝影機到該實體的距離 */
  private focusDistance(camera: THREE.Camera): number {
    const s = this.settings.dof;
    const t = s.focusOn !== null ? this.world?.get(s.focusOn, Transform) : undefined;
    if (!t) return s.focus;
    _pos.setFromMatrixPosition(t.worldMatrix);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    return _pos.distanceTo(_camPos);
  }

  private resize(width: number, height: number): void {
    const c = this.chain;
    if (!c) return;
    // 像素比可能被動態解析度改過
    c.composer.setPixelRatio(this.render!.pixelRatio);
    c.composer.setSize(width, height);
    if (c.fxaa) {
      const pr = this.render!.pixelRatio;
      ((c.fxaa.uniforms as Record<string, THREE.IUniform>).resolution.value as THREE.Vector2).set(
        1 / (width * pr),
        1 / (height * pr),
      );
    }
  }

  private disposeChain(): void {
    const c = this.chain;
    if (!c) return;
    for (const pass of c.owned) pass.dispose();
    c.composer.dispose();
    this.chain = null;
  }
}
