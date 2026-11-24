/**
 * 傳輸層：只負責把文字送出去、收進來。玩家管理、心跳、重連都在 NetworkClient。
 * 傳輸層本身是「廣播」語意：送出的訊息會到達同一個房間裡的所有其他人。
 */
export interface TransportHandlers {
  /** 連線成功時呼叫 */
  open(): void;
  /**
   * 收到訊息時呼叫
   * @param data 收到的文字
   */
  message(data: string): void;
  /**
   * 連線中斷（不是自己呼叫 close 造成的）
   * @param reason 中斷的原因
   */
  close(reason?: string): void;
}

/** 傳輸方式：負責收送文字訊息（WebSocket、同一個瀏覽器的分頁、測試用） */
export interface Transport {
  /**
   * 開始連線；成功時呼叫 handlers.open
   * @param handlers 連線成功、收到訊息、連線中斷時呼叫的函式
   */
  connect(handlers: TransportHandlers): void;
  /**
   * 送出訊息
   * @param data 要送出的文字
   */
  send(data: string): void;
  /** 主動關閉（不會觸發 handlers.close） */
  close(): void;
}

// ───────── WebSocket：透過伺服器跨電腦連線 ─────────

/**
 * WebSocket 傳輸：需要一個轉送伺服器（見 server/relay.mjs，npm run relay）。
 * @example new WebSocketTransport('ws://localhost:8787/my-room')
 */
export class WebSocketTransport implements Transport {
  private socket: WebSocket | null = null;
  private closing = false;

  constructor(/** 伺服器網址（ws:// 或 wss://） */ readonly url: string) {}

  /**
   * @param handlers 連線成功、收到訊息、連線中斷時呼叫的函式
   */
  connect(handlers: TransportHandlers): void {
    this.closing = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => handlers.open();
    socket.onmessage = (e) => {
      if (typeof e.data === 'string') handlers.message(e.data);
    };
    socket.onclose = (e) => {
      if (this.socket === socket) this.socket = null;
      if (!this.closing) handlers.close(e.reason || `連線中斷（代碼 ${e.code}）`);
    };
    socket.onerror = () => {
      // onclose 會接著觸發，在那裡處理
    };
  }

  /**
   * 送出訊息
   * @param data 要送出的文字
   */
  send(data: string): void {
    if (this.socket?.readyState === 1) this.socket.send(data);
  }

  close(): void {
    this.closing = true;
    this.socket?.close();
    this.socket = null;
  }
}

// ───────── BroadcastChannel：同一個瀏覽器的分頁之間 ─────────

/**
 * 同一個瀏覽器、同一個網站的多個分頁互相連線，不需要伺服器（開發、示範很方便）。
 */
export class BroadcastChannelTransport implements Transport {
  private channel: BroadcastChannel | null = null;

  constructor(/** 頻道名稱（同名的分頁互相連線） */ readonly name: string) {}

  /**
   * @param handlers 連線成功、收到訊息、連線中斷時呼叫的函式
   */
  connect(handlers: TransportHandlers): void {
    const channel = new BroadcastChannel(this.name);
    this.channel = channel;
    channel.onmessage = (e) => {
      if (typeof e.data === 'string') handlers.message(e.data);
    };
    queueMicrotask(() => {
      if (this.channel === channel) handlers.open();
    });
  }

  /**
   * 送出訊息
   * @param data 要送出的文字
   */
  send(data: string): void {
    this.channel?.postMessage(data);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
  }
}

// ───────── Loopback：同一個程式裡模擬網路（測試用） ─────────

/** 測試用傳輸的設定 */
export interface LoopbackOptions {
  /** 單向延遲（毫秒），預設 0 */
  latency?: number;
}

/**
 * 模擬網路的集線器：同一個 hub 建立的傳輸會互相廣播。
 * @example
 * const hub = new LoopbackHub();
 * const a = new NetworkClient({ transport: hub.create() });
 * const b = new NetworkClient({ transport: hub.create({ latency: 50 }) });
 */
export class LoopbackHub {
  private readonly members = new Set<LoopbackTransport>();

  /**
   * 建立一個連到這個中心的傳輸
   * @param options 模擬的網路延遲（毫秒）
   */
  create(options: LoopbackOptions = {}): LoopbackTransport {
    return new LoopbackTransport(this, options.latency ?? 0);
  }

  /** @internal */
  _join(t: LoopbackTransport): void {
    this.members.add(t);
  }

  /** @internal */
  _leave(t: LoopbackTransport): void {
    this.members.delete(t);
  }

  /** @internal */
  _broadcast(from: LoopbackTransport, data: string): void {
    for (const m of this.members) if (m !== from) m._deliver(data, from.latency);
  }

  /**
   * 模擬某一端的網路斷線（會觸發它的 close）
   * @param t 要斷線的那一端
   */
  drop(t: LoopbackTransport): void {
    if (!this.members.has(t)) return;
    this.members.delete(t);
    t._dropped();
  }

  /** 連到這個中心的傳輸數量 */
  get size(): number {
    return this.members.size;
  }
}

/** 測試用的傳輸：同一個程式裡互相傳訊息，可以模擬延遲 */
export class LoopbackTransport implements Transport {
  private handlers: TransportHandlers | null = null;
  /** 設為 true 時，connect 會失敗（測試重連用） */
  failNextConnect = false;

  /**
   * @param hub 連到的中心
   */
  constructor(
    private readonly hub: LoopbackHub,
    /** 模擬的延遲（毫秒） */
    readonly latency: number,
  ) {}

  /**
   * @param handlers 連線成功、收到訊息、連線中斷時呼叫的函式
   */
  connect(handlers: TransportHandlers): void {
    this.handlers = handlers;
    if (this.failNextConnect) {
      this.failNextConnect = false;
      queueMicrotask(() => handlers.close('連線失敗（模擬）'));
      return;
    }
    this.hub._join(this);
    queueMicrotask(() => handlers.open());
  }

  /**
   * 送出訊息
   * @param data 要送出的文字
   */
  send(data: string): void {
    if (this.handlers) this.hub._broadcast(this, data); // 已關閉或斷線就送不出去
  }

  close(): void {
    this.hub._leave(this);
    this.handlers = null;
  }

  /** @internal */
  _deliver(data: string, senderLatency: number): void {
    const handlers = this.handlers;
    const delay = senderLatency + this.latency;
    if (!handlers) return;
    if (delay > 0) setTimeout(() => this.handlers === handlers && handlers.message(data), delay);
    else queueMicrotask(() => this.handlers === handlers && handlers.message(data));
  }

  /** @internal */
  _dropped(): void {
    const h = this.handlers;
    this.handlers = null;
    h?.close('網路中斷（模擬）');
  }
}
