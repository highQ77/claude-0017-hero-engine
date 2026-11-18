/**
 * 輸入狀態（不依賴瀏覽器 DOM，方便測試）。
 * 事件隨時寫入，每幀開頭由 update() 結算「這一幀按下 / 放開」。
 */

/** 標準手把按鍵編號（W3C Standard Gamepad） */
export const GamepadButton = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  LS: 10,
  RS: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
  Home: 16,
} as const;
/** 手把按鈕名稱（A、B、X、Y、LB、RB…），綁定時寫 'Pad:A' */
export type GamepadButtonName = keyof typeof GamepadButton;

/** 標準手把軸：左搖桿 X/Y、右搖桿 X/Y（Y 軸往上為負） */
export const GamepadAxis = { LeftX: 0, LeftY: 1, RightX: 2, RightY: 3 } as const;

/** 滑鼠按鍵名稱，綁定時寫 'Mouse:Left' */
export type MouseButtonName = 'Left' | 'Middle' | 'Right' | 'Back' | 'Forward';
const MOUSE_BUTTONS: readonly MouseButtonName[] = ['Left', 'Middle', 'Right', 'Back', 'Forward'];

/**
 * 綁定字串：
 * - 鍵盤：KeyboardEvent.code，例如 'KeyW'、'Space'、'ArrowLeft'、'ShiftLeft'
 * - 滑鼠：'Mouse:Left'、'Mouse:Right'、'Mouse:Middle'
 * - 手把：'Pad:A'（任一手把）、'Pad0:A'（指定第 0 支）
 */
export type Binding = string;

/** 一組按鍵的狀態：按住、這一幀按下、這一幀放開 */
export class ButtonSet {
  private readonly down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private nextPressed = new Set<string>();
  private nextReleased = new Set<string>();

  /** 按下（引擎內部呼叫） */
  press(id: string): void {
    if (this.down.has(id)) return;
    this.down.add(id);
    this.nextPressed.add(id);
  }

  /** 放開（引擎內部呼叫） */
  release(id: string): void {
    if (!this.down.delete(id)) return;
    this.nextReleased.add(id);
  }

  /** 全部放開（例如視窗失去焦點時） */
  releaseAll(): void {
    for (const id of [...this.down]) this.release(id);
  }

  /** @internal 每幀結算 */
  _commit(): void {
    this.pressed = this.nextPressed;
    this.released = this.nextReleased;
    this.nextPressed = new Set();
    this.nextReleased = new Set();
  }

  /** 現在是否按著 */
  isDown(id: string): boolean {
    return this.down.has(id);
  }

  /** 這一幀剛按下（即使同一幀內又放開也算） */
  wasPressed(id: string): boolean {
    return this.pressed.has(id);
  }

  /** 這一幀是否剛放開 */
  wasReleased(id: string): boolean {
    return this.released.has(id);
  }

  /** 目前按著的所有按鍵 */
  get held(): ReadonlySet<string> {
    return this.down;
  }
}

/** 一個指標（滑鼠或一根手指） */
export interface PointerInfo {
  /** 指標編號（每根手指不同） */
  id: number;
  /** 指標類型：mouse、touch、pen */
  type: string;
  /** 目前的 X（畫布座標，像素） */
  x: number;
  /** 目前的 Y（畫布座標，像素） */
  y: number;
  /** 按下時的 X */
  startX: number;
  /** 按下時的 Y */
  startY: number;
}

/** 主要指標（滑鼠或第一根手指） */
export class PointerState {
  /** 相對於目標元素左上角的座標（CSS 像素） */
  x = 0;
  /** 指標的 Y（畫布座標，像素，往下為正） */
  y = 0;
  /** 正規化裝置座標 -1~1（給射線點選用），Y 往上為正 */
  ndcX = 0;
  /** 指標的 Y（-1 底部 ~ 1 頂部；給 render.pick 用） */
  ndcY = 0;
  /** 這一幀的移動量（指標鎖定時也有效） */
  deltaX = 0;
  /** 這一幀垂直移動了多少（像素） */
  deltaY = 0;
  /** 這一幀的滾輪量（往下為正） */
  wheel = 0;
  /** 是否在目標元素內 */
  inside = false;
  /** 是否處於指標鎖定（第一人稱視角常用） */
  locked = false;
  /** 所有按下中的指標（多點觸控） */
  readonly active = new Map<number, PointerInfo>();

  private accDX = 0;
  private accDY = 0;
  private accWheel = 0;

  /** @internal */
  _move(x: number, y: number, width: number, height: number, dx: number, dy: number): void {
    this.x = x;
    this.y = y;
    this.ndcX = width > 0 ? (x / width) * 2 - 1 : 0;
    this.ndcY = height > 0 ? -((y / height) * 2 - 1) : 0;
    this.inside = x >= 0 && y >= 0 && x <= width && y <= height;
    this.accDX += dx;
    this.accDY += dy;
  }

  /** @internal */
  _wheel(dy: number): void {
    this.accWheel += dy;
  }

  /** @internal */
  _commit(): void {
    this.deltaX = this.accDX;
    this.deltaY = this.accDY;
    this.wheel = this.accWheel;
    this.accDX = this.accDY = this.accWheel = 0;
  }
}

/** 單支手把的狀態 */
export class GamepadState {
  /** 是否連接中 */
  connected = false;
  /** 手把的名稱（瀏覽器提供） */
  id = '';
  /** 已套用死區的軸數值 -1~1 */
  axes: number[] = [];
  /** 類比按鍵數值 0~1（例如板機） */
  values: number[] = [];
  /** 手把按鈕的狀態 */
  readonly buttons = new ButtonSet();

  /** @internal */
  _poll(pad: Gamepad | null, deadzone: number): void {
    if (!pad?.connected) {
      if (this.connected) this.buttons.releaseAll();
      this.connected = false;
      this.axes = [];
      this.values = [];
      this.buttons._commit();
      return;
    }
    this.connected = true;
    this.id = pad.id;
    this.axes = pad.axes.map((v) => applyDeadzone(v, deadzone));
    this.values = pad.buttons.map((b) => b.value);
    pad.buttons.forEach((b, i) => (b.pressed ? this.buttons.press(String(i)) : this.buttons.release(String(i))));
    this.buttons._commit();
  }
}

function applyDeadzone(v: number, deadzone: number): number {
  const abs = Math.abs(v);
  if (abs < deadzone) return 0;
  return Math.sign(v) * Math.min(1, (abs - deadzone) / (1 - deadzone));
}

/** Input 的設定 */
export interface InputStateOptions {
  /** 搖桿死區，預設 0.15 */
  deadzone?: number;
  /** 取得手把清單（預設 navigator.getGamepads） */
  getGamepads?: () => readonly (Gamepad | null)[];
}

/**
 * 輸入：鍵盤、滑鼠／觸控、手把，以及動作對應。
 */
export class Input {
  /** 鍵盤（KeyboardEvent.code，例如 'KeyW'、'Space'） */
  readonly keyboard = new ButtonSet();
  /** 滑鼠按鍵（'Left'、'Middle'、'Right'…） */
  readonly mouse = new ButtonSet();
  /** 滑鼠／觸控的位置、移動量、滾輪 */
  readonly pointer = new PointerState();
  /** 已連接的手把 */
  readonly gamepads: GamepadState[] = [];
  /** 動作綁定：把按鍵對應到動作名稱（jump、moveX…），遊戲邏輯只看動作 */
  readonly actions: ActionMap;
  /** 搖桿的死區（0~1，小於這個值視為 0） */
  deadzone: number;
  private readonly getGamepads: () => readonly (Gamepad | null)[];
  private primaryPointer: number | null = null;

  constructor(options: InputStateOptions = {}) {
    this.deadzone = options.deadzone ?? 0.15;
    this.getGamepads =
      options.getGamepads ??
      (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    this.actions = new ActionMap(this);
  }

  // ───────── 查詢 ─────────

  /** 現在是否按著（綁定字串：'KeyW'、'Mouse:Left'、'Pad:A'） */
  isDown(binding: Binding): boolean {
    return this.resolve(binding, 'down');
  }

  /** 這一幀是否剛按下 */
  wasPressed(binding: Binding): boolean {
    return this.resolve(binding, 'pressed');
  }

  /** 這一幀是否剛放開 */
  wasReleased(binding: Binding): boolean {
    return this.resolve(binding, 'released');
  }

  /** 第一支已連線的手把 */
  get gamepad(): GamepadState | undefined {
    return this.gamepads.find((p) => p.connected);
  }

  // ───────── 事件輸入（由 InputPlugin 呼叫，測試時也可以直接呼叫） ─────────

  /** 按下鍵盤按鍵（輸入外掛呼叫；測試時可以直接呼叫模擬） */
  keyDown(code: string): void {
    this.keyboard.press(code);
  }

  /** 放開鍵盤按鍵 */
  keyUp(code: string): void {
    this.keyboard.release(code);
  }

  /** 指標移動（輸入外掛呼叫） */
  pointerMove(x: number, y: number, width: number, height: number, dx = 0, dy = 0, id?: number): void {
    if (id !== undefined) {
      const info = this.pointer.active.get(id);
      if (info) {
        info.x = x;
        info.y = y;
      }
      if (this.primaryPointer !== null && id !== this.primaryPointer) return;
    }
    this.pointer._move(x, y, width, height, dx, dy);
  }

  /** 指標按下（輸入外掛呼叫） */
  pointerDown(id: number, button: number, x: number, y: number, type = 'mouse'): void {
    this.pointer.active.set(id, { id, type, x, y, startX: x, startY: y });
    if (this.primaryPointer === null) this.primaryPointer = id;
    if (id === this.primaryPointer || type === 'mouse') {
      const name = MOUSE_BUTTONS[button];
      if (name) this.mouse.press(name);
    }
  }

  /** 指標放開（輸入外掛呼叫） */
  pointerUp(id: number, button: number): void {
    const info = this.pointer.active.get(id);
    this.pointer.active.delete(id);
    if (id === this.primaryPointer || info?.type === 'mouse') {
      const name = MOUSE_BUTTONS[button];
      if (name) this.mouse.release(name);
    }
    if (id === this.primaryPointer) this.primaryPointer = null;
  }

  /** 滾輪捲動（輸入外掛呼叫） */
  wheel(dy: number): void {
    this.pointer._wheel(dy);
  }

  /** 視窗失去焦點：放開所有按鍵，避免按鍵卡住 */
  blur(): void {
    this.keyboard.releaseAll();
    this.mouse.releaseAll();
    this.pointer.active.clear();
    this.primaryPointer = null;
  }

  /** 每幀開頭呼叫：結算按下／放開、移動量，並讀取手把 */
  update(): void {
    this.keyboard._commit();
    this.mouse._commit();
    this.pointer._commit();
    const pads = this.getGamepads();
    for (let i = 0; i < Math.max(pads.length, this.gamepads.length); i++) {
      (this.gamepads[i] ??= new GamepadState())._poll(pads[i] ?? null, this.deadzone);
    }
  }

  // ───────── 內部 ─────────

  private resolve(binding: Binding, query: 'down' | 'pressed' | 'released'): boolean {
    const check = (set: ButtonSet, id: string) =>
      query === 'down' ? set.isDown(id) : query === 'pressed' ? set.wasPressed(id) : set.wasReleased(id);

    if (binding.startsWith('Mouse:')) return check(this.mouse, binding.slice(6));

    const pad = /^Pad(\d*):(\w+)$/.exec(binding);
    if (pad) {
      const index = GamepadButton[pad[2] as GamepadButtonName];
      if (index === undefined) throw new Error(`未知的手把按鍵：${binding}`);
      const id = String(index);
      if (pad[1] !== '') return check(this.gamepads[Number(pad[1])]?.buttons ?? EMPTY, id);
      return this.gamepads.some((p) => p.connected && check(p.buttons, id));
    }
    return check(this.keyboard, binding);
  }
}

const EMPTY = new ButtonSet();

/** 軸的綁定：負方向、正方向的按鍵，以及手把搖桿 */
export interface AxisDefinition {
  /** 往負方向的按鍵 */
  negative?: Binding[];
  /** 往正方向的按鍵 */
  positive?: Binding[];
  /** 對應的手把軸編號（見 GamepadAxis） */
  padAxis?: number;
  /** 反轉手把軸（例如讓搖桿往上為正） */
  invertPad?: boolean;
}

/**
 * 動作對應：把「跳躍」「移動」這類遊戲動作對應到多個按鍵，
 * 遊戲邏輯只問動作，不直接問按鍵，方便改鍵與支援多種裝置。
 */
export class ActionMap {
  private readonly buttons = new Map<string, Binding[]>();
  private readonly axes = new Map<string, AxisDefinition>();

  constructor(private readonly input: Input) {}

  /** 定義按鍵動作 @example actions.bind('jump', ['Space', 'Pad:A']) */
  bind(action: string, bindings: Binding[]): this {
    this.buttons.set(action, [...bindings]);
    return this;
  }

  /** 定義軸動作 @example actions.bindAxis('moveX', { negative: ['KeyA'], positive: ['KeyD'], padAxis: GamepadAxis.LeftX }) */
  bindAxis(action: string, definition: AxisDefinition): this {
    this.axes.set(action, { ...definition });
    return this;
  }

  /** 動作綁定了哪些按鍵 */
  bindingsOf(action: string): readonly Binding[] {
    return this.buttonBindings(action);
  }

  /** 動作現在是否按著（任一個綁定的按鍵按著） */
  isDown(action: string): boolean {
    return this.buttonBindings(action).some((b) => this.input.isDown(b));
  }

  /** 動作這一幀是否剛按下 */
  wasPressed(action: string): boolean {
    return this.buttonBindings(action).some((b) => this.input.wasPressed(b));
  }

  /** 動作這一幀是否剛放開 */
  wasReleased(action: string): boolean {
    // 所有綁定都已放開，且至少有一個是這一幀放開的
    const bindings = this.buttonBindings(action);
    return bindings.some((b) => this.input.wasReleased(b)) && !bindings.some((b) => this.input.isDown(b));
  }

  /** 軸數值 -1~1：按鍵與手把搖桿取絕對值較大者 */
  axis(action: string): number {
    const def = this.axes.get(action);
    if (!def) throw new Error(`未定義的軸動作「${action}」`);
    const keys =
      (def.positive?.some((b) => this.input.isDown(b)) ? 1 : 0) -
      (def.negative?.some((b) => this.input.isDown(b)) ? 1 : 0);
    let stick = 0;
    if (def.padAxis !== undefined) {
      for (const pad of this.input.gamepads) {
        if (!pad.connected) continue;
        const v = (pad.axes[def.padAxis] ?? 0) * (def.invertPad ? -1 : 1);
        if (Math.abs(v) > Math.abs(stick)) stick = v;
      }
    }
    return Math.abs(stick) > Math.abs(keys) ? stick : keys;
  }

  private buttonBindings(action: string): readonly Binding[] {
    const b = this.buttons.get(action);
    if (!b) throw new Error(`未定義的動作「${action}」`);
    return b;
  }
}
