/**
 * 有限狀態機的一個狀態。update 回傳另一個狀態名稱時就會切換過去。
 */
export interface FsmState<C> {
  /** 進入這個狀態時呼叫（from：上一個狀態） */
  enter?(ctx: C, from: string | null): void;
  /** 回傳狀態名稱以切換；不回傳則維持 */
  update?(ctx: C, dt: number): string | void;
  /** 離開這個狀態時呼叫（to：下一個狀態） */
  exit?(ctx: C, to: string): void;
}

/**
 * 有限狀態機：適合狀態清楚、轉換不多的行為（門、陷阱、簡單敵人）。
 * @example
 * const fsm = new StateMachine(this, 'idle', {
 *   idle:   { update: (self) => self.seesPlayer() ? 'chase' : undefined },
 *   chase:  { enter: (self) => self.audio.play('alert.wav'),
 *             update: (self, dt) => self.lostPlayer() ? 'idle' : undefined },
 * });
 * fsm.update(dt);
 */
export class StateMachine<C> {
  private _current: string;
  private _previous: string | null = null;
  private _time = 0;
  private started = false;
  private readonly listeners = new Set<(to: string, from: string | null) => void>();

  constructor(
    /** 狀態共用的資料（每個狀態的函式都收到它） */
    readonly context: C,
    initial: string,
    private readonly states: Record<string, FsmState<C>>,
  ) {
    if (!states[initial]) throw new Error(`狀態機的初始狀態「${initial}」不存在`);
    this._current = initial;
  }

  /** 目前的狀態 */
  get current(): string {
    return this._current;
  }

  /** 上一個狀態（還沒切換過時是 null） */
  get previous(): string | null {
    return this._previous;
  }

  /** 在目前狀態待了幾秒 */
  get timeInState(): number {
    return this._time;
  }

  /** 目前是不是這個狀態 */
  is(state: string): boolean {
    return this._current === state;
  }

  /** 狀態改變時通知 */
  onChange(listener: (to: string, from: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 每幀呼叫。第一次呼叫時會先進入初始狀態 */
  update(dt: number): void {
    if (!this.started) this.start();
    this._time += dt;
    const next = this.states[this._current].update?.(this.context, dt);
    if (typeof next === 'string' && next !== this._current) this.go(next);
  }

  /** 立刻切換狀態 */
  go(state: string): void {
    if (!this.states[state]) throw new Error(`狀態「${state}」不存在`);
    if (!this.started) {
      this._current = state;
      this.start();
      return;
    }
    const from = this._current;
    this.states[from].exit?.(this.context, state);
    this._previous = from;
    this._current = state;
    this._time = 0;
    this.states[state].enter?.(this.context, from);
    for (const l of [...this.listeners]) l(state, from);
  }

  private start(): void {
    this.started = true;
    this._time = 0;
    this.states[this._current].enter?.(this.context, null);
    for (const l of [...this.listeners]) l(this._current, null);
  }
}
