/**
 * 編輯器的「正式預覽」：用真正的遊戲引擎（RenderPlugin + UIPlugin）跑目前的介面，
 * 介面由引擎畫在 WebGL 畫面上，背後可以有一個簡單的 3D 場景，和遊戲裡看到的一模一樣。
 */
import * as THREE from 'three';
import { Engine } from '../../core';
import { EcsPlugin, type Entity, type World } from '../../ecs';
import { ScenePlugin, Transform } from '../../scene';
import { lookAt } from '../../scene/Transform';
import { Camera, Light, MeshRenderer, RenderPlugin } from '../../render';
import { PluginManager } from '../../plugins';
import { UIList, UIPlugin, type UI2D, type UIEvent, type UIHandler } from '../../ui2d';

/** 樣板列表放幾筆示範資料，預覽時才看得到（編輯器、引擎預覽共用） */
export function fillTemplateDemo(ui: UI2D): void {
  ui.root?.walk((el) => {
    if (el instanceof UIList && el.template && el.id && el.children.length === 0) {
      ui.setItems(
        el.id,
        Array.from({ length: 6 }, (_, i) => ({
          label: `項目 ${i + 1}`,
          name: `項目 ${i + 1}`,
          count: i + 1,
          icon: 'coin.png',
          iconName: ['sword', 'shield', 'potion', 'gem', 'bolt', 'fire'][i],
          rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'rare'][i],
          desc: '範例物品（編輯器的示範資料）',
        })),
      );
    }
  });
}

export type PreviewBackground = 'scene' | 'solid';

export interface EnginePreviewOptions {
  /** 畫面放在哪個元素裡（尺寸跟著它） */
  container: HTMLElement;
  /** 介面裡圖片等資源的基準路徑 */
  baseUrl?: string;
  /** XML 裡 onClick 等事件被觸發時呼叫（顯示紀錄用） */
  onEvent?: (message: string) => void;
  /** 第三方套件的網址（例如 plugins/my-plugin.js），預覽時一起安裝 */
  pluginUrls?: string[];
}

/** 示範用的 3D 場景：地板、幾個旋轉的方塊、慢慢繞圈的攝影機 */
function buildBackdrop(world: World, engine: Engine): () => void {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T) => {
    if (x instanceof THREE.Material) materials.push(x);
    else geometries.push(x as THREE.BufferGeometry);
    return x;
  };

  const cam = world.spawn(Camera.with({ fov: 55 }), Transform);
  world.spawn(Light.with({ kind: 'hemisphere', color: 0xe8f5d0, groundColor: 0x1d2318, intensity: 1.1 }));
  const sun = world.spawn(
    Light.with({ kind: 'directional', intensity: 2.2, castShadow: true, shadowArea: 16 }),
    Transform,
  );
  const st = world.get(sun, Transform)!;
  st.position.set(5, 8, 4);
  lookAt(st, new THREE.Vector3());

  const ground = world.spawn(
    MeshRenderer.with({
      geometry: track(new THREE.PlaneGeometry(40, 40)),
      material: track(new THREE.MeshStandardMaterial({ color: 0x2b3326, roughness: 0.95 })),
      receiveShadow: true,
    }),
    Transform,
  );
  world.get(ground, Transform)!.rotation.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  const box = track(new THREE.BoxGeometry(1, 1, 1));
  const colors = [0x9acd32, 0x4f9dff, 0xffb347, 0xc3a6ff, 0x7fd6c2];
  const spinners: { e: Entity; speed: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 2.2 + (i % 2) * 1.6;
    const e = world.spawn(
      MeshRenderer.with({
        geometry: box,
        material: track(
          new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.45, metalness: 0.1 }),
        ),
        castShadow: true,
      }),
      Transform,
    );
    const t = world.get(e, Transform)!;
    t.position.set(Math.cos(a) * r, 0.5 + (i % 3) * 0.35, Math.sin(a) * r);
    t.scale.setScalar(0.6 + (i % 3) * 0.25);
    spinners.push({ e, speed: 0.4 + (i % 4) * 0.25 });
  }

  const center = new THREE.Vector3(0, 0.6, 0);
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0.3, 1, 0.2).normalize();
  const off = engine.on('update', (time) => {
    const t = time.elapsed;
    const ct = world.get(cam, Transform);
    if (ct) {
      ct.position.set(Math.cos(t * 0.15) * 8, 3.6, Math.sin(t * 0.15) * 8);
      lookAt(ct, center);
    }
    for (const s of spinners)
      world.get(s.e, Transform)?.rotation.multiply(q.setFromAxisAngle(axis, s.speed * time.delta));
  });
  return () => {
    off();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  };
}

/**
 * 正式預覽。
 * @example
 * const preview = await EnginePreview.open(xml, { container });
 * preview.update(newXml); // 編輯時即時更新
 * preview.close();
 */
export class EnginePreview {
  private constructor(
    readonly engine: Engine,
    readonly ui: UI2D,
    private readonly render: RenderPlugin,
    private readonly plugins: PluginManager,
    private disposeBackdrop: (() => void) | null,
    private readonly options: EnginePreviewOptions,
  ) {}

  static async open(xml: string, options: EnginePreviewOptions): Promise<EnginePreview> {
    const engine = new Engine({ pauseOnHidden: false });
    const ecs = new EcsPlugin();
    const render = new RenderPlugin({
      container: options.container,
      shadows: true,
      background: 0x11150f,
      antialias: true,
    });
    const uiPlugin = await UIPlugin.create({ unknownTags: 'placeholder' });
    engine.use(ecs).use(new ScenePlugin()).use(render).use(uiPlugin);
    // 事件處理函式：預覽裡沒有遊戲程式，所有 onClick 等都記錄下來
    const ui = uiPlugin.ui;
    const proxy = new Proxy({} as Record<string, UIHandler>, {
      get: (_t, name) =>
        typeof name !== 'string' ? undefined : (e: UIEvent) => options.onEvent?.(describeEvent(name, e)),
      has: () => true,
    });
    Object.setPrototypeOf(ui.handlers, proxy);
    // 第三方元件：和遊戲一樣安裝套件，裝不起來就用佔位方塊
    const plugins = new PluginManager(engine);
    for (const url of options.pluginUrls ?? []) {
      try {
        await plugins.installFromUrl(url);
      } catch (error) {
        console.warn('預覽：套件安裝失敗', url, error);
      }
    }
    const preview = new EnginePreview(engine, ui, render, plugins, buildBackdrop(ecs.world, engine), options);
    preview.update(xml);
    engine.start();
    return preview;
  }

  /** 換成新的介面內容（XML 有錯會丟出例外，畫面維持上一版） */
  update(xml: string): void {
    this.ui.loadString(xml, this.options.baseUrl ?? 'ui/');
    fillTemplateDemo(this.ui); // 樣板列表放示範資料（和編輯器一樣）
  }

  /** 背景：3D 場景或純色 */
  setBackground(mode: PreviewBackground): void {
    const scene = this.render.scene;
    for (const child of scene.children) child.visible = mode === 'scene';
    scene.background = new THREE.Color(mode === 'scene' ? 0x11150f : 0x1a1d18);
  }

  /** 目前的 FPS（約略） */
  get fps(): number {
    const d = this.engine.time.realDelta || this.engine.time.unscaledDelta;
    return d > 0 ? 1 / d : 0;
  }

  close(): void {
    this.plugins.uninstallAll();
    this.disposeBackdrop?.();
    this.disposeBackdrop = null;
    this.engine.destroy();
  }
}

function describeEvent(name: string, e: UIEvent): string {
  const target = `${e.target.type}${e.target.id ? `#${e.target.id}` : ''}`;
  const value = e.value !== undefined ? `　值：${JSON.stringify(e.value)}` : '';
  const item = e.item !== undefined ? `　資料：${JSON.stringify(e.item)}` : '';
  return `${name} ← ${target}${value}${item}`;
}
