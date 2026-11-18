/**
 * 調整面板套件（lil-gui）：遊戲執行中即時調整參數，不用改程式、重新整理。
 *
 * 內建的分類（有安裝對應外掛的才會出現）：
 *   引擎　時間縮放、暫停／繼續、逐幀、FPS、實體數量
 *   繪製　背景顏色、目前的 3D 解析度
 *   後製　色調映射、曝光、光暈、暗角、反鋸齒
 *   物理　重力、碰撞形狀線框
 *   音效　總音量與各群組音量、靜音
 * 也可以加自己的參數：world.getResource(InspectorKey)!.gui.add(物件, '屬性', 最小, 最大)
 *
 * 安裝：
 *   import inspector from '@engine/packages/inspector';
 *   await plugins.install(inspector, { toggleKey: 'KeyI' });
 *
 * 面板是 HTML（lil-gui），蓋在遊戲畫面上；點面板不會傳給遊戲，在數字欄打字時也不會觸發遊戲按鍵。
 * three.js 與引擎模組透過 ctx.api 取得；lil-gui 是這個套件自己的依賴（npm install lil-gui）。
 */
import GUI, { type Controller } from 'lil-gui';
import type { Time } from '../core';
import { define } from '../ecs';
import { define as pluginApi, type PluginContext } from '../plugins';
import type { AntialiasMode, PostProcessingPlugin, ToneMappingName } from '../postfx';
import type { PhysicsPlugin } from '../physics';
import type { RenderPlugin } from '../render';

export type InspectorPanel = 'engine' | 'render' | 'postfx' | 'physics' | 'audio';

export interface InspectorOptions {
  /** 顯示／隱藏的按鍵（KeyboardEvent.code），預設 KeyI；null 為不綁定 */
  toggleKey?: string | null;
  /** 一開始是否顯示，預設 true */
  visible?: boolean;
  /** 一開始是否收合成標題列，預設 false */
  closed?: boolean;
  /** 面板標題，預設「調整」 */
  title?: string;
  /** 要顯示的內建分類，預設全部（沒有對應外掛的會自動略過）；[] 只留自己加的參數 */
  panels?: InspectorPanel[];
  /** 面板位置（CSS 像素），預設右上角 { top: 8, right: 8 } */
  position?: { top?: number; right?: number; bottom?: number; left?: number };
  /** 面板寬度（CSS 像素），預設 260 */
  width?: number;
  /** 面板放在哪個元素裡，預設 document.body */
  container?: HTMLElement;
  /** 建立 lil-gui（測試可替換） */
  createGUI?: (options: { title: string; width: number; container?: HTMLElement }) => GUI;
}

export interface Inspector {
  /** lil-gui 的面板本身：gui.add()、gui.addColor()、gui.addFolder() … 用法見 https://lil-gui.georgealways.com/ */
  readonly gui: GUI;
  /** 內建的分類資料夾（沒有建立的是 undefined） */
  readonly folders: Partial<Record<InspectorPanel, GUI>>;
  readonly visible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  /** 加一個自己的分類（同名的會共用） */
  folder(title: string): GUI;
  /** 重新讀取所有欄位的值（程式改了數值、但欄位沒有 listen 時） */
  refresh(): void;
}

/** 取得調整面板：world.getResource(InspectorKey) */
export const InspectorKey = define.resource<Inspector>('Inspector');

const PANELS: InspectorPanel[] = ['engine', 'render', 'postfx', 'physics', 'audio'];
const TONE_MAPPINGS: Record<string, ToneMappingName> = {
  無: 'none',
  線性: 'linear',
  Reinhard: 'reinhard',
  Cineon: 'cineon',
  ACES: 'aces',
  AgX: 'agx',
  Neutral: 'neutral',
};
const ANTIALIAS: Record<string, AntialiasMode> = {
  自動: 'auto',
  MSAA: 'msaa',
  SMAA: 'smaa',
  FXAA: 'fxaa',
  關閉: 'none',
};
const VOLUME_LABELS: Record<string, string> = {
  master: '總音量',
  music: '音樂',
  sfx: '音效',
  ui: '介面',
  voice: '語音',
};

export default pluginApi.plugin<InspectorOptions>({
  name: 'engine/inspector',
  version: '1.0.0',
  description: '調整面板（lil-gui）：即時調整時間、繪製、後製、物理、音效與自訂參數',
  author: 'engine',
  engine: '^0.1.0',
  requires: ['ecs'],

  setup(ctx: PluginContext, options: InspectorOptions) {
    const engine = ctx.engine;
    const world = ctx.world;
    const api = ctx.api;
    const width = options.width ?? 260;
    const title = options.title ?? '調整';
    const gui =
      options.createGUI?.({ title, width, container: options.container }) ??
      new GUI({ title, width, autoPlace: !options.container, container: options.container });
    gui.domElement.classList.add('engine-inspector');
    // 位置：lil-gui 預設固定在右上角；有指定時改寫
    const pos = options.position;
    if (pos && !options.container) {
      const st = gui.domElement.style;
      st.position = 'fixed';
      for (const side of ['top', 'right', 'bottom', 'left'] as const)
        st[side] = pos[side] !== undefined ? `${pos[side]}px` : 'auto';
    }
    if (options.closed) gui.close();
    ctx.onDispose(() => gui.destroy());

    const folders: Partial<Record<InspectorPanel, GUI>> = {};
    const custom = new Map<string, GUI>();
    const wanted = new Set(options.panels ?? PANELS);

    // ───────── 引擎 ─────────
    if (wanted.has('engine')) {
      const f = (folders.engine = gui.addFolder('引擎'));
      const state = {
        get 時間縮放() {
          return engine.time.timeScale;
        },
        set 時間縮放(v: number) {
          engine.time.timeScale = v;
        },
        get 暫停() {
          return engine.state === 'paused';
        },
        set 暫停(v: boolean) {
          if (v) engine.pause();
          else engine.resume();
        },
        逐幀: () => {
          if (engine.state === 'running') engine.pause();
          engine.stepFrame();
        },
        fps: 0,
        實體: 0,
      };
      f.add(state, '時間縮放', 0, 3, 0.05).listen();
      f.add(state, '暫停').listen();
      f.add(state, '逐幀').name('逐幀（暫停中前進一幀）');
      f.add(state, 'fps').name('FPS').disable().listen();
      f.add(state, '實體').disable().listen();
      // 唯讀數字每 0.25 秒更新一次（每幀改寫數字會一直重畫面板）
      let acc = 0;
      ctx.on('render', (time: Time) => {
        acc += time.realDelta;
        if (acc < 0.25) return;
        acc = 0;
        state.fps = Math.round(time.fps);
        state.實體 = world.entityCount;
      });
    }

    // ───────── 繪製 ─────────
    const render = engine.getPlugin<RenderPlugin>('render');
    if (wanted.has('render') && render) {
      const f = (folders.render = gui.addFolder('繪製'));
      const bg = render.scene.background;
      if (bg instanceof api.THREE.Color) {
        const state = { 背景: `#${bg.getHexString()}` };
        f.addColor(state, '背景').onChange((v: string) => bg.set(v));
      }
      const info = { '3D 解析度': '' };
      const update = () =>
        (info['3D 解析度'] = `${render.pixelRatio.toFixed(2)}x（畫布 ${render.canvasPixelRatio.toFixed(2)}x）`);
      update();
      f.add(info, '3D 解析度').disable().listen();
      ctx.on('render', update);
    }

    // ───────── 後製 ─────────
    const postfx = engine.getPlugin<PostProcessingPlugin>('postfx');
    if (wanted.has('postfx') && postfx) {
      const s = postfx.settings;
      const f = (folders.postfx = gui.addFolder('後製'));
      f.add(s, 'toneMapping', TONE_MAPPINGS).name('色調映射').listen();
      f.add(s, 'exposure', 0, 3, 0.01).name('曝光').listen();
      f.add(s, 'antialias', ANTIALIAS).name('反鋸齒').listen();
      const bloom = f.addFolder('光暈');
      bloom.add(s.bloom, 'enabled').name('開啟').listen();
      bloom.add(s.bloom, 'strength', 0, 3, 0.01).name('強度').listen();
      bloom.add(s.bloom, 'radius', 0, 1, 0.01).name('範圍').listen();
      bloom.add(s.bloom, 'threshold', 0, 1, 0.01).name('門檻').listen();
      const vignette = f.addFolder('暗角');
      vignette.add(s.vignette, 'enabled').name('開啟').listen();
      vignette.add(s.vignette, 'darkness', 0, 3, 0.01).name('深淺').listen();
      vignette.add(s.vignette, 'offset', 0, 2, 0.01).name('範圍').listen();
      bloom.close();
      vignette.close();
    }

    // ───────── 物理 ─────────
    const physicsPlugin = engine.getPlugin<PhysicsPlugin>('physics');
    if (wanted.has('physics') && physicsPlugin) {
      const physics = physicsPlugin.physics;
      const f = (folders.physics = gui.addFolder('物理'));
      const state = {
        get 重力() {
          return physics.gravity.y;
        },
        set 重力(v: number) {
          physics.gravity = { ...physics.gravity, y: v };
        },
        get 碰撞形狀() {
          return physicsPlugin.debug;
        },
        set 碰撞形狀(v: boolean) {
          physicsPlugin.debug = v;
        },
      };
      f.add(state, '重力', -30, 10, 0.1).name('重力（Y）').listen();
      f.add(state, '碰撞形狀').name('顯示碰撞形狀').listen();
    }

    // ───────── 音效 ─────────
    const audioApi = ctx.optionalApi('audio');
    const audio = audioApi ? world.getResource(audioApi.AudioKey) : undefined;
    if (wanted.has('audio') && audio) {
      const f = (folders.audio = gui.addFolder('音效'));
      for (const group of ['master', ...audio.groupNames]) {
        const state = {
          get value() {
            return audio.getVolume(group);
          },
          set value(v: number) {
            audio.setVolume(group, v);
          },
        };
        f.add(state, 'value', 0, 1, 0.01)
          .name(VOLUME_LABELS[group] ?? group)
          .listen();
      }
      if (audio.groupNames.length) {
        const mute = {
          get 全部靜音() {
            return audio.isMuted('master');
          },
          set 全部靜音(v: boolean) {
            audio.setMuted('master', v);
          },
        };
        f.add(mute, '全部靜音').listen();
      }
      f.close();
    }

    // ───────── 顯示／隱藏 ─────────
    let visible = options.visible ?? true;
    const apply = () => gui.show(visible);
    apply();
    const inspector: Inspector = {
      gui,
      folders,
      get visible() {
        return visible;
      },
      show() {
        visible = true;
        apply();
      },
      hide() {
        visible = false;
        apply();
      },
      toggle() {
        visible = !visible;
        apply();
      },
      folder(name: string) {
        let f = custom.get(name);
        if (!f) custom.set(name, (f = gui.addFolder(name)));
        return f;
      },
      refresh() {
        for (const c of gui.controllersRecursive() as Controller[]) c.updateDisplay();
      },
    };
    ctx.setResource(InspectorKey, inspector);

    const key = options.toggleKey === undefined ? 'KeyI' : options.toggleKey;
    if (key && typeof window !== 'undefined') {
      const onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // 在欄位裡打字
        if (e.code === key && !e.repeat) inspector.toggle();
      };
      window.addEventListener('keydown', onKey);
      ctx.onDispose(() => window.removeEventListener('keydown', onKey));
    }
  },
});
