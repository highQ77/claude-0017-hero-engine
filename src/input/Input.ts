/**
 * 輸入狀態（不依賴瀏覽器 DOM，方便測試）。
 * 事件隨時寫入，每幀開頭由 update() 結算「這一幀按下 / 放開」。
 */

/** 標準手把按鍵編號（W3C Standard Gamepad） */
export const GamepadButton = {
  /** 下方的按鈕（Xbox A、PlayStation ✕、Switch B） */
  A: 0,
  /** 右方的按鈕（Xbox B、PlayStation ○、Switch A） */
  B: 1,
  /** 左方的按鈕（Xbox X、PlayStation □、Switch Y） */
  X: 2,
  /** 上方的按鈕（Xbox Y、PlayStation △、Switch X） */
  Y: 3,
  /** 左肩鍵（L1） */
  LB: 4,
  /** 右肩鍵（R1） */
  RB: 5,
  /** 左扳機（L2）；壓下的程度（0~1）是 input.gamepad?.values[GamepadButton.LT] */
  LT: 6,
  /** 右扳機（R2）；壓下的程度（0~1）是 input.gamepad?.values[GamepadButton.RT] */
  RT: 7,
  /** 選單左邊的鍵（Back、View、Share、−） */
  Back: 8,
  /** 選單右邊的鍵（Start、Menu、Options、＋） */
  Start: 9,
  /** 按下左搖桿（L3） */
  LS: 10,
  /** 按下右搖桿（R3） */
  RS: 11,
  /** 十字鍵：上 */
  Up: 12,
  /** 十字鍵：下 */
  Down: 13,
  /** 十字鍵：左 */
  Left: 14,
  /** 十字鍵：右 */
  Right: 15,
  /** 中央的主選單鍵（Xbox 鍵、PS 鍵、Home） */
  Home: 16,
} as const;
/** 手把按鈕名稱（A、B、X、Y、LB、RB…），綁定時寫 'Pad:A' */
export type GamepadButtonName = keyof typeof GamepadButton;

/** 標準手把軸：左搖桿 X/Y、右搖桿 X/Y（Y 軸往上為負） */
export const GamepadAxis = {
  /** 左搖桿左右（-1 左、1 右） */
  LeftX: 0,
  /** 左搖桿上下（-1 上、1 下） */
  LeftY: 1,
  /** 右搖桿左右（-1 左、1 右） */
  RightX: 2,
  /** 右搖桿上下（-1 上、1 下） */
  RightY: 3,
} as const;

/** 滑鼠按鍵名稱，綁定時寫 'Mouse:Left' */
export type MouseButtonName = 'Left' | 'Middle' | 'Right' | 'Back' | 'Forward';
const MOUSE_BUTTONS: readonly MouseButtonName[] = ['Left', 'Middle', 'Right', 'Back', 'Forward'];

/**
 * 綁定字串：
 * - 鍵盤：KeyboardEvent.code，例如 'KeyW'、'Space'、'ArrowLeft'、'ShiftLeft'
 * - 滑鼠：'Mouse:Left'、'Mouse:Right'、'Mouse:Middle'
 * - 手把：'Pad:A'（任一手把）、'Pad0:A'（指定第 0 支）
 * - 修飾鍵（不分左右）：'Ctrl'、'Shift'、'Alt'、'Meta'（Mac 的 Cmd、Windows 鍵）、'Mod'（Mac 是 Cmd，其他是 Ctrl）
 * - 組合鍵：修飾鍵 + 按鍵，例如 'Ctrl+KeyS'、'Mod+Shift+KeyZ'、'Shift+Mouse:Left'（手把不能組合）。
 *   組合鍵的修飾鍵要完全符合：'Ctrl+KeyS' 在按 Ctrl+Shift+S 時不成立。
 *   沒寫修飾鍵的綁定（'KeyS'）不管修飾鍵：按 Ctrl+S 時 'KeyS' 也成立（不要的話自己加上 !input.isDown('Ctrl')）
 */
export type Binding = string;

/** 修飾鍵名稱與對應的按鍵（左右兩邊都算） */
const MODIFIER_CODES = {
  Ctrl: ['ControlLeft', 'ControlRight'],
  Shift: ['ShiftLeft', 'ShiftRight'],
  Alt: ['AltLeft', 'AltRight'],
  Meta: ['MetaLeft', 'MetaRight'],
} as const;
type ModifierName = keyof typeof MODIFIER_CODES;
const MODIFIERS = Object.keys(MODIFIER_CODES) as ModifierName[];
/** 按鍵代碼 → 修飾鍵名稱（'ShiftLeft' → 'Shift'） */
const MODIFIER_OF = new Map<string, ModifierName>(
  MODIFIERS.flatMap((m) => MODIFIER_CODES[m].map((code) => [code, m] as const)),
);

/** 解析後的綁定：要按著的修飾鍵（組合鍵才有）＋主要的按鍵 */
export interface ParsedBinding {
  /** 組合鍵要按著的修飾鍵；null 表示不是組合鍵（不管修飾鍵） */
  mods: ReadonlySet<ModifierName> | null;
  /** 主要的按鍵：修飾鍵名稱、'Mouse:…'、'Pad…:…' 或鍵盤代碼 */
  key: string;
}

/** 這個平台的 Mod 是 Cmd（Mac、iPhone、iPad） */
function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return /Mac|iPhone|iPad|iPod/i.test(platform || navigator.platform || navigator.userAgent || '');
}

/** 一組按鍵的狀態：按住、這一幀按下、這一幀放開 */
export class ButtonSet {
  private readonly down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private nextPressed = new Set<string>();
  private nextReleased = new Set<string>();

  /**
   * 按下（引擎內部呼叫）
   * @param id 按鍵代碼
   */
  press(id: string): void {
    if (this.down.has(id)) return;
    this.down.add(id);
    this.nextPressed.add(id);
  }

  /**
   * 放開（引擎內部呼叫）
   * @param id 按鍵代碼
   */
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

  /**
   * 現在是否按著
   * @param id 按鍵代碼
   */
  isDown(id: string): boolean {
    return this.down.has(id);
  }

  /**
   * 這一幀剛按下（即使同一幀內又放開也算）
   * @param id 按鍵代碼
   */
  wasPressed(id: string): boolean {
    return this.pressed.has(id);
  }

  /**
   * 這一幀是否剛放開
   * @param id 按鍵代碼
   */
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
  /** 是不是 Mac（'Mod' 對應 Cmd、放開 Cmd 時一起放開其他鍵）；預設從瀏覽器判斷 */
  mac?: boolean;
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
  /** 是不是 Mac：組合鍵的 'Mod' 是 Cmd（其他平台是 Ctrl） */
  readonly mac: boolean;
  private readonly getGamepads: () => readonly (Gamepad | null)[];
  private primaryPointer: number | null = null;
  /** 解析過的綁定（也是「用過哪些組合鍵」的紀錄：瀏覽器的預設動作只擋這些） */
  private readonly parsed = new Map<string, ParsedBinding>();

  /**
   * @param options 手把死區、讀取手把的函式、是否是 Mac（綁定裡的 Mod 對應 ⌘；預設從瀏覽器判斷）
   */
  constructor(options: InputStateOptions = {}) {
    this.deadzone = options.deadzone ?? 0.15;
    this.mac = options.mac ?? detectMac();
    this.getGamepads =
      options.getGamepads ??
      (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    this.actions = new ActionMap(this);
  }

  // ───────── 查詢 ─────────

  /**
   * 現在是否按著（綁定字串：'KeyW'、'Mouse:Left'、'Pad:A'、'Shift'、'Ctrl+KeyS'）
   * @param binding 綁定字串：'KeyW'、'Mouse:Left'、'Pad:A'、'Shift'、'Ctrl+KeyS'
   */
  isDown(binding: Binding): boolean {
    return this.resolve(binding, 'down');
  }

  /**
   * 這一幀是否剛按下（組合鍵：修飾鍵按著時，這一幀按下主要的按鍵）
   * @param binding 綁定字串：'KeyW'、'Mouse:Left'、'Pad:A'、'Shift'、'Ctrl+KeyS'
   */
  wasPressed(binding: Binding): boolean {
    return this.resolve(binding, 'pressed');
  }

  /**
   * 這一幀是否剛放開（組合鍵：上一幀成立、這一幀不成立，不管先放開哪一個鍵）
   * @param binding 綁定字串：'KeyW'、'Mouse:Left'、'Pad:A'、'Shift'、'Ctrl+KeyS'
   */
  wasReleased(binding: Binding): boolean {
    return this.resolve(binding, 'released');
  }

  /**
   * 這個鍵盤事件是不是用過（查詢或綁定過）的快捷鍵組合：InputPlugin 用來擋掉瀏覽器的預設動作（例如 Ctrl+S 存檔）。
   * 只算有 Ctrl、Alt 或 Meta 的組合（只有 Shift 的組合是在打大寫字，不擋）。
   * @param e 鍵盤事件
   */
  isShortcut(e: {
    /** 實體按鍵代碼（KeyboardEvent.code，例如 'KeyS'） */
    code: string;
    /** 是否按著 Ctrl */
    ctrlKey: boolean;
    /** 是否按著 Shift */
    shiftKey: boolean;
    /** 是否按著 Alt（Mac 的 Option） */
    altKey: boolean;
    /** 是否按著 Meta（Mac 的 ⌘、Windows 鍵） */
    metaKey: boolean;
  }): boolean {
    const held: Record<ModifierName, boolean> = { Ctrl: e.ctrlKey, Shift: e.shiftKey, Alt: e.altKey, Meta: e.metaKey };
    for (const p of this.parsed.values()) {
      if (!p.mods || p.key !== e.code) continue;
      if (!p.mods.has('Ctrl') && !p.mods.has('Alt') && !p.mods.has('Meta')) continue;
      if (MODIFIERS.every((m) => p.mods!.has(m) === held[m])) return true;
    }
    return false;
  }

  /** 第一支已連線的手把 */
  get gamepad(): GamepadState | undefined {
    return this.gamepads.find((p) => p.connected);
  }

  // ───────── 事件輸入（由 InputPlugin 呼叫，測試時也可以直接呼叫） ─────────

  /**
   * 按下鍵盤按鍵（輸入外掛呼叫；測試時可以直接呼叫模擬）
   * @param code 實體按鍵代碼（KeyboardEvent.code，例如 'KeyW'）
   */
  keyDown(code: string): void {
    this.keyboard.press(code);
  }

  /**
   * 放開鍵盤按鍵
   * @param code 實體按鍵代碼（KeyboardEvent.code）
   */
  keyUp(code: string): void {
    this.keyboard.release(code);
    // Mac 按著 Cmd 時，瀏覽器不會送出其他鍵的放開事件：放開 Cmd 時把其他鍵一起放開，免得卡住
    // （真的還按著的鍵，長按的重複事件會再按下它）
    if (this.mac && MODIFIER_OF.get(code) === 'Meta' && !this.anyDown(MODIFIER_CODES.Meta, 'down')) {
      for (const k of [...this.keyboard.held]) if (!MODIFIER_OF.has(k)) this.keyboard.release(k);
    }
  }

  /**
   * 指標移動（輸入外掛呼叫）
   * @param x 指標 X（CSS 像素）
   * @param y 指標 Y（CSS 像素）
   * @param width 畫面寬度（CSS 像素）
   * @param height 畫面高度（CSS 像素）
   * @param dx X 方向移動量（滑鼠鎖定時用）
   * @param dy Y 方向移動量
   * @param id 指標編號（觸控時每根手指不同）
   */
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

  /**
   * 指標按下（輸入外掛呼叫）
   * @param id 指標編號
   * @param button 按鍵（0 左、1 中、2 右）
   * @param x 指標 X（CSS 像素）
   * @param y 指標 Y（CSS 像素）
   * @param type 指標類型：mouse、touch、pen
   */
  pointerDown(id: number, button: number, x: number, y: number, type = 'mouse'): void {
    this.pointer.active.set(id, { id, type, x, y, startX: x, startY: y });
    if (this.primaryPointer === null) this.primaryPointer = id;
    if (id === this.primaryPointer || type === 'mouse') {
      const name = MOUSE_BUTTONS[button];
      if (name) this.mouse.press(name);
    }
  }

  /**
   * 指標放開（輸入外掛呼叫）
   * @param id 指標編號
   * @param button 按鍵（0 左、1 中、2 右）
   */
  pointerUp(id: number, button: number): void {
    const info = this.pointer.active.get(id);
    this.pointer.active.delete(id);
    if (id === this.primaryPointer || info?.type === 'mouse') {
      const name = MOUSE_BUTTONS[button];
      if (name) this.mouse.release(name);
    }
    if (id === this.primaryPointer) this.primaryPointer = null;
  }

  /**
   * 滾輪捲動（輸入外掛呼叫）
   * @param dy 捲動量（往下為正）
   */
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

  /**
   * 解析綁定字串（有快取）；寫錯時丟出錯誤
   * @param binding 綁定字串，例如 'Ctrl+KeyS'
   */
  parse(binding: Binding): ParsedBinding {
    const hit = this.parsed.get(binding);
    if (hit) return hit;
    const parts = binding.split('+');
    const key = parts.pop()!;
    let mods: Set<ModifierName> | null = null;
    if (parts.length) {
      mods = new Set();
      for (const raw of parts) {
        const m = raw === 'Mod' ? (this.mac ? 'Meta' : 'Ctrl') : raw;
        if (!(m in MODIFIER_CODES))
          throw new Error(`未知的修飾鍵「${raw}」（${binding}）：可以用 Ctrl、Shift、Alt、Meta、Mod`);
        mods.add(m as ModifierName);
      }
      if (!key) throw new Error(`組合鍵少了按鍵（${binding}）：例如 'Ctrl+KeyS'`);
      if (/^Pad\d*:/.test(key)) throw new Error(`手把按鍵不能和修飾鍵組合（${binding}）`);
      // 主要的按鍵本身是修飾鍵（'Ctrl+Shift'）：它也算要按著的修飾鍵
      const self = key === 'Mod' ? (this.mac ? 'Meta' : 'Ctrl') : key;
      if (self in MODIFIER_CODES) mods.add(self as ModifierName);
    }
    const result: ParsedBinding = { mods, key: key === 'Mod' ? (this.mac ? 'Meta' : 'Ctrl') : key };
    this.parsed.set(binding, result);
    return result;
  }

  /** 這些按鍵裡有沒有一個符合 query（'down' 以外是「這一幀」） */
  private anyDown(codes: readonly string[], query: 'down' | 'pressed' | 'released' | 'before'): boolean {
    return codes.some((c) => this.checkKey(this.keyboard, c, query));
  }

  /** before：上一幀結束時是否按著（從這一幀的按下／放開推回去） */
  private checkKey(set: ButtonSet, id: string, query: 'down' | 'pressed' | 'released' | 'before'): boolean {
    if (query === 'down') return set.isDown(id);
    if (query === 'pressed') return set.wasPressed(id);
    if (query === 'released') return set.wasReleased(id);
    return set.isDown(id) ? !set.wasPressed(id) : set.wasReleased(id) && !set.wasPressed(id);
  }

  private resolve(binding: Binding, query: 'down' | 'pressed' | 'released'): boolean {
    const { mods, key } = this.parse(binding);
    if (!mods) return this.resolveKey(key, query);
    // 組合鍵：修飾鍵完全符合（要的都按著、不要的都沒按）＋主要的按鍵
    const active = (when: 'down' | 'before') =>
      MODIFIERS.every((m) => this.anyDown(MODIFIER_CODES[m], when) === mods.has(m)) && this.resolveKey(key, when);
    if (query === 'down') return active('down');
    if (query === 'pressed') return this.resolveKey(key, 'pressed') && active('down');
    return active('before') && !active('down');
  }

  /** 單一按鍵（修飾鍵名稱、滑鼠、手把、鍵盤代碼） */
  private resolveKey(binding: string, query: 'down' | 'pressed' | 'released' | 'before'): boolean {
    const check = (set: ButtonSet, id: string) => this.checkKey(set, id, query);

    if (binding in MODIFIER_CODES) {
      // 左右兩邊當成同一個鍵：另一邊還按著時，放開這一邊不算放開；已經按著一邊時再按另一邊不算按下
      const codes = MODIFIER_CODES[binding as ModifierName];
      if (query === 'pressed') return this.anyDown(codes, 'pressed') && !this.anyDown(codes, 'before');
      if (query === 'released') return this.anyDown(codes, 'released') && !this.anyDown(codes, 'down');
      return this.anyDown(codes, query);
    }
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

  /**
   * @param input 輸入狀態
   */
  constructor(private readonly input: Input) {}

  /**
   * 定義按鍵動作（可以用組合鍵） @example actions.bind('jump', ['Space', 'Pad:A']); actions.bind('save', ['Mod+KeyS'])
   * @param action 動作名稱（例如 'jump'）
   * @param bindings 綁定的按鍵：'Space'、'Pad:A'、'Ctrl+KeyS'…（任一個按著就算）
   */
  bind(action: string, bindings: Binding[]): this {
    // 先解析一次：寫錯時馬上知道，組合鍵也會登記（InputPlugin 才知道要擋瀏覽器的哪些快捷鍵）
    for (const b of bindings) this.input.parse(b);
    this.buttons.set(action, [...bindings]);
    return this;
  }

  /**
   * 定義軸動作 @example actions.bindAxis('moveX', { negative: ['KeyA'], positive: ['KeyD'], padAxis: GamepadAxis.LeftX })
   * @param action 動作名稱（例如 'moveX'）
   * @param definition 往負方向、正方向的按鍵，手把搖桿軸、是否反轉
   */
  bindAxis(action: string, definition: AxisDefinition): this {
    for (const b of [...(definition.negative ?? []), ...(definition.positive ?? [])]) this.input.parse(b);
    this.axes.set(action, { ...definition });
    return this;
  }

  /**
   * 動作綁定了哪些按鍵
   * @param action 動作名稱
   */
  bindingsOf(action: string): readonly Binding[] {
    return this.buttonBindings(action);
  }

  /**
   * 動作現在是否按著（任一個綁定的按鍵按著）
   * @param action 動作名稱
   */
  isDown(action: string): boolean {
    return this.buttonBindings(action).some((b) => this.input.isDown(b));
  }

  /**
   * 動作這一幀是否剛按下
   * @param action 動作名稱
   */
  wasPressed(action: string): boolean {
    return this.buttonBindings(action).some((b) => this.input.wasPressed(b));
  }

  /**
   * 動作這一幀是否剛放開
   * @param action 動作名稱
   */
  wasReleased(action: string): boolean {
    // 所有綁定都已放開，且至少有一個是這一幀放開的
    const bindings = this.buttonBindings(action);
    return bindings.some((b) => this.input.wasReleased(b)) && !bindings.some((b) => this.input.isDown(b));
  }

  /**
   * 軸數值 -1~1：按鍵與手把搖桿取絕對值較大者
   * @param action 動作名稱（bindAxis 定義的）
   */
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
