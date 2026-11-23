/**
 * 素材預覽小視窗：在素材面板雙擊素材時打開（畫面區域裡的浮動視窗，可以拖曳標題列移動、拉右下角改大小，
 * 「⛶ 全畫面」放大到填滿整個頁面）。
 *
 * - 圖檔：圖片與尺寸（透明的地方顯示棋盤格）
 * - 模型（.gltf、.glb）：可以旋轉、縮放的 3D 預覽，有動畫時可以選片段播放；顯示頂點、三角形數
 * - 預製物件（.xml、.json）、節點圖（.shader.json）：可以直接編輯原始碼（XML 上色），「儲存」或 ⌘/Ctrl+S 存回檔案
 * - 音效：播放器
 *
 * 下面的按鈕做原本雙擊的事（放進場景、套用到選取的物件）。
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { highlightXml } from '../ui-editor/highlight';
import { showConfirm } from '../shared/dialog';
import { h } from '../shared/dom';
import type { AssetRef } from './assets';

/** 預覽視窗需要編輯器提供的動作 */
export interface AssetPreviewActions {
  /** 原本雙擊的動作：放進場景／套用到選取的物件 */
  place(asset: AssetRef): void;
  /** 在著色器編輯器打開節點圖 */
  openShader(url: string): void;
  /** 在音效編輯器打開音效（url 是 .sfx.json） */
  openSound(url: string): void;
  /** 存回編輯過的原始碼（預製物件、節點圖）；格式錯誤或不能存時丟出錯誤（訊息會顯示在視窗下方） */
  saveText(asset: AssetRef, text: string): Promise<void>;
}

/** 下面主要按鈕的文字（原本雙擊做的事） */
const PLACE_LABEL: Record<AssetRef['kind'], string> = {
  prefab: '放進場景',
  model: '放進場景',
  texture: '套用到選取的物件',
  audio: '加到選取的物件',
  shader: '套用到選取的物件',
};

const KIND_LABEL: Record<AssetRef['kind'], string> = {
  prefab: '預製物件',
  model: '模型',
  texture: '貼圖',
  audio: '音效',
  shader: '節點圖',
};

/** 音檔 → 音效編輯器的參數檔（sounds/coin.wav → sounds/coin.sfx.json） */
const sfxOf = (path: string) => path.replace(/\.[a-z0-9]+$/i, '.sfx.json');

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

let gltfLoader: Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader> | null = null;
/** 和引擎一樣的 glTF 載入器（支援 meshopt 壓縮） */
const loadGltf = async (url: string): Promise<GLTF> => {
  gltfLoader ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
    ]);
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  })();
  return (await gltfLoader).loadAsync(url);
};

export class AssetPreview {
  private readonly win: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly info: HTMLElement;
  private readonly placeBtn: HTMLButtonElement;
  private readonly shaderBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly fullBtn: HTMLButtonElement;
  /** 編輯中的原始碼（不是文字檔時是 null） */
  private editing: { original: string; area: HTMLTextAreaElement } | null = null;
  private asset: AssetRef | null = null;
  /** 關閉時要做的清理（3D 預覽的繪製器、音效） */
  private cleanup: (() => void) | null = null;
  /** 第幾次打開（換素材時，舊的載入晚到不套用） */
  private serial = 0;

  constructor(
    host: HTMLElement,
    private readonly actions: AssetPreviewActions,
  ) {
    this.win = h('div', 'asset-win');
    this.win.hidden = true;
    const head = h('div', 'asset-win-head');
    this.title = h('span', 'asset-win-title');
    // 全畫面：放大到填滿整個頁面（再按一次、Esc 或雙擊標題列恢復）
    this.fullBtn = h('button', 'small-btn', '⛶ 全畫面');
    this.fullBtn.addEventListener('click', () => this.setFull(!this.full));
    head.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('button')) this.setFull(!this.full); // 雙擊標題列也可以切換
    });
    const close = h('button', 'small-btn', '✕');
    close.title = '關閉（Esc）';
    close.addEventListener('click', () => this.close());
    head.append(this.title, this.fullBtn, close);
    this.body = h('div', 'asset-win-body');
    const foot = h('div', 'asset-win-foot');
    this.info = h('span', 'asset-win-info');
    this.shaderBtn = h('button', 'small-btn', '在著色器編輯器打開 ↗');
    this.shaderBtn.addEventListener('click', () => this.asset && this.actions.openShader(this.asset.path));
    this.placeBtn = h('button', 'small-btn on');
    this.placeBtn.addEventListener('click', () => this.asset && this.actions.place(this.asset));
    this.saveBtn = h('button', 'small-btn', '儲存');
    this.saveBtn.title = '存回檔案（⌘/Ctrl+S）';
    this.saveBtn.addEventListener('click', () => void this.save());
    this.soundBtn = h('button', 'small-btn', '在音效編輯器打開 ↗');
    this.soundBtn.title = '這個音效是音效編輯器做的：打開它的合成參數（.sfx.json）';
    this.soundBtn.addEventListener('click', () => this.asset && this.actions.openSound(sfxOf(this.asset.path)));
    this.soundBtn.hidden = true;
    foot.append(this.info, this.saveBtn, this.shaderBtn, this.soundBtn, this.placeBtn);
    this.win.append(head, this.body, foot);
    host.append(this.win);
    this.makeDraggable(head, host);
    // Esc 關閉（在編輯器的快速鍵之前處理）
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && !this.win.hidden) {
          e.stopImmediatePropagation();
          // 全畫面時先恢復成小視窗，再按一次才關閉
          if (this.full) this.setFull(false);
          else void this.close();
        }
      },
      true,
    );
  }

  /** 是否開著 */
  get isOpen(): boolean {
    return !this.win.hidden;
  }

  /** 打開（已經開著時換成這個素材） */
  async open(asset: AssetRef): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.stop();
    const serial = ++this.serial;
    this.asset = asset;
    this.win.hidden = false;
    this.title.textContent = '';
    this.title.append(h('b', '', KIND_LABEL[asset.kind]), ` ${asset.path}`);
    this.title.title = asset.path;
    this.placeBtn.textContent = PLACE_LABEL[asset.kind];
    this.shaderBtn.hidden = asset.kind !== 'shader';
    this.soundBtn.hidden = true;
    // 音效編輯器做的音效（旁邊有同名的 .sfx.json）：可以打開來編輯
    if (asset.kind === 'audio')
      void fetch(sfxOf(asset.path), { cache: 'no-store' })
        .then((r) => {
          if (alive() && r.ok && r.headers.get('Content-Type')?.includes('json')) this.soundBtn.hidden = false;
        })
        .catch(() => {});
    this.info.textContent = '';
    this.body.replaceChildren(h('div', 'asset-win-msg', '載入中…'));
    const alive = () => serial === this.serial && !this.win.hidden;
    const fail = (error: unknown) => {
      if (alive()) this.body.replaceChildren(h('div', 'asset-win-msg error', `無法預覽：${(error as Error).message}`));
    };
    if (asset.kind === 'texture') this.showImage(asset.path, alive);
    else if (asset.kind === 'model') this.showModel(asset.path, alive).catch(fail);
    else if (asset.kind === 'audio') this.showAudio(asset.path);
    else this.showText(asset.path, alive).catch(fail);
  }

  /** 關閉 */
  async close(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.setFull(false);
    this.stop();
    this.serial++;
    this.win.hidden = true;
    this.asset = null;
  }

  /** 是否放大成全畫面 */
  private get full(): boolean {
    return this.win.classList.contains('full');
  }

  /** 切換全畫面（填滿整個頁面） */
  private setFull(on: boolean): void {
    this.win.classList.toggle('full', on);
    this.fullBtn.textContent = on ? '⛶ 恢復' : '⛶ 全畫面';
    this.fullBtn.title = on ? '恢復成小視窗（Esc）' : '放大到整個畫面（再按一次或 Esc 恢復）';
    this.fullBtn.classList.toggle('on', on);
  }

  private stop(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.editing = null;
    this.saveBtn.hidden = true;
  }

  /** 原始碼改過還沒存 */
  get dirty(): boolean {
    return !!this.editing && this.editing.area.value !== this.editing.original;
  }

  private async confirmDiscard(): Promise<boolean> {
    return (
      !this.dirty ||
      (await showConfirm(`${this.asset?.path ?? '這個檔案'} 有沒儲存的修改，要放棄嗎？`, {
        title: '放棄修改',
        ok: '放棄修改',
        danger: true,
      }))
    );
  }

  private updateDirty(): void {
    const ed = this.editing;
    if (!ed) return;
    this.saveBtn.disabled = !this.dirty;
    this.saveBtn.classList.toggle('on', this.dirty);
    this.info.classList.remove('error');
    this.info.title = '';
    this.info.textContent = this.dirty
      ? '● 已修改，還沒儲存'
      : `${formatSize(new Blob([ed.area.value]).size)}，${ed.area.value.split('\n').length} 行`;
  }

  private async save(): Promise<void> {
    const ed = this.editing;
    const asset = this.asset;
    if (!ed || !asset || !this.dirty) return;
    const text = ed.area.value;
    this.saveBtn.disabled = true;
    try {
      await this.actions.saveText(asset, text);
      if (this.editing !== ed) return;
      ed.original = text;
      this.updateDirty();
      this.info.textContent = `已儲存 ${asset.path}`;
    } catch (error) {
      if (this.editing !== ed) return;
      this.saveBtn.disabled = false;
      this.info.classList.add('error');
      this.info.textContent = `沒有儲存：${(error as Error).message}`;
      this.info.title = this.info.textContent;
    }
  }

  // ───────── 各種素材 ─────────

  private showImage(url: string, alive: () => boolean): void {
    const img = h('img', 'asset-win-img');
    img.alt = url;
    img.onload = () => {
      if (alive()) this.info.textContent = `${img.naturalWidth} × ${img.naturalHeight} 像素`;
    };
    img.onerror = () => {
      if (alive()) this.body.replaceChildren(h('div', 'asset-win-msg error', '圖片載入失敗'));
    };
    img.src = url;
    const box = h('div', 'asset-win-checker');
    box.append(img);
    this.body.replaceChildren(box);
  }

  private showAudio(url: string): void {
    const audio = h('audio');
    audio.controls = true;
    audio.src = url;
    audio.addEventListener('loadedmetadata', () => {
      this.info.textContent = `${audio.duration.toFixed(2)} 秒`;
    });
    const box = h('div', 'asset-win-center');
    box.append(audio);
    this.body.replaceChildren(box);
    this.cleanup = () => audio.pause();
  }

  /** 文字檔：可以編輯的原始碼（XML 用上色的底層 + 透明文字的輸入框疊在一起） */
  private async showText(url: string, alive: () => boolean): Promise<void> {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    if (!alive()) return;
    const xml = /\.xml$/i.test(url);
    const wrap = h('div', `asset-win-editor${xml ? ' xml' : ''}`);
    const hl = h('pre', 'asset-win-hl');
    hl.setAttribute('aria-hidden', 'true');
    const code = h('code');
    hl.append(code);
    const area = h('textarea', 'asset-win-text');
    area.spellcheck = false;
    area.value = text;
    area.setAttribute('aria-label', `${url} 的原始碼`);
    wrap.append(hl, area);
    this.body.replaceChildren(wrap);

    let raf = 0;
    const paint = () => {
      raf = 0;
      if (xml) code.innerHTML = `${highlightXml(area.value)}\n`;
    };
    const sync = () => {
      code.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    };
    paint();
    area.addEventListener('input', () => {
      raf ||= requestAnimationFrame(paint);
      this.updateDirty();
    });
    area.addEventListener('scroll', sync);
    area.addEventListener('keydown', (e) => {
      // 這裡的快速鍵不交給編輯器（⌘S 存這個檔案，不是存場景）
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save();
      } else if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '  '); // 保留瀏覽器的復原
      }
    });
    this.editing = { original: text, area };
    this.saveBtn.hidden = false;
    this.updateDirty();
    this.cleanup = () => cancelAnimationFrame(raf);
  }

  private async showModel(url: string, alive: () => boolean): Promise<void> {
    const gltf = await loadGltf(url);
    if (!alive()) return;
    const canvas = h('canvas', 'asset-win-canvas');
    const wrap = h('div', 'asset-win-3d');
    wrap.append(canvas);
    this.body.replaceChildren(wrap);

    const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    await renderer.init();
    if (!alive()) {
      renderer.dispose();
      return;
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const model = gltf.scene;
    scene.add(model);

    // 鏡頭對準模型的範圍
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100);
    camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(radius * 2.6));
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.update();

    // 頂點、三角形數
    let verts = 0;
    let tris = 0;
    model.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!(o as THREE.Mesh).isMesh || !g) return;
      verts += g.attributes.position?.count ?? 0;
      tris += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
    });
    const dims = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} 公尺`;
    this.info.textContent = `${verts.toLocaleString()} 個頂點、${Math.round(tris).toLocaleString()} 個三角形，${dims}`;

    // 動畫片段
    const mixer = new THREE.AnimationMixer(model);
    if (gltf.animations.length) {
      const select = h('select', 'asset-win-clip');
      select.title = '播放的動畫片段';
      select.add(new Option('（不播放動畫）', ''));
      for (const clip of gltf.animations)
        select.add(new Option(`${clip.name || '（沒有名稱）'}  ${clip.duration.toFixed(1)}s`, clip.name));
      const play = (name: string) => {
        mixer.stopAllAction();
        const clip = gltf.animations.find((c) => c.name === name);
        if (clip) mixer.clipAction(clip).play();
      };
      select.addEventListener('change', () => play(select.value));
      select.value = gltf.animations[0].name;
      play(select.value);
      wrap.append(select);
    }

    // THREE.Timer：three.js r183 起取代 THREE.Clock（每幀先 update 再讀 getDelta）
    const timer = new THREE.Timer();
    let raf = 0;
    const frame = (now?: number) => {
      raf = requestAnimationFrame(frame);
      timer.update(now);
      const w = canvas.clientWidth;
      const ht = canvas.clientHeight;
      if (w && ht && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / ht)) {
        renderer.setSize(w, ht, false);
        camera.aspect = w / ht;
        camera.updateProjectionMatrix();
      }
      mixer.update(timer.getDelta());
      controls.update();
      renderer.render(scene, camera);
    };
    frame();
    this.cleanup = () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      mixer.stopAllAction();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
    };
  }

  // ───────── 拖曳移動 ─────────

  private makeDraggable(handle: HTMLElement, host: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button') || this.full) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, left: this.win.offsetLeft, top: this.win.offsetTop };
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const maxX = host.clientWidth - 80;
        const maxY = host.clientHeight - 40;
        this.win.style.left = `${Math.min(maxX, Math.max(0, start.left + ev.clientX - start.x))}px`;
        this.win.style.top = `${Math.min(maxY, Math.max(0, start.top + ev.clientY - start.y))}px`;
        this.win.style.right = 'auto';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}
