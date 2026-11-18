/**
 * 3D 場景編輯器的畫面：用真正的引擎（ScenePlugin + RenderPlugin）顯示場景，看到的和遊戲裡一樣。
 *
 * 編輯器自己的東西都不是場景的一部分，存檔時不會存進去：
 * - 編輯器攝影機（優先度最高，畫面一律從它看；滑鼠轉動、縮放、平移）
 * - 格線、選取框、燈光與攝影機的圖示
 * - 移動／旋轉／縮放控制器（three.js 的 TransformControls）
 *
 * 控制器拖曳時直接改實體的 Transform（畫面即時更新），放開時才通知編輯器 commit（一個復原步驟）。
 *
 * 預製物件的實例在這裡展開（id 是「實例 id/內部 id」）；點到內部的實體時回報實例的 id。
 * 試玩（play）：安裝物理外掛、從場景的攝影機看、藏起編輯器的東西；停止後把所有實體放回場景檔的狀態。
 * UI 層（uilayer.ts）：場景檔 ui 欄位的介面檔疊在畫面上（只顯示、不能點），跟著 UI 編輯器的修改即時更新。
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Engine } from '../../core';
import { EcsPlugin, type Entity, type World } from '../../ecs';
import {
  Parent,
  ScenePlugin,
  Transform,
  expandPrefabs,
  math,
  registerSceneCodecs,
  transformCodec,
  type SceneFileData,
} from '../../scene';
import { Camera, Light, OrbitControl, RenderPlugin } from '../../render';
import { AssetPlugin } from '../../assets';
import { AnimationPlugin } from '../../animation';
import { PhysicsPlugin } from '../../physics';
import { colliderCodec, rigidBodyCodec } from '../../physics/sceneCodecs';
import { scriptListCodec } from '../../scripts/ScriptList';
import { ParticlePlugin } from '../../particles';
import { PostProcessingPlugin } from '../../postfx';
import { AIPlugin, navGridFromFile, type NavGrid } from '../../ai';
import { applySceneSettings, tick } from '../../scene';
import { AudioPlugin } from '../../audio';
import { audioSourceCodec } from '../../audio/sceneCodecs';
import { AudioSource } from '../../audio';
import { ParticleEmitter } from '../../particles';
import { Collider } from '../../physics/components';
import { Text3DPlugin } from '../../text3d';
import { ShaderPlugin } from '../../shaders';
import { UI3DPlugin } from '../../ui3d';
import { colliderGeometry } from './colliders';
import { WorldSync } from './sync';
import { UILayer } from './uilayer';

/** 編輯器攝影機的優先度：比場景裡的攝影機都高 */
const EDITOR_CAMERA_PRIORITY = 1_000_000;
const ACCENT = 0x9acd32;

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface ViewportEvents {
  /**
   * 在畫面上點選：id 是展開後的 id（預製物件內部是「實例/內部」），null 代表點到空白處；
   * modifier 是按著 Shift 或 Cmd/Ctrl（加選、取消選取）。
   */
  onPick(id: string | null, modifier: boolean): void;
  /** 控制器拖曳中（主要選取物件的 Transform，場景檔寫法） */
  onTransformLive(id: string, transform: unknown): void;
  /** 控制器放開：所有跟著移動的物件的新 Transform */
  onTransformEnd(changes: { id: string; transform: unknown }[]): void;
  /** 畫尋路格子：滑過的格子（erase 為 true 時改回可走）；done 代表放開滑鼠 */
  onNavPaint?(cells: [number, number][], erase: boolean, done: boolean): void;
  /** UI 層載入完成（error 為 null）或失敗 */
  onUIStatus?(error: string | null): void;
}

/** 燈光、攝影機的圖示（可以點選） */
interface Icon {
  group: THREE.Group;
  kind: 'light' | 'camera' | 'particles' | 'audio';
}

/** 碰撞體線框（依形狀資料快取） */
interface ColliderLines {
  lines: THREE.LineSegments;
  key: string;
}

export class SceneViewport {
  readonly engine = new Engine({ pauseOnHidden: false });
  readonly world: World;
  readonly scene: ScenePlugin;
  readonly render: RenderPlugin;
  readonly sync: WorldSync;
  /** UI 層：場景搭配的介面檔（public/ui） */
  readonly uiLayer: UILayer;
  private readonly ui3d = new UI3DPlugin({ mouse: false });

  private readonly editorCamera: Entity;
  private readonly grid: THREE.GridHelper;
  private readonly selectionBox = new THREE.Box3Helper(new THREE.Box3(), ACCENT);
  /** 滑鼠移到階層裡的項目時：那個物件的外框與名稱標籤 */
  private readonly hoverBox = new THREE.Box3Helper(new THREE.Box3(), 0x5ec8ff);
  private hoverTip: HTMLElement | null = null;
  private hovered: string | null = null;
  private readonly gizmo: TransformControls;
  /** 控制器操作的替身：放在實體的世界位置，拖曳後換算回實體的 Transform */
  private readonly pivot = new THREE.Object3D();
  private readonly icons = new Map<string, Icon>();
  private readonly iconMaterials = {
    light: new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false, transparent: true }),
    camera: new THREE.MeshBasicMaterial({ color: 0x8ecae6, depthTest: false, transparent: true }),
    particles: new THREE.MeshBasicMaterial({ color: 0xff8fab, depthTest: false, transparent: true }),
    audio: new THREE.MeshBasicMaterial({ color: 0xb5e48c, depthTest: false, transparent: true }),
    line: new THREE.LineBasicMaterial({ color: 0x9aa391, depthTest: false, transparent: true, opacity: 0.7 }),
  };
  private readonly iconGeometry = new THREE.OctahedronGeometry(0.16);
  private readonly colliders = new Map<string, ColliderLines>();
  private readonly colliderMaterial = new THREE.LineBasicMaterial({
    color: 0x4cc9f0,
    transparent: true,
    opacity: 0.55,
  });
  private readonly colliderSelected = new THREE.LineBasicMaterial({
    color: 0x9be7ff,
    depthTest: false,
    transparent: true,
  });
  private collidersWanted = true;
  private readonly raycaster = new THREE.Raycaster();
  /** 主要選取（控制器在它身上） */
  private selected: string | null = null;
  /** 所有選取的物件（展開後的 id） */
  private selection: string[] = [];
  /** 拖曳開始時每個要移動的物件的世界矩陣 */
  private dragStart = new Map<string, THREE.Matrix4>();
  /** 其他選取物件的選取框 */
  private readonly extraBoxes: THREE.Box3Helper[] = [];
  private dragging = false;
  /** 最近一次 show 的資料（試玩結束後重新套用） */
  private lastData: SceneFileData | null = null;
  private physics: Promise<PhysicsPlugin> | null = null;
  /** 目前套用的場景設定（JSON，比對有沒有改） */
  private settingsJson = '';
  private undoSettings: (() => void) | null = null;
  private settingsWarnings: string[] = [];
  /** 尋路格子的顯示 */
  private navOverlay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private navGrid: NavGrid | null = null;
  private navJson = '';
  private navWanted = false;
  /** 畫尋路格子的模式：左鍵拖曳畫擋住，按住 Shift 擦掉 */
  paintMode = false;
  private _playing = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewportEvents,
  ) {
    const ecs = new EcsPlugin();
    this.scene = new ScenePlugin();
    this.render = new RenderPlugin({ container, background: 0x1a1d19, shadows: true });
    // 模型（Model）與動畫（Animator）：編輯時也顯示、播放；物理只在試玩時安裝
    // 粒子編輯時就播放（即時預覽）；音效只在試玩時安裝（編輯時不出聲）
    this.engine
      .use(ecs)
      .use(this.scene)
      .use(this.render)
      .use(new AssetPlugin())
      .use(new AnimationPlugin())
      .use(new ParticlePlugin())
      .use(new ShaderPlugin()) // 材質描述 { shaderGraph }：節點圖檔（著色器編輯器存檔後自動更新）
      .use(new Text3DPlugin()) // 3D 文字
      .use(this.ui3d) // 3D 介面面板（只顯示；不接滑鼠，點到面板是選取那個物件）
      .use(new AIPlugin()); // 場景設定的 navGrid 由 AI 外掛處理；沒有角色時不做事
    this.world = ecs.world;
    // 物理、音效的存讀規則平常就要有（這兩個外掛只在試玩時安裝）：編輯時可以加剛體、碰撞體、音源
    // 腳本（ScriptList）：編輯器不執行遊戲的腳本，只編輯要掛哪些腳本、參數是多少
    registerSceneCodecs(this.world, [rigidBodyCodec, colliderCodec, audioSourceCodec, scriptListCodec] as never[]);
    this.sync = new WorldSync(this.world);
    this.uiLayer = new UILayer(this.engine, {
      onStatus: (error) => events.onUIStatus?.(error),
      // UI 編輯器改了介面檔：3D 介面面板也重新載入（可能用到同一個檔案或它匯入的主題）
      onExternalChange: () => this.ui3d.controller.reloadPanels(),
    });

    // 編輯器攝影機（自己加 OrbitControl，不用 RenderPlugin 的 orbitControls：那個會控制場景裡的攝影機）
    this.editorCamera = this.world.spawn(
      Camera.with({ fov: 50, near: 0.05, far: 2000, priority: EDITOR_CAMERA_PRIORITY }),
      Transform,
    );
    this.world.add(this.editorCamera, OrbitControl, { target: new THREE.Vector3(), damping: 0.05 });
    const t = this.world.get(this.editorCamera, Transform)!;
    t.position.set(8, 6, 10);
    math.lookAt(t, new THREE.Vector3());

    // 格線、選取框
    this.grid = new THREE.GridHelper(40, 40, 0x4d5746, 0x2a3027);
    this.render.scene.add(this.grid, this.selectionBox, this.pivot, this.hoverBox);
    this.selectionBox.visible = false;
    this.hoverBox.visible = false;

    // 控制器
    this.gizmo = new TransformControls(this.render.activeCameraObject ?? new THREE.PerspectiveCamera(), this.canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', (e) => this.onDragging(e.value as boolean));
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.render.scene.add(this.gizmo.getHelper());

    // 每幀：更新圖示、選取框、控制器位置（在繪製外掛同步之後、繪製之前）
    ecs.addSystem({ name: 'editor-overlay', phase: 'render', priority: 950, run: () => this.updateOverlay() });

    this.installPointer();
    this.engine.start();
  }

  private get canvas(): HTMLCanvasElement {
    return this.render.renderer.domElement;
  }

  // ───────── 場景資料 ─────────

  /**
   * 依場景檔資料更新畫面（只更新有變化的部分）；回傳警告。
   * data.prefabs 要放用到的預製物件（還沒讀到的先只顯示實例本身）。
   */
  show(data: SceneFileData): readonly string[] {
    this.lastData = data;
    let warnings: string[] = [];
    try {
      this.sync.apply(expandPrefabs(data, { missing: 'skip' }).data);
      warnings = this.sync.warnings;
    } catch (error) {
      // 預製物件錯誤（例如互相包含）：先不展開
      this.sync.apply({ ...data, entities: data.entities.map(({ prefab: _, ...e }) => e) });
      warnings = [(error as Error).message, ...this.sync.warnings];
    }
    // 馬上重算世界矩陣（不等下一幀）：同步後立刻選取、拖曳、對準都用正確的位置
    tick.transforms(this.world);
    this.syncIcons();
    this.applySettings(data.settings);
    this.uiLayer.setFiles(data.ui ?? []);
    return [...warnings, ...this.settingsWarnings];
  }

  // ───────── 場景設定 ─────────

  /** 場景設定改了才重新套用（先恢復舊的）；後製外掛只在場景有 postfx 設定時安裝（沒設定時畫面和遊戲一樣） */
  private applySettings(settings: Record<string, unknown> | undefined): void {
    const json = JSON.stringify(settings ?? {});
    this.updateNavOverlay(settings?.navGrid);
    if (json === this.settingsJson) return;
    this.settingsJson = json;
    this.undoSettings?.();
    this.undoSettings = null;
    const wantPostfx = settings?.postfx !== undefined;
    if (wantPostfx && !this.engine.getPlugin('postfx')) this.engine.use(new PostProcessingPlugin());
    if (!wantPostfx && this.engine.getPlugin('postfx')) this.engine.removePlugin('postfx');
    try {
      const r = applySceneSettings(this.world, settings);
      this.undoSettings = r.undo;
      this.settingsWarnings = r.warnings;
    } catch (error) {
      this.settingsWarnings = [(error as Error).message];
    }
  }

  // ───────── 尋路格子 ─────────

  /** 顯示尋路格子（場景設定面板打開時） */
  set navGridVisible(v: boolean) {
    this.navWanted = v;
    if (this.navOverlay) this.navOverlay.visible = v && !this._playing;
  }

  /** 依 settings.navGrid 更新顯示：擋住的格子紅色、可走的淡綠色 */
  private updateNavOverlay(value: unknown): void {
    const json = JSON.stringify(value ?? null);
    if (json === this.navJson) return;
    this.navJson = json;
    let grid: NavGrid | null = null;
    try {
      grid = value ? navGridFromFile(value) : null;
    } catch {
      grid = null; // 格式錯誤：場景設定的警告會說明
    }
    this.navGrid = grid;
    if (this.navOverlay) {
      this.render.scene.remove(this.navOverlay);
      this.navOverlay.geometry.dispose();
      this.navOverlay.material.map?.dispose();
      this.navOverlay.material.dispose();
      this.navOverlay = null;
    }
    if (!grid) return;
    const { cols, rows, cellSize } = grid;
    const data = new Uint8Array(cols * rows * 4);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        // 貼圖的第 0 列在平面的 +Z 那一邊：反過來放
        const i = ((rows - 1 - r) * cols + c) * 4;
        const blocked = grid.walkable[r * cols + c] === 0;
        data.set(blocked ? [255, 80, 80, 140] : [120, 220, 120, (r + c) % 2 ? 40 : 60], i);
      }
    const texture = new THREE.DataTexture(data, cols, rows);
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(cols * cellSize, rows * cellSize),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(grid.min.x + (cols * cellSize) / 2, grid.y + 0.02, grid.min.z + (rows * cellSize) / 2);
    mesh.renderOrder = 997;
    mesh.visible = this.navWanted && !this._playing;
    this.navOverlay = mesh;
    this.render.scene.add(mesh);
  }

  /** 畫面座標下的尋路格子（沒有網格或不在範圍內時 null） */
  private navCellAt(clientX: number, clientY: number): [number, number] | null {
    const grid = this.navGrid;
    const cam = this.render.activeCameraObject;
    if (!grid || !cam) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, cam);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -grid.y), p)) return null;
    const cell = grid.cellOf(p);
    return cell ? [cell.col, cell.row] : null;
  }

  /** 所有碰撞體的世界範圍（從碰撞體產生尋路格子用） */
  colliderBoxes(): THREE.Box3[] {
    const out: THREE.Box3[] = [];
    for (const [, e] of this.sync.entries()) {
      const c = this.world.get(e, Collider);
      const t = this.world.get(e, Transform);
      if (!c || !t || c.sensor) continue;
      const mesh = this.render.getObject(e, 'mesh') as THREE.Mesh | undefined;
      const usesMesh = c.shape === 'convexHull' || c.shape === 'trimesh';
      const g = colliderGeometry(c, usesMesh ? (mesh?.geometry ?? null) : null);
      if (!g) continue;
      g.computeBoundingBox();
      if (g.boundingBox) out.push(g.boundingBox.clone().applyMatrix4(t.worldMatrix));
      g.dispose();
    }
    return out;
  }

  /** 展開後的 id（預製物件內部是「實例/內部」）→ 場景檔裡的 id */
  static docId(id: string): string {
    return id.split('/')[0];
  }

  /** 移除所有場景實體 */
  clear(): void {
    this.sync.clear();
    this.syncIcons();
    this.select([]);
  }

  // ───────── 選取與控制器 ─────────

  /** 設定選取（展開後的 id；最後一個是主要選取，控制器在它身上） */
  select(ids: readonly string[]): void {
    this.selection = [...ids];
    this.selected = ids.at(-1) ?? null;
    const e = this.selected !== null ? this.sync.entityOf(this.selected) : undefined;
    const t = e !== undefined ? this.world.get(e, Transform) : undefined;
    if (t) {
      // 替身馬上放到新的主要選取上（不等下一幀），選了立刻拖曳也正確
      t.worldMatrix.decompose(this.pivot.position, this.pivot.quaternion, this.pivot.scale);
      this.pivot.updateMatrixWorld();
      this.gizmo.attach(this.pivot);
    } else this.gizmo.detach();
  }

  /** 拖曳時要跟著移動的物件：有 Transform、而且祖先沒有也被選到（否則會移動兩次） */
  private movable(): string[] {
    const chosen = new Set(this.selection.map((id) => this.sync.entityOf(id)).filter((e) => e !== undefined));
    return this.selection.filter((id) => {
      const e = this.sync.entityOf(id);
      if (e === undefined || !this.world.has(e, Transform)) return false;
      for (let p = this.scene.hierarchy.parentOf(e); p !== null; p = this.scene.hierarchy.parentOf(p))
        if (chosen.has(p)) return false;
      return true;
    });
  }

  /** 把實體放到指定的世界矩陣（換算成相對父節點的 Transform） */
  private placeAt(e: Entity, world: THREE.Matrix4): void {
    const t = this.world.get(e, Transform);
    if (!t) return;
    const local = world.clone();
    const parent = this.world.get(e, Parent)?.entity;
    const pt = parent !== undefined ? this.world.get(parent, Transform) : undefined;
    if (pt) local.premultiply(pt.worldMatrix.clone().invert());
    local.decompose(t.position, t.rotation, t.scale);
    t.worldMatrix.copy(world); // 同一次拖曳裡的子孫換算要用新的位置
  }

  set gizmoMode(mode: GizmoMode) {
    this.gizmo.setMode(mode);
  }

  get gizmoMode(): GizmoMode {
    return this.gizmo.getMode() as GizmoMode;
  }

  /** 控制器用世界座標或區域座標 */
  set gizmoSpace(space: 'world' | 'local') {
    this.gizmo.setSpace(space);
  }

  /** 對齊：移動間隔（公尺）、旋轉間隔（度）、縮放間隔；null 代表不對齊 */
  setSnap(snap: { translate: number; rotate: number; scale: number } | null): void {
    this.gizmo.setTranslationSnap(snap ? snap.translate : null);
    this.gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(snap.rotate) : null);
    this.gizmo.setScaleSnap(snap ? snap.scale : null);
  }

  set gridVisible(v: boolean) {
    this.gridWanted = v;
    this.grid.visible = v && !this._playing;
  }

  private onDragging(active: boolean): void {
    this.dragging = active;
    const orbit = this.world.get(this.editorCamera, OrbitControl);
    if (orbit) orbit.enabled = !active;
    if (active) {
      this.dragStart.clear();
      for (const id of this.movable()) {
        const t = this.world.get(this.sync.entityOf(id)!, Transform)!;
        this.dragStart.set(id, t.worldMatrix.clone());
      }
      return;
    }
    const changes: { id: string; transform: unknown }[] = [];
    for (const id of this.dragStart.keys()) {
      const t = this.world.get(this.sync.entityOf(id)!, Transform);
      if (!t) continue;
      const json = transformCodec.write(t);
      this.sync.markApplied(id, 'Transform', json);
      changes.push({ id, transform: json });
    }
    this.dragStart.clear();
    if (changes.length) this.events.onTransformEnd(changes);
  }

  /** 替身被拖動：主要選取跟著替身，其他選取的物件做同樣的移動（相對拖曳開始時） */
  private onGizmoChange(): void {
    if (!this.selected) return;
    const e = this.sync.entityOf(this.selected);
    if (e === undefined || !this.world.has(e, Transform)) return;
    this.pivot.updateMatrixWorld();
    const start = this.dragStart.get(this.selected);
    // 變化量：新的世界矩陣 × 開始時的反矩陣
    const delta = start ? this.pivot.matrixWorld.clone().multiply(start.clone().invert()) : null;
    this.placeAt(e, this.pivot.matrixWorld);
    if (delta)
      for (const [id, m] of this.dragStart) {
        if (id === this.selected) continue;
        const other = this.sync.entityOf(id);
        if (other !== undefined) this.placeAt(other, delta.clone().multiply(m));
      }
    tick.transforms(this.world); // 子孫的世界位置也跟著更新
    this.events.onTransformLive(this.selected, transformCodec.write(this.world.get(e, Transform)!));
  }

  // ───────── 圖示 ─────────

  /** 燈光、攝影機圖示：場景裡有幾個就建立幾個 */
  private syncIcons(): void {
    const want = new Map<string, Icon['kind']>();
    for (const [id, e] of this.sync.entries()) {
      const lightKind = this.world.get(e, Light)?.kind;
      if (this.world.has(e, Camera)) want.set(id, 'camera');
      // 環境光、半球光沒有位置與方向：不畫圖示（從階層選）
      else if (lightKind && lightKind !== 'ambient' && lightKind !== 'hemisphere') want.set(id, 'light');
      else if (this.world.has(e, ParticleEmitter)) want.set(id, 'particles');
      else if (this.world.has(e, AudioSource)) want.set(id, 'audio');
    }
    for (const [id, icon] of this.icons) {
      if (want.get(id) === icon.kind) continue;
      this.render.scene.remove(icon.group);
      icon.group.traverse((o) => {
        if (o instanceof THREE.Line) o.geometry.dispose();
      });
      this.icons.delete(id);
    }
    for (const [id, kind] of want) {
      if (this.icons.has(id)) continue;
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.iconGeometry, this.iconMaterials[kind]);
      body.renderOrder = 999;
      group.add(body);
      // 朝向（-Z）：攝影機畫視野的角錐，燈光畫一條線
      const pts =
        kind === 'camera'
          ? [
              [0, 0, 0],
              [-0.3, 0.2, -0.5],
              [0, 0, 0],
              [0.3, 0.2, -0.5],
              [0, 0, 0],
              [0.3, -0.2, -0.5],
              [0, 0, 0],
              [-0.3, -0.2, -0.5],
              [-0.3, 0.2, -0.5],
              [0.3, 0.2, -0.5],
              [0.3, 0.2, -0.5],
              [0.3, -0.2, -0.5],
              [0.3, -0.2, -0.5],
              [-0.3, -0.2, -0.5],
              [-0.3, -0.2, -0.5],
              [-0.3, 0.2, -0.5],
            ]
          : kind === 'light'
            ? [
                [0, 0, 0],
                [0, 0, -0.8],
              ]
            : [];
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
        this.iconMaterials.line,
      );
      line.renderOrder = 999;
      group.add(line);
      group.userData.editorId = id;
      group.matrixAutoUpdate = false;
      group.visible = !this._playing;
      this.render.scene.add(group);
      this.icons.set(id, { group, kind });
    }
  }

  /** 實體連同子孫的網格、模型範圍 */
  private boundsOf(e: Entity, box: THREE.Box3): THREE.Box3 {
    const add = (x: Entity) => {
      for (const kind of ['mesh', 'object'] as const) {
        const o = this.render.getObject(x, kind);
        if (o?.visible) {
          o.updateWorldMatrix(true, true);
          box.expandByObject(o);
        }
      }
    };
    add(e);
    this.scene.hierarchy.forEachDescendant(e, add);
    return box;
  }

  private updateOverlay(): void {
    // 圖示跟著實體（不跟縮放）
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (const [id, icon] of this.icons) {
      const e = this.sync.entityOf(id);
      const t = e !== undefined ? this.world.get(e, Transform) : undefined;
      const light = e !== undefined ? this.world.get(e, Light) : undefined;
      if (t) t.worldMatrix.decompose(pos, rot, scl);
      else {
        pos.set(0, 0, 0);
        rot.identity();
      }
      icon.group.matrix.compose(pos, rot, new THREE.Vector3(1, 1, 1));
      icon.group.matrixWorldNeedsUpdate = true;
      // 點光源往四面八方照：不畫方向線；粒子、音效沒有方向線
      icon.group.children[1].visible = (icon.kind === 'light' && light?.kind !== 'point') || icon.kind === 'camera';
    }

    // 其他選取的物件：較淡的選取框
    const others = this.selection.filter((id) => id !== this.selected);
    while (this.extraBoxes.length < others.length) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), 0x6b8f2a);
      this.render.scene.add(helper);
      this.extraBoxes.push(helper);
    }
    this.extraBoxes.forEach((helper, i) => {
      helper.box.makeEmpty();
      const id = others[i];
      const x = id !== undefined ? this.sync.entityOf(id) : undefined;
      if (x !== undefined) this.boundsOf(x, helper.box);
      if (id !== undefined && helper.box.isEmpty() && this.icons.has(id))
        helper.box.expandByObject(this.icons.get(id)!.group.children[0]);
      helper.visible = !helper.box.isEmpty() && !this._playing;
    });

    // 主要選取的選取框、控制器替身
    const e = this.selected !== null ? this.sync.entityOf(this.selected) : undefined;
    const box = this.selectionBox.box;
    box.makeEmpty();
    if (e !== undefined) {
      this.boundsOf(e, box);
      if (box.isEmpty() && this.selected && this.icons.has(this.selected))
        box.expandByObject(this.icons.get(this.selected)!.group.children[0]);
      const t = this.world.get(e, Transform);
      if (t && !this.dragging) {
        t.worldMatrix.decompose(this.pivot.position, this.pivot.quaternion, this.pivot.scale);
        this.pivot.updateMatrixWorld();
      }
      if (this.world.has(e, Transform) && !this.gizmo.object) this.gizmo.attach(this.pivot);
    }
    this.selectionBox.visible = !box.isEmpty() && !this._playing;
    this.updateHover();
    // 控制器要用目前繪製的攝影機
    const cam = this.render.activeCameraObject;
    if (cam && this.gizmo.camera !== cam) this.gizmo.camera = cam;
    this.updateColliders();
  }

  // ───────── 階層的滑鼠提示 ─────────

  /**
   * 滑鼠移到階層裡的項目時呼叫：在那個物件上畫外框、上方顯示名稱標籤（null：移開，隱藏）。
   * @param info 標籤內容：名稱、id、說明（例如元件清單）
   */
  setHover(id: string | null, info?: { name: string; detail?: string }): void {
    this.hovered = id;
    if (!this.hoverTip) {
      this.hoverTip = document.createElement('div');
      this.hoverTip.className = 'hover-tip';
      this.container.append(this.hoverTip);
    }
    const tip = this.hoverTip;
    tip.replaceChildren();
    if (id !== null && info) {
      const head = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = info.name;
      const idEl = document.createElement('span');
      idEl.className = 'hover-tip-id';
      idEl.textContent = id;
      head.append(name, idEl);
      tip.append(head);
      if (info.detail) {
        const d = document.createElement('div');
        d.className = 'hover-tip-detail';
        d.textContent = info.detail;
        tip.append(d);
      }
    }
    this.updateHover();
  }

  /** 每幀：外框跟著物件，標籤放在外框上方（物件在鏡頭後面、沒有範圍時隱藏） */
  private updateHover(): void {
    const box = this.hoverBox.box;
    box.makeEmpty();
    const id = this.hovered;
    const e = id !== null ? this.sync.entityOf(id) : undefined;
    if (e !== undefined) this.boundsOf(e, box);
    if (id !== null && box.isEmpty() && this.icons.has(id)) box.expandByObject(this.icons.get(id)!.group.children[0]);
    const show = id !== null && !box.isEmpty() && !this._playing;
    this.hoverBox.visible = show;
    const tip = this.hoverTip;
    if (!tip) return;
    const cam = this.render.activeCameraObject;
    if (!show || !cam) {
      tip.hidden = true;
      return;
    }
    // 外框頂面的中心投影到畫面上
    const p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(cam);
    if (p.z > 1 || p.z < -1) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    const w = this.container.clientWidth;
    const ht = this.container.clientHeight;
    const x = ((p.x + 1) / 2) * w;
    const y = ((1 - p.y) / 2) * ht;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = `${Math.min(w - tw - 6, Math.max(6, x - tw / 2))}px`;
    tip.style.top = `${Math.min(ht - th - 6, Math.max(6, y - th - 10))}px`;
  }

  // ───────── 碰撞體線框 ─────────

  /** 顯示碰撞體線框（試玩時一律不顯示） */
  set collidersVisible(v: boolean) {
    this.collidersWanted = v;
  }

  private updateColliders(): void {
    const show = this.collidersWanted && !this._playing;
    const seen = new Set<string>();
    for (const [id, e] of this.sync.entries()) {
      const c = this.world.get(e, Collider);
      const t = this.world.get(e, Transform);
      if (!c || !t || !show) continue;
      const mesh = this.render.getObject(e, 'mesh') as THREE.Mesh | undefined;
      const usesMesh = c.shape === 'convexHull' || c.shape === 'trimesh';
      const key = JSON.stringify([
        c.shape,
        c.halfExtents,
        c.radius,
        c.halfHeight,
        c.offset,
        usesMesh ? mesh?.geometry.uuid : 0,
      ]);
      let entry = this.colliders.get(id);
      if (!entry || entry.key !== key) {
        if (entry) this.removeCollider(id);
        const geometry = colliderGeometry(c, usesMesh ? (mesh?.geometry ?? null) : null);
        if (!geometry) continue;
        const lines = new THREE.LineSegments(geometry, this.colliderMaterial);
        lines.matrixAutoUpdate = false;
        lines.renderOrder = 998;
        this.render.scene.add(lines);
        entry = { lines, key };
        this.colliders.set(id, entry);
      }
      entry.lines.matrix.copy(t.worldMatrix);
      entry.lines.matrixWorldNeedsUpdate = true;
      entry.lines.material = this.selection.includes(id) ? this.colliderSelected : this.colliderMaterial;
      seen.add(id);
    }
    for (const id of [...this.colliders.keys()]) if (!seen.has(id)) this.removeCollider(id);
  }

  private removeCollider(id: string): void {
    const entry = this.colliders.get(id);
    if (!entry) return;
    this.render.scene.remove(entry.lines);
    entry.lines.geometry.dispose();
    this.colliders.delete(id);
  }

  // ───────── 給編輯器用的座標資訊 ─────────

  /** 實體的世界矩陣（展開後的 id；找不到時 null） */
  worldMatrixOf(id: string): THREE.Matrix4 | null {
    const e = this.sync.entityOf(id);
    const t = e !== undefined ? this.world.get(e, Transform) : undefined;
    return t ? t.worldMatrix.clone() : null;
  }

  /**
   * 實體自己的網格、模型在實體區域座標裡的範圍（「符合網格大小」用）。
   * 網格用幾何本身的範圍（準確）；模型用世界範圍換回區域座標（旋轉過的模型會稍微大一點）。
   */
  localBoundsOf(id: string): THREE.Box3 | null {
    const e = this.sync.entityOf(id);
    if (e === undefined) return null;
    const mesh = this.render.getObject(e, 'mesh') as THREE.Mesh | undefined;
    if (mesh?.geometry) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.isEmpty()) return mesh.geometry.boundingBox.clone();
    }
    const object = this.render.getObject(e, 'object');
    const t = this.world.get(e, Transform);
    if (object && t) {
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      if (!box.isEmpty()) return box.applyMatrix4(t.worldMatrix.clone().invert());
    }
    return null;
  }

  // ───────── 點選與攝影機 ─────────

  private installPointer(): void {
    let down: { x: number; y: number } | null = null;
    // 滑鼠在控制器上時，按下不轉動攝影機（要在 OrbitController 之前處理：capture）
    // 畫尋路格子：左鍵拖曳（Shift 擦掉）；相鄰兩次之間的格子補上，快速拖曳也不會漏
    let painting: { last: [number, number] | null; erase: boolean } | null = null;
    const paintTo = (cell: [number, number] | null, done: boolean) => {
      if (!painting) return;
      const cells: [number, number][] = [];
      if (cell) {
        const from = painting.last ?? cell;
        const steps = Math.max(Math.abs(cell[0] - from[0]), Math.abs(cell[1] - from[1]), 1);
        for (let i = 1; i <= steps; i++)
          cells.push([
            Math.round(from[0] + ((cell[0] - from[0]) * i) / steps),
            Math.round(from[1] + ((cell[1] - from[1]) * i) / steps),
          ]);
        if (!painting.last) cells.unshift(cell);
        painting.last = cell;
      }
      this.events.onNavPaint?.(cells, painting.erase, done);
    };
    this.container.addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as HTMLElement).closest?.('.asset-win')) return; // 素材預覽小視窗裡的操作
        const orbit = this.world.get(this.editorCamera, OrbitControl);
        if (this.paintMode && this.navGrid && e.button === 0 && !this._playing) {
          if (orbit) orbit.enabled = false;
          painting = { last: null, erase: e.shiftKey };
          paintTo(this.navCellAt(e.clientX, e.clientY), false);
          down = null;
          return;
        }
        if (orbit) orbit.enabled = this.gizmo.axis === null;
        down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      },
      { capture: true },
    );
    window.addEventListener('pointermove', (e) => {
      if (painting) paintTo(this.navCellAt(e.clientX, e.clientY), false);
    });
    window.addEventListener('pointerup', (e) => {
      const orbit = this.world.get(this.editorCamera, OrbitControl);
      if (orbit && !this.dragging) orbit.enabled = true;
      if (painting) {
        paintTo(null, true);
        painting = null;
        return;
      }
      if (!down || e.target !== this.canvas) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 4 && this.gizmo.axis === null)
        this.events.onPick(this.pickAt(e.clientX, e.clientY), e.shiftKey || e.metaKey || e.ctrlKey);
    });
  }

  /** 畫面座標點到的實體 id（網格或圖示，取最近的） */
  pickAt(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -((clientY - r.top) / r.height) * 2 + 1;
    let best: { id: string; distance: number } | null = null;
    const hit = this.render.pick(ndcX, ndcY, (h) => this.sync.idOf(h.entity) !== undefined);
    if (hit) best = { id: this.sync.idOf(hit.entity)!, distance: hit.distance };
    const cam = this.render.activeCameraObject;
    if (cam) {
      this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
      const bodies = [...this.icons.values()].map((i) => i.group.children[0]);
      // 圖示畫在最上層（不會被擋住）：點到圖示時優先選它
      const icon = this.raycaster.intersectObjects(bodies, false)[0];
      if (icon) best = { id: icon.object.parent?.userData.editorId as string, distance: icon.distance };
    }
    return best?.id ?? null;
  }

  /**
   * 放下素材的位置：滑鼠下的物件表面，沒有物件時是地面（y = 0）。
   * id 是滑鼠下的實體（展開後的 id，預製物件內部是「實例/內部」）。
   */
  dropPoint(clientX: number, clientY: number): { point: number[]; id: string | null } {
    const r = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -((clientY - r.top) / r.height) * 2 + 1;
    const hit = this.render.pick(ndcX, ndcY, (h) => this.sync.idOf(h.entity) !== undefined);
    const round = (v: THREE.Vector3) => v.toArray().map((n) => Math.round(n * 100) / 100);
    if (hit) return { point: round(hit.point), id: this.sync.idOf(hit.entity)! };
    const cam = this.render.activeCameraObject;
    const p = new THREE.Vector3();
    if (cam) {
      this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
      if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p))
        return { point: round(p), id: null };
    }
    return { point: this.spawnPoint(), id: null };
  }

  // ───────── 試玩 ─────────

  get playing(): boolean {
    return this._playing;
  }

  /**
   * 開始試玩：安裝物理外掛（第一次要下載 Rapier）、從場景裡優先度最高的攝影機看（沒有時用編輯器攝影機），
   * 藏起格線、圖示、控制器。回傳用的是哪一台攝影機（null 是編輯器攝影機）。
   */
  async play(): Promise<string | null> {
    if (this._playing) return null;
    this._playing = true;
    this.physics ??= PhysicsPlugin.create();
    const physics = await this.physics;
    if (!this._playing) return null; // 下載期間已經按了停止
    this.engine.use(physics).use(new AudioPlugin());
    let sceneCamera: string | null = null;
    let best = -Infinity;
    for (const [id, e] of this.sync.entries()) {
      const c = this.world.get(e, Camera);
      if (c?.enabled && c.priority > best) {
        best = c.priority;
        sceneCamera = id;
      }
    }
    this.world.get(this.editorCamera, Camera)!.enabled = sceneCamera === null;
    this.setOverlayVisible(false);
    return sceneCamera === null ? null : SceneViewport.docId(sceneCamera);
  }

  /** 停止試玩：移除物理外掛，所有實體回到場景檔的狀態 */
  stop(): void {
    if (!this._playing) return;
    this._playing = false;
    if (this.engine.getPlugin('audio')) this.engine.removePlugin('audio');
    if (this.engine.getPlugin('physics')) this.engine.removePlugin('physics');
    this.world.get(this.editorCamera, Camera)!.enabled = true;
    this.setOverlayVisible(true);
    this.sync.reset();
    if (this.lastData) this.show(this.lastData);
  }

  private gridWanted = true;
  private setOverlayVisible(v: boolean): void {
    this.grid.visible = v && this.gridWanted;
    this.selectionBox.visible = v;
    for (const icon of this.icons.values()) icon.group.visible = v;
    this.gizmo.getHelper().visible = v;
    if (this.navOverlay) this.navOverlay.visible = v && this.navWanted;
    this.gizmo.enabled = v;
  }

  /** 新物件放置的位置：攝影機繞轉的中心點（落在地面上，取到 0.5） */
  spawnPoint(): number[] {
    const target = this.world.get(this.editorCamera, OrbitControl)?.target ?? new THREE.Vector3();
    return [Math.round(target.x * 2) / 2, 0, Math.round(target.z * 2) / 2];
  }

  /** 把攝影機對準實體（F 鍵） */
  focus(ids: readonly string[]): void {
    const box = new THREE.Box3();
    const points: THREE.Vector3[] = [];
    for (const id of ids) {
      const e = this.sync.entityOf(id);
      if (e === undefined) continue;
      const b = this.boundsOf(e, new THREE.Box3());
      if (!b.isEmpty()) box.union(b);
      const t = this.world.get(e, Transform);
      if (t) points.push(new THREE.Vector3().setFromMatrixPosition(t.worldMatrix));
    }
    for (const p of points) if (!box.isEmpty()) box.expandByPoint(p);
    const center = new THREE.Vector3();
    let radius = 2; // 沒有網格的（燈光、攝影機、空物件）：留一點距離
    if (!box.isEmpty()) {
      box.getCenter(center);
      radius = Math.max(0.25, box.getSize(new THREE.Vector3()).length() / 2);
    } else if (points.length) {
      center.copy(points[0]);
    } else return;
    const ct = this.world.get(this.editorCamera, Transform)!;
    const orbit = this.world.get(this.editorCamera, OrbitControl)!;
    const fov = THREE.MathUtils.degToRad(this.world.get(this.editorCamera, Camera)!.fov);
    const distance = radius / Math.sin(fov / 2) + 0.5;
    const dir = ct.position
      .clone()
      .sub(orbit.target ?? new THREE.Vector3())
      .normalize();
    if (dir.lengthSq() === 0) dir.set(0.5, 0.5, 1).normalize();
    ct.position.copy(center).addScaledVector(dir, distance);
    math.lookAt(ct, center);
    orbit.target = center.clone();
  }

  dispose(): void {
    for (const helper of this.extraBoxes) {
      this.render.scene.remove(helper);
      helper.dispose();
    }
    this.gizmo.detach();
    this.gizmo.dispose();
    this.clear();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.iconGeometry.dispose();
    for (const m of Object.values(this.iconMaterials)) m.dispose();
    for (const id of [...this.colliders.keys()]) this.removeCollider(id);
    this.colliderMaterial.dispose();
    this.colliderSelected.dispose();
    this.uiLayer.dispose();
    this.engine.destroy();
  }
}
