/**
 * 效能監視器套件：FPS、每幀時間、各階段 CPU 時間、記憶體、GPU 繪製統計、引擎物件數量。
 *
 * 面板由引擎內的 2D 繪圖器畫出（不使用 HTML），按 ` 鍵顯示／隱藏。可以用滑鼠（或手指）拖到畫面任何地方，位置會記住。
 * 程式也可以讀取數據：world.getResource(PerfStatsKey)
 *
 * 安裝：
 *   import perfMonitor from './packages/perf-monitor';
 *   await plugins.install(perfMonitor, { toggleKey: 'Backquote' });
 *
 * 這個套件只透過 ctx.api 使用引擎的類別（不另外打包 three.js 與引擎），
 * 型別與資源鍵則從引擎匯入，可以獨立發布成 npm 套件。
 */
import { define } from '../ecs';
import type { Phase } from '../core/Loop';
import type { Time } from '../core/Time';
import type { PluginContext } from '../plugins/PluginManager';
import { define as pluginApi } from '../plugins';
import type { RenderPlugin } from '../render/RenderPlugin';
import type { Attrs, UI2D, UIContext, UIElement } from '../ui2d';

export interface PerfStats {
  /** 每秒幀數 */
  fps: number;
  /** 每幀時間（毫秒）：平均、最低、最高 */
  frameMs: number;
  frameMinMs: number;
  frameMaxMs: number;
  /** 最近的每幀時間（畫曲線用） */
  history: number[];
  /** 各階段平均每幀的 CPU 時間（毫秒） */
  cpu: Record<Phase, number>;
  /** 所有階段加總 */
  cpuTotalMs: number;
  /** JS 記憶體（MB）；瀏覽器不支援時為 null（目前只有 Chrome 系列提供） */
  memory: { usedMB: number; totalMB: number; limitMB: number } | null;
  /** GPU 繪製統計（平均每幀）；沒有繪製外掛時為 null */
  gpu: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
    programs: number;
  } | null;
  /** 繪製解析度：像素比與畫布像素尺寸（動態解析度會調整）；沒有繪製外掛時為 null */
  resolution: { pixelRatio: number; width: number; height: number } | null;
  entities: number;
  /**
   * 介面重畫（2D 介面畫在畫布上再上傳到 GPU）：每秒次數、每次平均與最久的毫秒、畫布模式。
   * 重畫發生在引擎的更新階段之外，不算在 cpu 裡；沒有介面時為 null
   */
  ui: { perSecond: number; avgMs: number; peakMs: number; mode: 'cpu' | 'gpu' } | null;
  /** 剛體、粒子、聲音數量；沒有對應外掛時為 null */
  bodies: number | null;
  particles: number | null;
  sounds: number | null;
}

/** 程式讀取效能數據：world.getResource(PerfStatsKey) */
export const PerfStatsKey = define.resource<PerfStats>('PerfStats');

export interface PerfMonitorOptions {
  /** 顯示／隱藏的按鍵（KeyboardEvent.code），預設 Backquote（` 鍵）；null 為不綁定 */
  toggleKey?: string | null;
  /** 一開始是否顯示，預設 true */
  visible?: boolean;
  /** 面板更新間隔（秒），預設 0.25；越短越即時，但重畫介面本身也有成本 */
  interval?: number;
  /** 自動把面板加到介面上（需要 UI2D），預設 true；false 時請自己在 XML 裡寫 <UIPerfMonitor/> */
  overlay?: boolean;
  /** 面板位置（overlay 時），預設右上角 */
  position?: { top?: number; right?: number; bottom?: number; left?: number };
  /** 可以拖曳移動，預設 true；false 時滑鼠會穿透面板（點擊、滾輪傳給後面的遊戲） */
  draggable?: boolean;
  /** 記住拖曳後的位置（存在瀏覽器的 localStorage，重新整理後還在），預設 true */
  rememberPosition?: boolean;
}

const POSITION_KEY = 'hero.perfMonitor.offset';

const PHASES: Phase[] = ['input', 'fixedUpdate', 'update', 'lateUpdate', 'render'];
const PHASE_LABELS: Record<Phase, string> = {
  input: '輸入',
  fixedUpdate: '物理',
  update: '更新',
  lateUpdate: '後更新',
  render: '繪製',
};
const HISTORY = 120;
/** 量測用的極端優先度：在每個階段的最前面與最後面 */
const FIRST = -1e15;
const LAST = 1e15;

const emptyStats = (): PerfStats => ({
  fps: 0,
  frameMs: 0,
  frameMinMs: 0,
  frameMaxMs: 0,
  history: [],
  cpu: { input: 0, fixedUpdate: 0, update: 0, lateUpdate: 0, render: 0 },
  cpuTotalMs: 0,
  memory: null,
  gpu: null,
  resolution: null,
  ui: null,
  entities: 0,
  bodies: null,
  particles: null,
  sounds: null,
});

const fmt = (n: number, digits = 1) => n.toFixed(digits);
const fmtCount = (n: number) =>
  n >= 1e6
    ? `${fmt(n / 1e6)}M`
    : n >= 1e4
      ? `${fmt(n / 1e3, 0)}k`
      : n >= 1e3
        ? `${fmt(n / 1e3)}k`
        : String(Math.round(n));

export default pluginApi.plugin<PerfMonitorOptions>({
  name: 'engine/perf-monitor',
  version: '1.0.0',
  description: '效能監視器：FPS、每幀時間、CPU、記憶體、GPU 繪製統計',
  author: 'engine',
  engine: '^0.1.0',
  requires: ['ecs'],

  setup(ctx: PluginContext, options: PerfMonitorOptions) {
    const api = ctx.api;
    const engine = ctx.engine;
    const world = ctx.world;
    const interval = options.interval ?? 0.25;
    const stats = emptyStats();
    ctx.setResource(PerfStatsKey, stats);

    // ───────── 量測 ─────────

    const now = () => performance.now();
    const phaseStart: Partial<Record<Phase, number>> = {};
    const phaseAcc: Record<Phase, number> = { input: 0, fixedUpdate: 0, update: 0, lateUpdate: 0, render: 0 };
    let frames = 0;
    let elapsed = 0;
    let frameSum = 0;
    let frameMin = Infinity;
    let frameMax = 0;
    const gpuAcc = { calls: 0, triangles: 0, points: 0, lines: 0 };

    // 每個階段前後各放一個量測點（固定步長一幀可能跑好幾次，所以累加）
    for (const phase of PHASES) {
      ctx.on(
        phase,
        () => {
          phaseStart[phase] = now();
        },
        FIRST,
      );
      ctx.on(
        phase,
        () => {
          phaseAcc[phase] += now() - (phaseStart[phase] ?? now());
        },
        LAST,
      );
    }

    // GPU：three.js 每次 render() 都會重設統計；後製、介面疊加會呼叫好幾次，
    // 所以改成手動在每幀結束時重設，才能得到整幀的總和
    const render = engine.getPlugin<RenderPlugin>('render');
    const info = render ? render.renderer.info : null;
    if (info) {
      const autoReset = info.autoReset;
      info.autoReset = false;
      ctx.onDispose(() => {
        info.autoReset = autoReset;
      });
    }

    // 每幀最後（繪製之後）統計
    ctx.on(
      'render',
      (time: Time) => {
        // 用真實的幀間隔（不受 maxDelta 限制），卡頓才看得出來
        if (time.realDelta <= 0) return;
        frames++;
        const ms = time.realDelta * 1000;
        elapsed += time.realDelta;
        frameSum += ms;
        frameMin = Math.min(frameMin, ms);
        frameMax = Math.max(frameMax, ms);
        stats.history.push(ms);
        if (stats.history.length > HISTORY) stats.history.shift();
        if (info) {
          // drawCalls：這一幀的繪製次數（WebGPURenderer 的 calls 是從開始到現在的累計，不會歸零）
          gpuAcc.calls += (info.render as { drawCalls?: number }).drawCalls ?? info.render.calls;
          gpuAcc.triangles += info.render.triangles;
          gpuAcc.points += info.render.points;
          gpuAcc.lines += info.render.lines;
          info.reset();
        }
        if (elapsed >= interval) publish();
      },
      LAST + 1,
    );

    const uiLast = { renders: 0, ms: 0 };

    function publish(): void {
      stats.fps = frames / elapsed;
      stats.frameMs = frameSum / frames;
      stats.frameMinMs = frameMin;
      stats.frameMaxMs = frameMax;
      let total = 0;
      for (const p of PHASES) {
        stats.cpu[p] = phaseAcc[p] / frames;
        total += stats.cpu[p];
        phaseAcc[p] = 0;
      }
      stats.cpuTotalMs = total;
      const mem = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      stats.memory = mem
        ? {
            usedMB: mem.usedJSHeapSize / 1048576,
            totalMB: mem.totalJSHeapSize / 1048576,
            limitMB: mem.jsHeapSizeLimit / 1048576,
          }
        : null;
      stats.gpu = info
        ? {
            calls: gpuAcc.calls / frames,
            triangles: gpuAcc.triangles / frames,
            points: gpuAcc.points / frames,
            lines: gpuAcc.lines / frames,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            // 著色器程式的數量（WebGPU 的統計有的話）
            programs: (info as { programs?: unknown[] | null }).programs?.length ?? 0,
          }
        : null;
      stats.resolution = render
        ? {
            pixelRatio: render.pixelRatio,
            width: Math.round(render.size.width * render.pixelRatio),
            height: Math.round(render.size.height * render.pixelRatio),
          }
        : null;
      const uiStats = (world.getResource(api.ui2d.UIKey) as UI2D | undefined)?.renderStats ?? null;
      if (uiStats) {
        const renders = uiStats.renders - uiLast.renders;
        const ms = uiStats.ms - uiLast.ms;
        stats.ui = {
          perSecond: renders / elapsed,
          avgMs: renders ? ms / renders : 0,
          peakMs: uiStats.peakMs,
          mode: uiStats.mode,
        };
        uiLast.renders = uiStats.renders;
        uiLast.ms = uiStats.ms;
        uiStats.peakMs = 0;
      } else {
        stats.ui = null;
      }
      stats.entities = world.entityCount;
      // 物理、粒子、音效是可有可無的模組：遊戲有提供才統計
      const physicsApi = ctx.optionalApi('physics');
      const particlesApi = ctx.optionalApi('particles');
      const audioApi = ctx.optionalApi('audio');
      const physics = physicsApi ? world.getResource(physicsApi.PhysicsKey) : undefined;
      stats.bodies = physics ? physics.world.bodies.len() : null;
      stats.particles = particlesApi ? (world.getResource(particlesApi.ParticlesKey)?.totalParticles ?? null) : null;
      stats.sounds = audioApi ? (world.getResource(audioApi.AudioKey)?.activeCount ?? null) : null;
      frames = 0;
      elapsed = 0;
      frameSum = 0;
      frameMin = Infinity;
      frameMax = 0;
      gpuAcc.calls = gpuAcc.triangles = gpuAcc.points = gpuAcc.lines = 0;
      for (const m of monitors) {
        // 視窗縮小後：被拖到邊緣的面板拉回畫面內
        if ((m as UIElement & { keepOnScreen?(): boolean }).keepOnScreen?.()) m.ctx.invalidate?.();
        m.invalidate();
      }
    }

    // ───────── 面板（引擎內繪製的自訂介面元件） ─────────

    const monitors = new Set<UIElement>();
    let visible = options.visible ?? true;
    const draggable = options.draggable ?? true;
    const remember = options.rememberPosition ?? true;
    /** 拖曳後的位移（相對 position 指定的位置）；換介面檔重新建立面板時沿用 */
    let offset = { x: 0, y: 0 };
    if (draggable && remember) {
      try {
        const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null;
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') offset = { x: saved.x, y: saved.y };
      } catch {
        // 無痕模式、封鎖網站資料：不記住位置
      }
    }
    const savePosition = () => {
      if (!remember) return;
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(offset));
      } catch {
        // 同上
      }
    };

    class UIPerfMonitor extends api.ui2d.UIElement {
      constructor(uiCtx: UIContext, type: string, raw: Attrs) {
        super(uiCtx, type, raw);
        monitors.add(this);
        this.offsetX = offset.x;
        this.offsetY = offset.y;
      }

      override get interactive(): boolean {
        return draggable;
      }

      /** 拖曳移動：只改位移，不影響排版；整個面板保持在畫面內 */
      override pointerDown(px: number, py: number) {
        if (!draggable) return null;
        const start = { x: this.offsetX, y: this.offsetY, px, py };
        return {
          move: (x: number, y: number) => {
            this.ctx.damage?.(this, 8);
            this.offsetX = start.x + x - start.px;
            this.offsetY = start.y + y - start.py;
            this.keepOnScreen();
            this.ctx.damage?.(this, 8);
            this.ctx.invalidate?.();
          },
          up: () => {
            offset = { x: this.offsetX, y: this.offsetY };
            savePosition();
          },
        };
      }

      /** 位移後不能超出畫面（視窗縮小時也會拉回來） */
      keepOnScreen(): boolean {
        const vp = this.ctx.viewport?.();
        if (!vp) return false;
        const r = this.absoluteRect;
        const bx = r.x - this.offsetX;
        const by = r.y - this.offsetY;
        const ox = Math.min(vp.width - r.width - bx, Math.max(-bx, this.offsetX));
        const oy = Math.min(vp.height - r.height - by, Math.max(-by, this.offsetY));
        if (ox === this.offsetX && oy === this.offsetY) return false;
        this.offsetX = ox;
        this.offsetY = oy;
        return true;
      }

      override defaults(): Attrs {
        return {
          width: '292',
          height: '223',
          background: 'rgba(8,10,14,0.84)',
          radius: '8',
          border: '1 rgba(255,255,255,0.10)',
          // 可以拖曳時顯示抓取的游標；不能拖曳時只顯示資訊，滑鼠點擊、滾輪穿透到後面的遊戲
          ...(draggable ? { cursor: 'grab' } : { pointerEvents: 'none' }),
        };
      }

      override destroy(): void {
        monitors.delete(this);
        super.destroy();
      }

      override paintContent(
        c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
      ): void {
        const s = stats;
        const pad = 10;
        const mono = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        c.textBaseline = 'middle';
        c.textAlign = 'left';
        // 文字一律裁切在面板內
        c.beginPath();
        c.rect(x, y, w, 1e4);
        c.clip();

        // 標題列：FPS（依流暢度變色）
        const color = s.fps >= 55 ? '#7ee787' : s.fps >= 30 ? '#f2cc60' : '#ff7b72';
        c.font = 'bold 12px system-ui, -apple-system, "PingFang TC", sans-serif';
        c.fillStyle = '#c9d1d9';
        c.fillText('效能', x + pad, y + 14);
        c.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, monospace';
        c.fillStyle = color;
        const fpsText = `${Math.round(s.fps)} FPS`;
        c.fillText(fpsText, x + w - pad - c.measureText(fpsText).width, y + 14);

        // 每幀時間曲線：16.7ms（60 FPS）與 33.3ms（30 FPS）參考線
        const gx = x + pad;
        const gy = y + 26;
        const gw = w - pad * 2;
        const gh = 40;
        c.fillStyle = 'rgba(255,255,255,0.04)';
        c.fillRect(gx, gy, gw, gh);
        const maxMs = Math.max(40, ...s.history);
        const yOf = (ms: number) => gy + gh - (Math.min(ms, maxMs) / maxMs) * gh;
        c.strokeStyle = 'rgba(255,255,255,0.15)';
        c.lineWidth = 1;
        for (const ref of [1000 / 60, 1000 / 30]) {
          c.beginPath();
          c.moveTo(gx, yOf(ref));
          c.lineTo(gx + gw, yOf(ref));
          c.stroke();
        }
        const bw = gw / HISTORY;
        s.history.forEach((ms, i) => {
          c.fillStyle = ms <= 17.5 ? '#3fb950' : ms <= 34 ? '#d29922' : '#f85149';
          const top = yOf(ms);
          c.fillRect(gx + (HISTORY - s.history.length + i) * bw, top, Math.max(1, bw - 0.3), gy + gh - top);
        });

        // 數據
        c.font = mono;
        const lines: [string, string][] = [
          ['每幀', `${fmt(s.frameMs)} ms（${fmt(s.frameMinMs)}～${fmt(s.frameMaxMs)}）`],
          ['CPU', `${fmt(s.cpuTotalMs, 2)} ms／幀`],
          // 最耗時的三個階段
          [
            '階段',
            [...PHASES]
              .sort((a, b) => s.cpu[b] - s.cpu[a])
              .slice(0, 3)
              .filter((p) => s.cpu[p] >= 0.05)
              .map((p) => `${PHASE_LABELS[p]} ${fmt(s.cpu[p])}`)
              .join('　') || '—',
          ],
          [
            '記憶體',
            s.memory
              ? `${fmt(s.memory.usedMB)} / ${fmt(s.memory.totalMB)} MB（上限 ${fmt(s.memory.limitMB, 0)}）`
              : '不支援（僅 Chrome 系列提供）',
          ],
          [
            '解析度',
            s.resolution ? `${fmt(s.resolution.pixelRatio, 2)}x（${s.resolution.width}×${s.resolution.height}）` : '—',
          ],
          ['GPU', s.gpu ? `${fmtCount(s.gpu.calls)} 次繪製　${fmtCount(s.gpu.triangles)} 三角形` : '—'],
          // 介面重畫在引擎的階段之外：卡頓卻看不到 CPU 時間時，看這一行
          [
            '介面',
            s.ui
              ? `重畫 ${fmt(s.ui.perSecond, 0)}/秒　平均 ${fmt(s.ui.avgMs)}　最久 ${fmt(s.ui.peakMs)} ms${s.ui.mode === 'cpu' ? '（CPU）' : ''}`
              : '—',
          ],
          ['資源', s.gpu ? `幾何 ${s.gpu.geometries}　貼圖 ${s.gpu.textures}　著色器 ${s.gpu.programs}` : '—'],
          [
            '物件',
            [
              `實體 ${s.entities}`,
              s.bodies !== null ? `剛體 ${s.bodies}` : '',
              s.particles !== null ? `粒子 ${fmtCount(s.particles)}` : '',
              s.sounds !== null ? `聲音 ${s.sounds}` : '',
            ]
              .filter(Boolean)
              .join('　'),
          ],
        ];
        lines.forEach(([label, value], i) => {
          const ly = gy + gh + 13 + i * 15;
          c.fillStyle = '#8b949e';
          c.fillText(label, x + pad, ly);
          c.fillStyle = '#e6edf3';
          c.fillText(value, x + pad + 46, ly);
        });
      }
    }
    ctx.registerUIComponent('UIPerfMonitor', UIPerfMonitor);

    // 自動加到介面上（每次載入新的介面都會再加回去）
    const ui = world.getResource(api.ui2d.UIKey) as UI2D | undefined;
    let overlay: UIElement | null = null;
    const attach = (root: UIElement) => {
      if (options.overlay === false) return;
      const pos = options.position ?? { top: 100, right: 16 };
      const attrs: Attrs = { id: 'perfMonitor', position: 'absolute' };
      for (const [k, v] of Object.entries(pos)) if (v !== undefined) attrs[k] = String(v);
      if (!visible) attrs.hidden = 'true';
      overlay = ui!.createElement('UIPerfMonitor', attrs);
      root.add(overlay);
      ui!.requestLayout(true);
    };
    if (ui) {
      if (ui.root) attach(ui.root);
      ctx.onDispose(ui.onLoad(attach));
      ctx.onDispose(() => {
        overlay?.destroy();
        ui.requestLayout(true);
      });
    } else if (options.overlay !== false) {
      ctx.log('沒有安裝 UIPlugin：不顯示面板，數據可由 PerfStatsKey 讀取');
    }

    // 顯示／隱藏
    const setVisible = (v: boolean) => {
      visible = v;
      for (const m of monitors) m.visible = v;
    };
    const toggleKey = options.toggleKey === undefined ? 'Backquote' : options.toggleKey;
    if (toggleKey && typeof window !== 'undefined') {
      // 直接聽瀏覽器事件：遊戲暫停時也能切換
      const onKey = (e: KeyboardEvent) => {
        if (e.code === toggleKey && !e.repeat) setVisible(!visible);
      };
      window.addEventListener('keydown', onKey);
      ctx.onDispose(() => window.removeEventListener('keydown', onKey));
    }
    // 讓程式也能切換：world.getResource(PerfMonitorKey)?.toggle()
    ctx.setResource(PerfMonitorKey, {
      toggle: () => setVisible(!visible),
      show: () => setVisible(true),
      hide: () => setVisible(false),
      get visible() {
        return visible;
      },
    });
  },
});

/** 程式控制面板顯示：world.getResource(PerfMonitorKey)?.toggle() */
export const PerfMonitorKey = define.resource<{
  toggle(): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
}>('PerfMonitor');
