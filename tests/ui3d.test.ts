import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine, type Plugin } from '../src/core';
import { EcsPlugin, type Entity } from '../src/ecs';
import { SceneObject } from '../src/render/components';
import { UI2D, measure, type UILabel, type UISlider } from '../src/ui2d';
import { DEFAULT_PANEL_SIZE, UI3DPlugin, UIPanel3D, type UIPanel3DData } from '../src/ui3d';
import { fakeScheduler } from './helpers';

// Node 沒有畫布：用什麼都不做的假畫布
class FakeCanvas {
  width = 1;
  height = 1;
  getContext() {
    return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  }
}
beforeAll(() => vi.stubGlobal('OffscreenCanvas', FakeCanvas));
afterAll(() => vi.unstubAllGlobals());

const XML = `
<UI padding="0">
  <UILayout dir="h" height="100">
    <UIButton id="btn" width="200" height="100" text="按我" onClick="hit"/>
    <UILayout flex="1"/>
  </UILayout>
  <UISlider id="s" width="400" height="40" min="0" max="100" value="0"/>
  <UILabel id="title">標題</UILabel>
</UI>`;

/** 假的繪製外掛：只提供 UI3D 需要的部分（攝影機、場景、狀態） */
function fakeRender(camera: THREE.Camera) {
  const scene = new THREE.Scene();
  const plugin = {
    name: 'render',
    scene,
    renderer: null,
    activeCameraObject: camera,
    engineState: 'running',
    draw: vi.fn(),
    install() {},
  };
  return plugin as unknown as Plugin & { scene: THREE.Scene; draw: ReturnType<typeof vi.fn> };
}

async function setup(panel: Partial<UIPanel3DData> = {}) {
  const clock = fakeScheduler();
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  const ecs = new EcsPlugin();
  // 攝影機在 z=5 看向原點
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();
  const render = fakeRender(camera);
  const shared = vi.fn();
  const ui3d = new UI3DPlugin({ handlers: { shared } });
  engine.use(ecs).use(render).use(ui3d);
  // 測試用：固定字寬的介面
  (ui3d.controller as unknown as { options: { createUI: unknown } }).options.createUI = () =>
    UI2D.create({ container: null, width: 400, height: 300, measure: measure.fixed(0.5) });
  const hit = vi.fn();
  const e = ecs.world.spawn(
    UIPanel3D.with({ xml: XML, width: 400, height: 300, worldWidth: 4, handlers: { hit }, ...panel }),
  );
  // 面板 4×3 世界單位，中心在原點
  const step = async () => {
    ui3d.controller.update();
    // 等待非同步載入（第一次要載入排版引擎）
    for (let i = 0; i < 50 && ecs.world.get(e, UIPanel3D)?.status === 'loading'; i++) {
      await new Promise((r) => setTimeout(r, 5));
      ui3d.controller.update();
    }
    const group = ecs.world.get(e, SceneObject)!.object!;
    if (!group.parent) render.scene.add(group);
    group.updateMatrixWorld(true);
  };
  await step();
  /** 世界座標 → 畫面座標（-1~1） */
  const ndc = (x: number, y: number, z = 0) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [v.x, v.y] as const;
  };
  /** 面板介面像素 → 世界座標（面板在 z=0 平面） */
  const world = (px: number, py: number) => [(px / 400 - 0.5) * 4, (0.5 - py / 300) * 3] as const;
  const at = (px: number, py: number) => ndc(...world(px, py));
  return { engine, ecs, ui3d, render, e, hit, shared, step, ndc, at, camera };
}

describe('UIPanel3D 面板', () => {
  test('載入 XML、建立平面（尺寸依比例）、填入 ui 與狀態', async () => {
    const { ecs, e } = await setup();
    const data = ecs.world.get(e, UIPanel3D)!;
    expect(data.status).toBe('ready');
    expect(data.ui?.require<UILabel>('title').text).toBe('標題');
    const group = ecs.world.get(e, SceneObject)!.object!;
    const mesh = group.children[0] as THREE.Mesh<THREE.PlaneGeometry>;
    expect([mesh.geometry.parameters.width, mesh.geometry.parameters.height]).toEqual([4, 3]);
    expect((mesh.material as THREE.MeshBasicMaterial).map).toBeInstanceOf(THREE.CanvasTexture);
    expect(group.visible).toBe(true);
  });

  test('改尺寸會重建平面並重新排版；改 xml 會重新載入', async () => {
    const { ecs, e, step } = await setup();
    const data = ecs.world.get(e, UIPanel3D)!;
    data.worldWidth = 2;
    data.width = 200;
    data.height = 200;
    await step();
    const mesh = ecs.world.get(e, SceneObject)!.object!.children[0] as THREE.Mesh<THREE.PlaneGeometry>;
    expect([mesh.geometry.parameters.width, mesh.geometry.parameters.height]).toEqual([2, 2]);
    expect(data.ui!.size).toEqual({ width: 200, height: 200 });

    const old = data.ui;
    data.xml = '<UI><UILabel id="title">新的</UILabel></UI>';
    await step();
    expect(data.ui).not.toBe(old);
    expect(data.ui!.require<UILabel>('title').text).toBe('新的');
  });

  test('XML 錯誤：狀態為 error、不顯示', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ecs, e } = await setup({ xml: '<UI><UILabel></UI>' });
    expect(ecs.world.get(e, UIPanel3D)!.status).toBe('error');
    expect(ecs.world.get(e, SceneObject)!.object!.visible).toBe(false);
    err.mockRestore();
  });

  test('移除元件會釋放面板', async () => {
    const { ecs, e, ui3d } = await setup();
    const ui = ecs.world.get(e, UIPanel3D)!.ui!;
    const destroy = vi.spyOn(ui, 'destroy');
    ecs.world.remove(e, UIPanel3D);
    expect(destroy).toHaveBeenCalled();
    expect(ui3d.controller.panels.size).toBe(0);
    expect(ecs.world.get(e, SceneObject)).toBeUndefined();
  });
});

describe('UI3D 射線操作', () => {
  test('射線打到面板 → 換算成介面座標', async () => {
    const { ui3d, at, ndc } = await setup();
    const h = ui3d.hitTest(...at(100, 50))!;
    expect(h).not.toBeNull();
    expect(h.x).toBeCloseTo(100, 3);
    expect(h.y).toBeCloseTo(50, 3);
    expect(h.distance).toBeCloseTo(Math.hypot(...([(100 / 400 - 0.5) * 4, (0.5 - 50 / 300) * 3] as const), 5), 3);
    // 面板外
    expect(ui3d.hitTest(...ndc(3, 0))).toBeNull();
  });

  test('點擊按鈕：呼叫面板的處理函式；點到透明處不攔截', async () => {
    const { ui3d, at, hit } = await setup();
    expect(ui3d.pointer('down', ...at(100, 50))).toBe(true);
    expect(ui3d.pointer('up', ...at(100, 50))).toBe(true);
    expect(hit).toHaveBeenCalledTimes(1);
    // 按鈕右邊的空白
    expect(ui3d.pointer('down', ...at(300, 50))).toBe(false);
  });

  test('拖曳滑桿：按下後移出面板範圍也繼續跟著', async () => {
    const { ui3d, at, ndc, ecs, e } = await setup();
    const slider = ecs.world.get(e, UIPanel3D)!.ui!.require<UISlider>('s');
    const y = slider.absoluteRect.y + 20;
    const t = slider.trackRange();
    ui3d.pointer('down', ...at(t.x0 + 1, y));
    ui3d.pointer('move', ...at((t.x0 + t.x1) / 2, y));
    expect(slider.value).toBeGreaterThan(40);
    expect(slider.value).toBeLessThan(60);
    ui3d.pointer('move', ...ndc(4, 0)); // 遠超過面板右邊
    expect(slider.value).toBe(100);
    ui3d.pointer('up', ...ndc(4, 0));
    expect(ui3d.cursor).not.toBe('grabbing');
  });

  test('被前面的物體擋住就點不到；depthTest=false 的面板不會被擋', async () => {
    const { ui3d, at, render, ecs, e, step } = await setup();
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    blocker.position.set(...([(100 / 400 - 0.5) * 4, (0.5 - 50 / 300) * 3] as const), 2);
    render.scene.add(blocker);
    render.scene.updateMatrixWorld(true);
    expect(ui3d.hitTest(...at(100, 50))).toBeNull();
    expect(ui3d.hitTest(...at(350, 250))).not.toBeNull(); // 沒擋到的地方
    ecs.world.get(e, UIPanel3D)!.depthTest = false;
    await step();
    expect(ui3d.hitTest(...at(100, 50))).not.toBeNull();
  });

  test('背面：雙面可以點（座標鏡像一致），單面點不到', async () => {
    const { ui3d, at, camera, ecs, e, step } = await setup();
    camera.position.set(0, 0, -5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(ui3d.hitTest(...at(100, 50))?.x).toBeCloseTo(100, 3);
    ecs.world.get(e, UIPanel3D)!.doubleSided = false;
    await step();
    expect(ui3d.hitTest(...at(100, 50))).toBeNull();
  });

  test('不可互動的面板不攔截事件', async () => {
    const { ui3d, at, hit, ecs, e } = await setup();
    ecs.world.get(e, UIPanel3D)!.interactive = false;
    expect(ui3d.pointer('down', ...at(100, 50))).toBe(false);
    ui3d.pointer('up', ...at(100, 50));
    expect(hit).not.toHaveBeenCalled();
  });

  test('面板旋轉、移動後座標仍正確；共用處理函式', async () => {
    const { ui3d, ecs, e, camera, ndc, shared, step } = await setup({
      xml: '<UI><UIButton width="400" height="300" onClick="shared"/></UI>',
    });
    await step();
    const group = ecs.world.get(e, SceneObject)!.object!;
    group.position.set(1, 0, -2);
    group.rotation.y = Math.PI / 6;
    group.updateMatrixWorld(true);
    // 面板上 (300, 75) 的世界位置
    const local = new THREE.Vector3((300 / 400 - 0.5) * 4, (0.5 - 75 / 300) * 3, 0);
    const w = local.applyMatrix4(group.matrixWorld);
    const h = ui3d.hitTest(...ndc(w.x, w.y, w.z))!;
    expect(h.x).toBeCloseTo(300, 2);
    expect(h.y).toBeCloseTo(75, 2);
    ui3d.pointer('down', ...ndc(w.x, w.y, w.z));
    ui3d.pointer('up', ...ndc(w.x, w.y, w.z));
    expect(shared).toHaveBeenCalledTimes(1);
    // 建立後才註冊的共用處理函式（setHandler）：已經載入的面板也會用新的
    const later = vi.fn();
    ui3d.setHandler('shared', later);
    ui3d.pointer('down', ...ndc(w.x, w.y, w.z));
    ui3d.pointer('up', ...ndc(w.x, w.y, w.z));
    expect(later).toHaveBeenCalledTimes(1);
    expect(shared).toHaveBeenCalledTimes(1);
    void camera;
  });

  test('billboard：面板轉向攝影機', async () => {
    const { ui3d, ecs, e, camera } = await setup({ billboard: true });
    camera.position.set(5, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    ui3d.controller.faceCamera(camera);
    const mesh = ecs.world.get(e, SceneObject)!.object!.children[0];
    mesh.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal.x).toBeCloseTo(1, 5);
  });
});

describe('UIPanel3D 的尺寸來自介面檔 <UI width height>', () => {
  const meshSize = (ecs: EcsPlugin, e: Entity) => {
    const mesh = ecs.world.get(e, SceneObject)!.object!.children[0] as THREE.Mesh<THREE.PlaneGeometry>;
    return [mesh.geometry.parameters.width, mesh.geometry.parameters.height].map((n) => Math.round(n * 1000) / 1000);
  };

  test('沒指定 width、height：用 <UI width="480" height="240">，面板比例跟著它', async () => {
    const { ecs, e } = await setup({
      xml: '<UI width="480" height="240"><UILabel id="title">標題</UILabel></UI>',
      width: 0,
      height: 0,
    });
    const data = ecs.world.get(e, UIPanel3D)!;
    expect(data.ui!.size).toEqual({ width: 480, height: 240 });
    expect(meshSize(ecs, e)).toEqual([4, 2]); // worldWidth 4，高度依 480:240
  });

  test('元件上指定的 width、height 優先', async () => {
    const { ecs, e } = await setup({
      xml: '<UI width="480" height="240"><UILabel id="title">標題</UILabel></UI>',
      width: 400,
      height: 400,
    });
    expect(ecs.world.get(e, UIPanel3D)!.ui!.size).toEqual({ width: 400, height: 400 });
    expect(meshSize(ecs, e)).toEqual([4, 4]);
  });

  test('只寫高度：寬度用預設值；auto 或沒寫：預設 512 × 384', async () => {
    const a = await setup({
      xml: '<UI width="auto" height="200"><UILabel id="title">標題</UILabel></UI>',
      width: 0,
      height: 0,
    });
    expect(a.ecs.world.get(a.e, UIPanel3D)!.ui!.size).toEqual({ width: DEFAULT_PANEL_SIZE.width, height: 200 });
    const b = await setup({ xml: '<UI><UILabel id="title">標題</UILabel></UI>', width: 0, height: 0 });
    expect(b.ecs.world.get(b.e, UIPanel3D)!.ui!.size).toEqual({ ...DEFAULT_PANEL_SIZE });
  });

  test('換成另一份介面檔：重新讀它的寬高', async () => {
    const { ecs, e, step } = await setup({
      xml: '<UI width="480" height="240"><UILabel id="title">a</UILabel></UI>',
      width: 0,
      height: 0,
    });
    const data = ecs.world.get(e, UIPanel3D)!;
    data.xml = '<UI width="300" height="300"><UILabel id="title">b</UILabel></UI>';
    await step();
    expect(data.ui!.size).toEqual({ width: 300, height: 300 });
    expect(meshSize(ecs, e)).toEqual([4, 4]);
  });
});
