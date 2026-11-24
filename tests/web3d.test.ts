import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/ecs';
import { SceneObject } from '../src/render/components';
import { WebPanel3D, WebPanel3DController } from '../src/web3d';

// Node 沒有網頁：用最小的假元素（只記錄樣式、子元素、內容）
class FakeElement {
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  innerHTML = '';
  className = '';
  src = '';
  allow = '';
  removed = false;
  parentNode: FakeElement | null = null;
  ownerDocument = { defaultView: { Element: FakeElement } };
  constructor(readonly tag: string) {}
  setAttribute(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  replaceChildren(): void {
    this.children = [];
    this.innerHTML = '';
  }
  remove(): void {
    this.removed = true;
  }
}
beforeAll(() => vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) }));
afterAll(() => vi.unstubAllGlobals());

function setup(init: Partial<Parameters<typeof WebPanel3D.with>[0]> = {}) {
  const world = new World();
  const controller = new WebPanel3DController(world);
  const e = world.spawn(WebPanel3D.with({ width: 800, height: 400, worldWidth: 2, ...init }));
  controller.update();
  const st = controller.panels.get(e)!;
  return { world, controller, e, st, data: world.get(e, WebPanel3D)! };
}

describe('3D 網頁面板（WebPanel3D）', () => {
  test('src：建立 iframe；面板的群組放進 SceneObject，洞的平面和網頁一樣大', () => {
    const { world, e, st, data } = setup({ src: 'pages/a.html' });
    expect(data.element).toBe(st.element);
    expect(data.iframe).not.toBeNull();
    expect((data.iframe as unknown as FakeElement).src).toBe('pages/a.html');
    expect(world.get(e, SceneObject)?.object).toBe(st.group);
    expect(st.element.style.width).toBe('800px');
    expect(st.element.style.height).toBe('400px');
    const box = new THREE.Box3().setFromObject(st.hole);
    expect(box.max.x - box.min.x).toBeCloseTo(2);
    expect(box.max.y - box.min.y).toBeCloseTo(1); // 2 × 400 / 800
    // 洞：不混合、透明度 0（把畫布的顏色與 alpha 寫成 0），射線打到時找得到面板
    const m = st.hole.material as THREE.MeshBasicMaterial;
    expect(m.blending).toBe(THREE.NoBlending);
    expect(m.opacity).toBe(0);
  });

  test('換成 html：iframe 拿掉、內容放進元素；改尺寸時重建洞', () => {
    const { controller, st, data } = setup({ src: 'pages/a.html' });
    data.src = '';
    data.html = '<b>你好</b>';
    data.worldWidth = 4;
    controller.update();
    expect(data.iframe).toBeNull();
    expect(st.element.innerHTML).toBe('<b>你好</b>');
    const box = new THREE.Box3().setFromObject(st.hole);
    expect(box.max.x - box.min.x).toBeCloseTo(4);
  });

  test('interactive=false：網頁不接收滑鼠', () => {
    const { st } = setup({ html: 'x', interactive: false });
    expect(st.element.style.pointerEvents).toBe('none');
  });

  test('sync：網頁跟著面板（像素換成世界單位）；有一角跑到攝影機後面時網頁和洞一起隱藏', () => {
    const { controller, st } = setup({ html: 'x' });
    st.group.position.set(1, 2, 0);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 2, 5);
    controller.sync(camera);
    expect(st.element.style.display).toBe('');
    expect(st.hole.visible).toBe(true);
    const p = new THREE.Vector3().setFromMatrixPosition(st.css.matrix);
    expect(p.toArray()).toEqual([1, 2, 0]);
    expect(new THREE.Vector3().setFromMatrixScale(st.css.matrix).x).toBeCloseTo(2 / 800);
    // 攝影機站在面板的平面上（左右兩角一前一後）
    camera.position.set(1, 2, 0.5);
    camera.lookAt(-5, 2, 0.5);
    controller.sync(camera);
    expect(st.element.style.display).toBe('none');
    expect(st.hole.visible).toBe(false);
    // 隱藏的群組：網頁也隱藏
    camera.position.set(0, 2, 5);
    camera.lookAt(1, 2, 0);
    st.group.visible = false;
    controller.sync(camera);
    expect(st.element.style.display).toBe('none');
  });

  test('移除元件：元素移除、網頁層的場景清空', () => {
    const { world, controller, e, st } = setup({ html: 'x' });
    world.remove(e, WebPanel3D);
    expect((st.element as unknown as FakeElement).removed).toBe(true);
    expect(controller.panels.size).toBe(0);
    expect(controller.cssScene.children.length).toBe(0);
    controller.dispose();
  });

  test('panelOfHole：射線打到洞時找得到面板', () => {
    const { controller, st } = setup({ html: 'x' });
    expect(controller.panelOfHole(st.hole)).toBe(st);
    expect(controller.panelOfHole(new THREE.Object3D())).toBeNull();
  });
});
