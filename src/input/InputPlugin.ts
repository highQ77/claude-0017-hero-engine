import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import { Input, type InputStateOptions } from './Input';
import { InputKey } from './keys';
export { InputKey } from './keys';

/** InputPlugin 的設定 */
export interface InputPluginOptions extends InputStateOptions {
  /** 指標事件的目標元素；預設為繪製外掛的畫布，沒有時為 document.body */
  target?: HTMLElement;
  /** 在目標上停用右鍵選單，預設 true */
  preventContextMenu?: boolean;
  /** 阻止空白鍵、方向鍵捲動頁面，預設 true */
  preventScrollKeys?: boolean;
}

/** 每幀結算輸入的優先度（input 階段最前面） */
export const INPUT_PRIORITY = -1000;

const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

/** 焦點在文字輸入框時不攔截按鍵 */
function isTyping(e: Event): boolean {
  const el = e.target as HTMLElement | null;
  return (
    !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
  );
}

/**
 * 輸入外掛：把瀏覽器事件接到 Input。需先安裝 EcsPlugin。
 * 若已安裝 RenderPlugin，指標座標以畫布為基準，可直接配合 render.pick() 點選物件。
 */
export class InputPlugin implements Plugin {
  readonly name = 'input';
  readonly dependencies = ['ecs'] as const;
  /** 輸入狀態（也可以用 world.requireResource(InputKey) 取得） */
  readonly input: Input;
  private cleanup: (() => void)[] = [];
  private world: World | null = null;
  private target: HTMLElement | null = null;

  constructor(private readonly options: InputPluginOptions = {}) {
    this.input = new Input(options);
  }

  /** 要求指標鎖定（必須在使用者點擊等事件中呼叫） */
  requestPointerLock(): void {
    this.target?.requestPointerLock();
  }

  /** 離開滑鼠鎖定（第一人稱視角用） */
  exitPointerLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  }

  install(engine: Engine): void {
    const world = engine.getPlugin<EcsPlugin>('ecs')!.world;
    this.world = world;
    world.setResource(InputKey, this.input);
    this.cleanup.push(engine.on('input', () => this.input.update(), INPUT_PRIORITY));
    if (typeof window !== 'undefined') this.attachDom(engine);
  }

  uninstall(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.world?.getResource(InputKey) === this.input) this.world.removeResource(InputKey);
    this.world = this.target = null;
  }

  private attachDom(engine: Engine): void {
    const input = this.input;
    const opts = this.options;
    const target = opts.target ?? engine.getPlugin<RenderPlugin>('render')?.renderer.domElement ?? document.body;
    this.target = target;

    const listen = <K extends keyof WindowEventMap>(
      el: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, options);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, options));
    };

    const local = (e: { clientX: number; clientY: number }) => {
      const r = target.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };

    // 鍵盤（掛在 window，畫布不需要焦點）
    listen(window, 'keydown', (e) => {
      if (isTyping(e)) return;
      if ((opts.preventScrollKeys ?? true) && SCROLL_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) input.keyDown(e.code);
    });
    listen(window, 'keyup', (e) => input.keyUp(e.code));
    listen(window, 'blur', () => input.blur());

    // 指標：按下只在目標上算，移動和放開掛在 window（拖曳到外面也能收到）
    target.style.touchAction = 'none';
    listen(target, 'pointerdown', (e) => {
      const p = local(e);
      input.pointerMove(p.x, p.y, p.w, p.h, 0, 0);
      input.pointerDown(e.pointerId, e.button, p.x, p.y, e.pointerType);
      target.setPointerCapture?.(e.pointerId);
    });
    listen(window, 'pointermove', (e) => {
      const p = local(e);
      input.pointerMove(p.x, p.y, p.w, p.h, e.movementX, e.movementY, e.pointerId);
    });
    listen(window, 'pointerup', (e) => input.pointerUp(e.pointerId, e.button));
    listen(window, 'pointercancel', (e) => input.pointerUp(e.pointerId, e.button));
    listen(
      target,
      'wheel',
      (e) => {
        e.preventDefault(); // 在畫布上滾動不捲動頁面
        input.wheel(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
      },
      { passive: false },
    );
    if (opts.preventContextMenu ?? true) listen(target, 'contextmenu', (e) => e.preventDefault());
    const onLockChange = () => {
      input.pointer.locked = document.pointerLockElement === target;
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', onLockChange));
  }
}
