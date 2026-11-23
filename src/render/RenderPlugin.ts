import * as THREE from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity, World } from '../ecs';
import { AdaptiveResolution, type AdaptiveResolutionOptions } from './AdaptiveResolution';
import { Binding } from './Binding';
import { createCameraSpec, createMeshSpec, lightSpec, sceneObjectSpec } from './bindings';
import { RenderResources, createGeometry, isGeometryDesc } from './descriptors';
import { MeshGeometryKey } from '../scene/keys';
import { registerSceneCodecs, registerSceneSettings } from '../scene/SceneFile';
import { DebugDraw } from './DebugDraw';
import { CameraRig } from './CameraRig';
import { ALL_LAYERS, CameraLayers, CameraViewport, LayerNames, RenderLayer } from './Layers';
import { renderSettings } from './sceneSettings';
import { renderCodecs } from './sceneCodecs';
import { Camera, Light, MeshRenderer } from './components';
import { OrbitController, autoOrbitControl, type OrbitControlData } from './OrbitControls';
import { RenderKey } from './keys';
export { RenderKey } from './keys';

const _origin = new THREE.Vector2(0, 0);

/** 接管繪製的函式 */
export type DrawHandler = (scene: THREE.Scene, camera: THREE.Camera) => void;

/** 射線檢測的結果 */
export interface RaycastHit {
  /** 點到的實體 */
  entity: Entity;
  /** 點到的 three.js 物件 */
  object: THREE.Object3D;
  /** 點到的位置（世界座標） */
  point: THREE.Vector3;
  /** 從攝影機到點到的位置的距離 */
  distance: number;
  /** 打到的面的法線（若有） */
  normal: THREE.Vector3 | null;
  /** 點到的貼圖座標（0～1，左下為 0,0；幾何沒有 uv 時是 null）：例如換算成畫在貼圖上的位置 */
  uv: THREE.Vector2 | null;
}

/** RenderPlugin 的設定 */
export interface RenderOptions {
  /** 畫布放在哪個元素裡，預設 document.body（此時尺寸跟隨視窗） */
  container?: HTMLElement;
  /** 使用既有的畫布 */
  canvas?: HTMLCanvasElement;
  /** 自行提供繪製器（例如 WebGPURenderer 或測試用的替身） */
  renderer?: THREE.WebGLRenderer;
  /** 反鋸齒（預設 true） */
  antialias?: boolean;
  /** 預設為裝置像素比，最高 2 */
  pixelRatio?: number;
  /** 背景顏色，null 為透明 */
  background?: THREE.ColorRepresentation | null;
  /** 啟用陰影 */
  shadows?: boolean;
  /**
   * 動態解析度：畫面跟不上目標 FPS 時自動降低繪製解析度，流暢時再慢慢調回來。
   * true 為目標 60 FPS；也可以傳設定。
   * 只降低 3D 場景的解析度（畫在較小的緩衝區再放大到畫布）；畫布本身維持原本的像素比，
   * 介面（UI2D 等疊加圖層）照樣以完整解析度繪製，文字維持清晰。
   */
  adaptiveResolution?: boolean | AdaptiveResolutionOptions;
  /** 固定尺寸；不給則自動跟隨容器 */
  size?: { width: number; height: number };
  /**
   * 攝影機繞轉控制：自動在目前的攝影機加上 OrbitControl（滑鼠拖曳轉動、滾輪縮放、右鍵平移）。
   * 使用者第一次操作前不會動攝影機。true 用預設設定；也可以傳設定（例如 { target, maxDistance }）。
   */
  orbitControls?: boolean | Partial<OrbitControlData>;
}

/** 控制攝影機的系統在 lateUpdate 的優先度（遊戲的 lateUpdate 系統預設 0，會先執行） */
export const ORBIT_CONTROL_PRIORITY = 900;

/** 同步 three.js 物件的優先度（使用者的 render 階段系統預設 0，會先執行） */
export const RENDER_SYNC_PRIORITY = 900;
/** 實際繪製的優先度 */
export const RENDER_DRAW_PRIORITY = 1000;
/** 攝影機跟隨的順序（lateUpdate：繞轉控制之後、Transform 系統之前） */
export const CAMERA_FOLLOW_PRIORITY = 950;
/** 攝影機晃動的順序（render：攝影機同步之後、繪製之前） */
export const CAMERA_SHAKE_PRIORITY = 950;

/**
 * 繪製外掛：把 ECS 中的網格、攝影機、燈光、任意物件同步到 three.js 並繪製。
 * 需先安裝 EcsPlugin 與 ScenePlugin。
 */
export class RenderPlugin implements Plugin {
  readonly name = 'render';
  readonly dependencies = ['ecs', 'scene'] as const;

  /** three.js 場景（扁平結構，位置由 Transform 決定） */
  readonly scene = new THREE.Scene();
  /** 除錯繪製：debug.line／ray／box／sphere／point／path（畫在畫面上，不是場景的一部分） */
  readonly debug = new DebugDraw();
  /** 繪製圖層的名稱與編號（RenderLayer、CameraLayers 用名字，這裡換成 three.js 的編號） */
  readonly layers = new LayerNames();
  /** 移除 RenderLayer 時要恢復成 default 的實體 */
  private readonly layerReset = new Set<Entity>();
  private offLayerHook: () => void = () => {};

  private _renderer: THREE.WebGLRenderer | null = null;
  private ownsRenderer = false;
  private appendedCanvas = false;
  /** 取消登記場景檔存讀規則 */
  private offCodecs: () => void = () => {};
  private world: World | null = null;
  private ecs: EcsPlugin | null = null;
  private width = 1;
  private height = 1;
  private _activeCamera: Entity | null = null;
  private cleanupResize: (() => void) | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private drawHandler: DrawHandler | null = null;
  private adaptive: AdaptiveResolution | null = null;
  /** MeshRenderer 用描述建立的幾何、材質（共用、自動釋放） */
  readonly resources = new RenderResources();
  /** 3D 場景的解析度比例（動態解析度調整；1 = 和畫布一樣） */
  private _scale = 1;
  /** 降低解析度時，3D 場景先畫在這裡再放大到畫布 */
  private lowRes: {
    texture: THREE.FramebufferTexture;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    material: THREE.ShaderMaterial;
  } | null = null;
  private engine: Engine | null = null;
  private readonly overlays: { scene: THREE.Scene; camera: THREE.Camera; order: number }[] = [];
  private readonly beforeDrawListeners = new Set<() => void>();
  private readonly resizeListeners = new Set<(width: number, height: number) => void>();

  private meshes: Binding<unknown, THREE.Mesh> | null = null;
  private cameras: Binding<unknown, THREE.PerspectiveCamera | THREE.OrthographicCamera> | null = null;
  private cameraRig: CameraRig | null = null;
  private lights: Binding<unknown, THREE.Light> | null = null;
  private objects: Binding<unknown, THREE.Object3D> | null = null;

  /**
   * 所有 RenderPlugin 的預設選項（建構時的選項優先）。
   * 例如使用手冊的範例環境設定 RenderPlugin.defaults.orbitControls = { wheelNeedsFocus: true }，所有範例都能轉動攝影機。
   */
  static defaults: Partial<RenderOptions> = {};

  private readonly options: RenderOptions;
  private orbit: OrbitController | null = null;

  constructor(options: RenderOptions = {}) {
    this.options = { ...RenderPlugin.defaults, ...options };
  }

  /** three.js 繪製器（進階用途） */
  get renderer(): THREE.WebGLRenderer {
    if (!this._renderer) throw new Error('RenderPlugin 尚未安裝');
    return this._renderer;
  }

  /** 畫布的大小（CSS 像素） */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** 畫面的寬高比 */
  get aspect(): number {
    return this.width / Math.max(this.height, 1);
  }

  /** 目前負責繪製的攝影機實體 */
  get activeCamera(): Entity | null {
    return this._activeCamera;
  }

  /** 取得實體對應的 three.js 物件（例如要直接操作材質或做點選） */
  getObject(e: Entity, kind: 'mesh' | 'camera' | 'light' | 'object' = 'mesh'): THREE.Object3D | undefined {
    const binding = { mesh: this.meshes, camera: this.cameras, light: this.lights, object: this.objects }[kind];
    return binding?.get(e);
  }

  /** 讓有 CameraFollow 的攝影機下一幀直接跳到跟隨位置（傳送、切換場景之後，不要慢慢滑過去） */
  snapCamera(camera: Entity): void {
    this.cameraRig?.snap(camera);
  }

  /** 由 three.js 物件反查實體（點選用） */
  entityOf(object: THREE.Object3D | null): Entity | null {
    for (let o = object; o; o = o.parent) {
      if (o.userData.entity !== undefined) return o.userData.entity as Entity;
    }
    return null;
  }

  /**
   * 從畫面座標發出射線，回傳所有打到的實體（由近到遠）。
   * ndcX、ndcY 為 -1~1（可直接用 input.pointer.ndcX / ndcY）。
   * 使用上一次繪製時的位置，也就是玩家眼睛看到的畫面。
   */
  raycast(ndcX: number, ndcY: number, filter?: (hit: RaycastHit) => boolean): RaycastHit[] {
    const camera = this._activeCamera !== null ? this.cameras?.get(this._activeCamera) : undefined;
    if (!camera) return [];
    this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), camera);
    this.raycaster.layers.mask = camera.layers.mask; // 只選得到這台攝影機看得到的圖層
    const hits: RaycastHit[] = [];
    for (const i of this.raycaster.intersectObjects(this.scene.children, true)) {
      const entity = this.entityOf(i.object);
      if (entity === null) continue;
      const hit: RaycastHit = {
        entity,
        object: i.object,
        point: i.point,
        distance: i.distance,
        normal: i.face ? i.face.normal.clone().transformDirection(i.object.matrixWorld) : null,
        uv: i.uv ? i.uv.clone() : null,
      };
      if (!filter || filter(hit)) hits.push(hit);
    }
    return hits;
  }

  /** 點選：回傳最近的一個實體 */
  pick(ndcX: number, ndcY: number, filter?: (hit: RaycastHit) => boolean): RaycastHit | null {
    return this.raycast(ndcX, ndcY, filter)[0] ?? null;
  }

  /** 設定畫布大小（固定尺寸時用；預設跟著容器） */
  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this._renderer?.setSize(this.width, this.height);
    for (const listener of [...this.resizeListeners]) listener(this.width, this.height);
    // 改尺寸會清空畫布：立刻補畫一次（遊戲暫停時畫面才不會變黑）
    if (this.cameras) this.draw();
  }

  /**
   * 每次畫面繪製前呼叫（3D 畫面與介面之前）。例如更新要給 3D 物件用的貼圖：
   * 在這裡更新，同一幀就看得到。回傳取消監聽的函式。
   */
  onBeforeDraw(listener: () => void): () => void {
    this.beforeDrawListeners.add(listener);
    return () => this.beforeDrawListeners.delete(listener);
  }

  /** 監聽畫面尺寸改變（CSS 像素） */
  onResize(listener: (width: number, height: number) => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  /**
   * 接管實際繪製（例如後製外掛）。傳 null 恢復成直接繪製。
   * 同時只能有一個接管者。
   */
  setDrawHandler(handler: DrawHandler | null): void {
    if (handler && this.drawHandler && handler !== this.drawHandler) {
      throw new Error('已經有其他外掛接管繪製');
    }
    this.drawHandler = handler;
  }

  /**
   * 疊加圖層：在 3D 畫面（含後製）之後繪製，例如 2D 介面。
   * order 小的先畫。回傳移除函式。
   */
  addOverlay(scene: THREE.Scene, camera: THREE.Camera, order = 0): () => void {
    const entry = { scene, camera, order };
    this.overlays.push(entry);
    this.overlays.sort((a, b) => a.order - b.order);
    return () => {
      const i = this.overlays.indexOf(entry);
      if (i !== -1) this.overlays.splice(i, 1);
    };
  }

  /** 3D 場景的繪製像素比（動態解析度會調整它；後製用它配置緩衝區） */
  get pixelRatio(): number {
    return (this._renderer?.getPixelRatio() ?? 1) * this._scale;
  }

  /** 畫布的像素比（固定；介面等疊加圖層用這個解析度繪製） */
  get canvasPixelRatio(): number {
    return this._renderer?.getPixelRatio() ?? 1;
  }

  /** 3D 場景相對於畫布的解析度比例（1 = 一樣清晰） */
  get renderScale(): number {
    return this._scale;
  }

  /** 動態解析度（沒有開啟時為 null） */
  get adaptiveResolution(): AdaptiveResolution | null {
    return this.adaptive;
  }

  private adaptResolution(realDelta: number): void {
    const ratio = this.adaptive?.update(realDelta);
    if (ratio === null || ratio === undefined || !this._renderer) return;
    // 畫布不變，只改 3D 場景的解析度比例（介面維持清晰）
    this._scale = Math.min(1, ratio / this._renderer.getPixelRatio());
    for (const listener of [...this.resizeListeners]) listener(this.width, this.height); // 通知後製重新配置緩衝區
  }

  /**
   * 直接繪製（沒有後製）且解析度降低時：
   * 先把 3D 場景畫在畫布左下角較小的範圍，複製成貼圖，再放大鋪滿整個畫布。
   * 畫在畫布本身（不是另外的緩衝區），色調映射、顏色轉換、半透明疊加、反鋸齒都和正常繪製完全一樣，只有解析度不同。
   */
  private drawLowRes(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const pr = renderer.getPixelRatio();
    const sw = Math.max(1, Math.round(this.width * this.pixelRatio));
    const sh = Math.max(1, Math.round(this.height * this.pixelRatio));
    if (!this.lowRes || this.lowRes.texture.image.width !== sw || this.lowRes.texture.image.height !== sh) {
      this.disposeLowRes();
      const texture = new THREE.FramebufferTexture(sw, sh);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      // 複製出來的像素已經是最後的顏色：原樣輸出，不再做色調映射或顏色轉換
      const material = new THREE.ShaderMaterial({
        uniforms: { map: { value: texture } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }',
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      quad.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(quad);
      this.lowRes = { texture, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material };
    }
    const lr = this.lowRes;
    // setViewport 的單位是 CSS 像素（會乘上像素比）
    renderer.setViewport(0, 0, sw / pr, sh / pr);
    renderer.render(this.scene, camera);
    renderer.copyFramebufferToTexture(lr.texture, _origin);
    renderer.setViewport(0, 0, this.width, this.height);
    renderer.render(lr.scene, lr.camera);
  }

  private disposeLowRes(): void {
    if (!this.lowRes) return;
    this.lowRes.texture.dispose();
    this.lowRes.material.dispose();
    (this.lowRes.scene.children[0] as THREE.Mesh).geometry.dispose();
    this.lowRes = null;
  }

  /** 引擎狀態（暫停時疊加圖層需要自己補畫） */
  get engineState(): string {
    return this.engine?.state ?? 'idle';
  }

  /** 目前負責繪製的 three.js 攝影機 */
  get activeCameraObject(): THREE.Camera | undefined {
    return this._activeCamera !== null ? this.cameras?.get(this._activeCamera) : undefined;
  }

  install(engine: Engine): void {
    this.engine = engine;
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    const world = ecs.world;
    this.ecs = ecs;
    this.world = world;
    const opts = this.options;

    // 繪製器
    this.ownsRenderer = !opts.renderer;
    const renderer =
      opts.renderer ?? new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: opts.antialias ?? true });
    this._renderer = renderer;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    renderer.setPixelRatio(opts.pixelRatio ?? Math.min(dpr, 2));
    if (opts.shadows) {
      renderer.shadowMap.enabled = true;
      // three.js r186 起 PCFShadowMap 就是柔和陰影（PCFSoftShadowMap 已移除，用它會出現警告）
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    if (opts.background !== null) this.scene.background = new THREE.Color(opts.background ?? 0x111111);

    // 畫布放進頁面、尺寸
    const container = opts.container ?? (typeof document !== 'undefined' ? document.body : undefined);
    if (container && !renderer.domElement.parentElement) {
      container.appendChild(renderer.domElement);
      this.appendedCanvas = true;
    }
    if (opts.size) this.setSize(opts.size.width, opts.size.height);
    else if (container) this.followContainer(container);

    // 綁定
    this.meshes = new Binding(world, this.scene, createMeshSpec(this.resources));
    this.cameras = new Binding(
      world,
      this.scene,
      createCameraSpec((e) => this.cameraAspect(e)),
    );
    this.lights = new Binding(world, this.scene, lightSpec);
    this.objects = new Binding(world, this.scene, sceneObjectSpec);

    world.setResource(RenderKey, this);
    // 場景檔的存讀規則（有安裝場景外掛時）
    const offCodecs = registerSceneCodecs(world, renderCodecs);
    const offSettings = registerSceneSettings(
      world,
      renderSettings(() => this.scene),
    );
    this.offCodecs = () => {
      offCodecs();
      offSettings();
    };
    // 提供實體的網格幾何給其他模組（例如物理從網格建立碰撞體），它們不必依賴繪製模組
    world.setResource(MeshGeometryKey, {
      geometryOf: (e) => {
        const source = world.get(e, MeshRenderer)?.geometry;
        if (!source) return null;
        return isGeometryDesc(source)
          ? { geometry: createGeometry(source), temporary: true }
          : { geometry: source, temporary: false };
      },
    });
    if (opts.adaptiveResolution) {
      const settings = opts.adaptiveResolution === true ? {} : opts.adaptiveResolution;
      this.adaptive = new AdaptiveResolution(renderer.getPixelRatio(), settings);
    }
    ecs.addSystem({
      name: 'render-sync',
      phase: 'render',
      priority: RENDER_SYNC_PRIORITY,
      run: (_w, time) => {
        this.adaptResolution(time.realDelta);
        this.sync();
      },
    });
    ecs.addSystem({ name: 'render-draw', phase: 'render', priority: RENDER_DRAW_PRIORITY, run: () => this.draw() });

    // 移除 RenderLayer：下一次同步時恢復成 default 圖層
    this.offLayerHook = world.onRemove(RenderLayer, (e) => this.layerReset.add(e));

    // 攝影機跟隨（CameraFollow）與晃動（CameraShake、shakeCamera）
    const rig = (this.cameraRig = new CameraRig(world));
    ecs.addSystem({
      name: 'camera-follow',
      phase: 'lateUpdate',
      priority: CAMERA_FOLLOW_PRIORITY,
      run: (_w, time) => rig.updateFollow(time.delta),
    });
    ecs.addSystem({
      name: 'camera-shake',
      phase: 'render',
      priority: CAMERA_SHAKE_PRIORITY,
      run: (_w, time) => rig.updateShake(time.delta, (e) => this.cameras?.get(e)),
    });

    // 攝影機繞轉控制（畫布要能接收事件；測試用的替身繪製器沒有）
    const canvas = renderer.domElement as HTMLCanvasElement | undefined;
    if (typeof window !== 'undefined' && typeof canvas?.addEventListener === 'function') {
      this.orbit = new OrbitController(world, canvas, () => this._activeCamera ?? this.pickCamera());
      const auto = opts.orbitControls;
      ecs.addSystem({
        name: 'orbit-control',
        phase: 'lateUpdate',
        priority: ORBIT_CONTROL_PRIORITY,
        run: (w, time) => {
          if (auto) {
            const cam = this._activeCamera ?? this.pickCamera();
            if (cam !== null) autoOrbitControl(w, cam, auto === true ? {} : auto);
          }
          this.orbit?.update(time.realDelta);
        },
      });
    }
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    this.ecs?.removeSystem('render-draw').removeSystem('render-sync');
    this.ecs?.removeSystem('camera-follow').removeSystem('camera-shake');
    this.cameraRig?.dispose();
    this.cameraRig = null;
    this.offLayerHook();
    this.offLayerHook = () => {};
    this.layerReset.clear();
    if (this.orbit) {
      this.ecs?.removeSystem('orbit-control');
      this.orbit.dispose();
      this.orbit = null;
    }
    for (const b of [this.meshes, this.cameras, this.lights, this.objects]) b?.dispose();
    this.meshes = this.cameras = this.lights = this.objects = null;
    this.cleanupResize?.();
    this.cleanupResize = null;
    this.drawHandler = null;
    this.resizeListeners.clear();
    this.overlays.length = 0;
    this.debug.object.removeFromParent();
    this.debug.clear();
    this.disposeLowRes();
    this.resources.dispose();
    if (this.world?.getResource(RenderKey) === this) {
      this.world.removeResource(RenderKey);
      this.world.removeResource(MeshGeometryKey);
    }
    if (this._renderer) {
      if (this.appendedCanvas) this._renderer.domElement.remove();
      if (this.ownsRenderer) this._renderer.dispose();
    }
    this._renderer = null;
    this.world = this.ecs = null;
  }

  /** 把 ECS 資料同步到 three.js 物件 */
  sync(): void {
    this.meshes!.sync();
    this.cameras!.sync();
    this.lights!.sync();
    this.objects!.sync();
    this.syncLayers();
    this.resources.sweep(); // 沒有實體在用的描述資源（例如剛換完場景）
    this._activeCamera = this.pickCamera();
  }

  /** 攝影機的寬高比：畫在一塊範圍裡的（CameraViewport）用那塊範圍的比例 */
  private cameraAspect(e: Entity): number {
    const v = this.world?.get(e, CameraViewport);
    if (!v) return this.aspect;
    return (v.width * this.width) / Math.max(v.height * this.height, 1);
  }

  /** 把 RenderLayer、CameraLayers 套用到 three.js 物件（模型的子物件也一起） */
  private syncLayers(): void {
    const world = this.world!;
    const apply = (e: Entity, mask: number) => {
      for (const b of [this.meshes, this.objects, this.lights]) {
        const obj = b?.get(e);
        if (obj) obj.traverse((o) => void (o.layers.mask = mask));
      }
    };
    for (const e of this.layerReset) if (world.isAlive(e) && !world.has(e, RenderLayer)) apply(e, 1);
    this.layerReset.clear();
    world.query([RenderLayer]).each((e, l) => apply(e, this.layers.mask(l.layers)));
    // 燈光預設照亮所有圖層（three.js 也用圖層過濾燈光：不這樣做的話，只畫其他圖層的攝影機會看不到光）
    world.query([Light]).each((e) => {
      if (world.has(e, RenderLayer)) return;
      const light = this.lights?.get(e);
      if (light) light.layers.mask = ALL_LAYERS;
    });
    world.query([Camera]).each((e) => {
      const cam = this.cameras?.get(e);
      if (!cam) return;
      const l = world.get(e, CameraLayers);
      cam.layers.mask = l ? this.layers.mask(l.layers) : 1;
    });
  }

  /** 畫一幀（平常由主迴圈自動呼叫） */
  draw(): void {
    const renderer = this.renderer;
    for (const listener of [...this.beforeDrawListeners]) listener();
    const camera = this.activeCameraObject;
    if (this.debug.object.parent !== this.scene) this.scene.add(this.debug.object);
    this.debug._beforeDraw();
    if (!camera) renderer.clear();
    else if (this.drawHandler) this.drawHandler(this.scene, camera);
    else if (this._scale < 1) this.drawLowRes(renderer, camera);
    else {
      this.disposeLowRes();
      renderer.render(this.scene, camera);
    }
    this.drawViewports(renderer);
    if (this.overlays.length) {
      // 疊加圖層：不清除畫面，直接畫在上面
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget?.(null);
      for (const o of this.overlays) renderer.render(o.scene, o.camera);
      renderer.autoClear = autoClear;
    }
    this.debug._afterDraw(); // 只畫一幀的拿掉
  }

  /** 額外的畫面（CameraViewport）：主畫面之後、介面之前，畫在畫面的一塊範圍裡 */
  private drawViewports(renderer: THREE.WebGLRenderer): void {
    const world = this.world;
    if (!world) return;
    const views: { cam: THREE.Camera; v: import('./Layers').CameraViewportData }[] = [];
    world.query([Camera, CameraViewport]).each((e, c, v) => {
      const cam = this.cameras?.get(e);
      if (cam && c.enabled && v.enabled && v.width > 0 && v.height > 0) views.push({ cam, v });
    });
    if (!views.length || typeof renderer.setScissor !== 'function') return;
    views.sort((a, b) => a.v.order - b.v.order);
    const autoClear = renderer.autoClear;
    const background = this.scene.background;
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    for (const { cam, v } of views) {
      // 畫面比例 → CSS 像素（WebGL 的原點在左下角）
      const x = v.x * this.width;
      const w = v.width * this.width;
      const h = v.height * this.height;
      const y = this.height - (v.y + v.height) * this.height;
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      if (v.background !== null) {
        renderer.setClearColor(v.background, 1);
        renderer.clear(true, true);
      } else renderer.clear(false, true); // 透明：只清深度，直接疊在主畫面上
      this.scene.background = v.background !== null ? null : background;
      renderer.render(this.scene, cam);
      this.scene.background = background;
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.width, this.height);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.autoClear = autoClear;
  }

  private pickCamera(): Entity | null {
    let best: Entity | null = null;
    let bestPriority = -Infinity;
    this.world!.query([Camera]).each((e, c) => {
      // 畫在一塊範圍裡的攝影機（CameraViewport）是額外的畫面，不當主畫面
      if (c.enabled && c.priority > bestPriority && this.cameras!.get(e) && !this.world!.has(e, CameraViewport)) {
        best = e;
        bestPriority = c.priority;
      }
    });
    return best;
  }

  private followContainer(container: HTMLElement): void {
    const isBody = container === document.body;
    const measure = () => {
      if (isBody) this.setSize(window.innerWidth, window.innerHeight);
      else this.setSize(container.clientWidth, container.clientHeight);
    };
    measure();
    if (isBody || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      this.cleanupResize = () => window.removeEventListener('resize', measure);
    } else {
      const observer = new ResizeObserver(measure);
      observer.observe(container);
      this.cleanupResize = () => observer.disconnect();
    }
  }
}
