import type { Transport } from './transports';
import { createLogger } from '../core/Logger';

const log = createLogger('network');

/** 線上的另一位玩家 */
export interface Peer {
  /** 玩家編號 */
  id: string;
  /** 對方連線時附帶的資料（名稱、顏色等） */
  meta: Record<string, unknown>;
  /** 來回延遲（毫秒），還沒量到時為 null */
  rtt: number | null;
  /** 最後一次收到對方訊息的時間（毫秒） */
  lastSeen: number;
}

/** 連線狀態：未連線、連線中、已連線 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** 傳輸用的封包（JSON） */
interface Envelope {
  /** 訊息類型 */
  t: string;
  /** 內容 */
  d?: unknown;
  /** 寄件人 */
  f: string;
  /** 指定收件人（不給為廣播） */
  to?: string;
  /** 請求編號 */
  id?: number;
  /** 回應哪一個請求 */
  re?: number;
  /** 回應的錯誤訊息 */
  err?: string;
}

/** 收到訊息時的處理函式 */
export type MessageHandler<T = unknown> = (data: T, from: Peer) => void;
/** 收到請求時的處理函式：回傳值會送回給對方 */
export type RequestHandler<T = unknown, R = unknown> = (data: T, from: Peer) => R | Promise<R>;

/** NetworkClient 的設定 */
export interface NetworkClientOptions {
  /** 傳輸方式（WebSocketTransport、BroadcastChannelTransport…） */
  transport: Transport;
  /** 自己的編號（預設隨機產生） */
  peerId?: string;
  /** 連線時附帶給其他人的資料，例如 { name: '玩家一', color: '#f00' } */
  meta?: Record<string, unknown>;
  /** 心跳間隔（毫秒），預設 1000：量延遲、偵測斷線 */
  heartbeatInterval?: number;
  /** 多久沒收到某位玩家的訊息就當作離線（毫秒），預設 5000 */
  peerTimeout?: number;
  /** 斷線自動重連，預設開啟；等待時間會從 minDelay 逐次加倍到 maxDelay */
  reconnect?:
    | boolean
    | {
        /** 第一次重連前等多久（毫秒） */
        minDelay?: number;
        /** 等待時間加倍到這裡為止（毫秒） */
        maxDelay?: number;
      };
  /** 斷線期間最多暫存幾則訊息，重連後補送，預設 100 */
  queueLimit?: number;
  /** 時間來源（測試用） */
  now?: () => number;
}

/** 系統訊息（使用者訊息不能用 $ 開頭） */
const SYS = { join: '$join', hello: '$hello', leave: '$leave', ping: '$ping', pong: '$pong', reply: '$reply' } as const;

const randomId = () => Math.random().toString(36).slice(2, 8);

/**
 * 網路連線客戶端：訊息收發、請求／回應、玩家名單、延遲量測、斷線重連。
 *
 * @example
 * const net = new NetworkClient({ transport: new BroadcastChannelTransport('my-game'), meta: { name: '小明' } });
 * net.on<{ text: string }>('chat', (msg, from) => console.log(from.meta.name, msg.text));
 * net.onPeerJoin((peer) => console.log(peer.meta.name, '加入了'));
 * await net.connect();
 * net.send('chat', { text: '大家好' });
 */
export class NetworkClient {
  /** 自己的玩家編號 */
  readonly peerId: string;
  /** 自己的資料（名稱、顏色…），其他玩家看得到 */
  meta: Record<string, unknown>;
  /** 其他玩家 */
  readonly peers = new Map<string, Peer>();
  /** 流量統計 */
  readonly stats = {
    /** 送出的訊息數 */
    messagesSent: 0,
    /** 收到的訊息數 */
    messagesReceived: 0,
    /** 送出的位元組數 */
    bytesSent: 0,
    /** 收到的位元組數 */
    bytesReceived: 0,
  };

  private _status: ConnectionStatus = 'disconnected';
  private readonly handlers = new Map<string, Set<MessageHandler<unknown>>>();
  private readonly requestHandlers = new Map<string, RequestHandler<unknown, unknown>>();
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly joinListeners = new Set<(peer: Peer) => void>();
  private readonly leaveListeners = new Set<(peer: Peer) => void>();
  /**
   * 已經通知過「加入」的玩家。先收到一般訊息、還沒收到對方的自我介紹（join／hello）時，
   * 玩家會先放進 peers（訊息照常處理），等拿到對方的資料才通知加入，onPeerJoin 才有名字等資料可用
   */
  private readonly announced = new Set<string>();
  /** 還沒收到自我介紹的玩家：等太久（對方是不會回覆的舊版本）就直接通知加入 */
  private readonly introTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly queue: string[] = [];
  private nextRequestId = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;
  private connectWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private readonly transport: Transport;
  private readonly heartbeatInterval: number;
  private readonly peerTimeout: number;
  private readonly reconnectOptions: { minDelay: number; maxDelay: number } | null;
  private readonly queueLimit: number;
  private readonly now: () => number;
  private unloadListener: (() => void) | null = null;

  /**
   * @param options 傳輸方式、自己的編號與資料、心跳間隔、離線判定、斷線重連、暫存上限
   */
  constructor(options: NetworkClientOptions) {
    this.transport = options.transport;
    this.peerId = options.peerId ?? randomId();
    this.meta = { ...options.meta };
    this.heartbeatInterval = options.heartbeatInterval ?? 1000;
    this.peerTimeout = options.peerTimeout ?? 5000;
    const r = options.reconnect ?? true;
    this.reconnectOptions = r === false ? null : { minDelay: 500, maxDelay: 10000, ...(r === true ? {} : r) };
    this.queueLimit = options.queueLimit ?? 100;
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** 目前的連線狀態 */
  get status(): ConnectionStatus {
    return this._status;
  }

  /** 是否已連線 */
  get connected(): boolean {
    return this._status === 'connected';
  }

  // ───────── 連線 ─────────

  /** 連線；成功後 resolve（之後斷線會自動重連） */
  connect(): Promise<void> {
    this.manualClose = false;
    if (this._status === 'connected') return Promise.resolve();
    const promise = new Promise<void>((resolve, reject) => this.connectWaiters.push({ resolve, reject }));
    if (this._status === 'disconnected') this.open();
    if (typeof window !== 'undefined' && !this.unloadListener) {
      // 關閉分頁時通知其他人（盡力而為；沒送到的話靠心跳逾時偵測）
      this.unloadListener = () => this.disconnect();
      window.addEventListener('pagehide', this.unloadListener);
    }
    return promise;
  }

  /** 主動斷線（不會重連） */
  disconnect(): void {
    this.manualClose = true;
    this.clearTimers();
    if (this._status === 'connected') this.write({ t: SYS.leave, f: this.peerId });
    this.transport.close();
    this.dropAllPeers();
    this.setStatus('disconnected');
    for (const w of this.connectWaiters.splice(0)) w.reject(new Error('已中斷連線'));
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('已中斷連線'));
    }
    this.pending.clear();
    if (this.unloadListener) {
      window.removeEventListener('pagehide', this.unloadListener);
      this.unloadListener = null;
    }
  }

  /**
   * 連線狀態改變時通知，回傳取消監聽的函式
   * @param listener 狀態改變時呼叫：disconnected、connecting、connected
   */
  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * 有玩家加入時通知，回傳取消監聽的函式
   * @param listener 玩家加入時呼叫
   */
  onPeerJoin(listener: (peer: Peer) => void): () => void {
    this.joinListeners.add(listener);
    return () => this.joinListeners.delete(listener);
  }

  /**
   * 有玩家離開時通知，回傳取消監聽的函式
   * @param listener 玩家離開時呼叫
   */
  onPeerLeave(listener: (peer: Peer) => void): () => void {
    this.leaveListeners.add(listener);
    return () => this.leaveListeners.delete(listener);
  }

  // ───────── 訊息 ─────────

  /**
   * 送出訊息。to 不給為廣播給所有人。
   * 斷線期間會暫存（最多 queueLimit 則），重連後補送。
   * @param type 訊息類型（不能用 $ 開頭）
   * @param data 訊息內容（要能轉成 JSON）
   * @param options 只送給某位玩家（to）
   */
  send(
    type: string,
    data?: unknown,
    options: {
      /** 只送給這位玩家（玩家編號）；省略時送給房間裡所有人 */
      to?: string;
    } = {},
  ): void {
    if (type.startsWith('$')) throw new Error(`訊息類型不能用 $ 開頭（保留給系統）：${type}`);
    this.write({ t: type, d: data, f: this.peerId, to: options.to }, true);
  }

  /**
   * 接收某種訊息
   * @param type 訊息類型
   * @param handler 收到時呼叫：內容、送出的玩家
   */
  on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as MessageHandler<unknown>);
    return () => set!.delete(handler as MessageHandler<unknown>);
  }

  /**
   * 送出請求並等待回應。
   * @param type 請求類型
   * @param data 請求內容（要能轉成 JSON）
   * @param options 問哪位玩家（to）、逾時毫秒數（timeout）
   * @example const score = await net.request<number>('getScore', null, { to: hostId });
   */
  request<R = unknown>(
    type: string,
    data?: unknown,
    options: {
      /** 問這位玩家（玩家編號）；省略時問房間裡所有人，用第一個回應 */
      to?: string;
      /** 等多久沒回應就失敗（毫秒），預設 5000 */
      timeout?: number;
    } = {},
  ): Promise<R> {
    if (!this.connected) return Promise.reject(new Error('尚未連線'));
    const id = this.nextRequestId++;
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`請求「${type}」逾時`));
      }, options.timeout ?? 5000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.write({ t: type, d: data, f: this.peerId, to: options.to, id });
    });
  }

  /**
   * 處理請求：回傳值（或 Promise）會送回給請求者
   * @param type 請求類型
   * @param handler 收到請求時呼叫：回傳值（或 Promise）送回給請求者
   */
  handle<T = unknown, R = unknown>(type: string, handler: RequestHandler<T, R>): () => void {
    this.requestHandlers.set(type, handler as RequestHandler<unknown, unknown>);
    return () => {
      if (this.requestHandlers.get(type) === handler) this.requestHandlers.delete(type);
    };
  }

  // ───────── 內部：連線管理 ─────────

  private open(): void {
    this.setStatus('connecting');
    this.transport.connect({
      open: () => this.onOpen(),
      message: (data) => this.onMessage(data),
      close: (reason) => this.onClose(reason),
    });
  }

  private onOpen(): void {
    this.reconnectAttempt = 0;
    this.setStatus('connected');
    this.write({ t: SYS.join, d: this.meta, f: this.peerId });
    // 斷線期間暫存的訊息
    for (const data of this.queue.splice(0)) this.rawSend(data);
    this.heartbeat = setInterval(() => this.beat(), this.heartbeatInterval);
    for (const w of this.connectWaiters.splice(0)) w.resolve();
  }

  private onClose(reason?: string): void {
    this.clearTimers();
    this.dropAllPeers();
    this.setStatus('disconnected');
    if (this.manualClose || !this.reconnectOptions) {
      for (const w of this.connectWaiters.splice(0)) w.reject(new Error(reason ?? '連線中斷'));
      return;
    }
    // 自動重連：等待時間逐次加倍（加一點隨機，避免大家同時重連）
    const { minDelay, maxDelay } = this.reconnectOptions;
    const delay = Math.min(maxDelay, minDelay * 2 ** this.reconnectAttempt) * (0.8 + Math.random() * 0.4);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualClose) this.open();
    }, delay);
  }

  private beat(): void {
    this.write({ t: SYS.ping, d: this.now(), f: this.peerId });
    // 太久沒消息的玩家視為離線（例如對方直接關掉分頁）
    const now = this.now();
    for (const peer of [...this.peers.values()]) {
      if (now - peer.lastSeen > this.peerTimeout) this.removePeer(peer.id);
    }
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.reconnectTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this._status) return;
    this._status = status;
    for (const l of [...this.statusListeners]) l(status);
  }

  // ───────── 內部：收發 ─────────

  private write(env: Envelope, queueIfOffline = false): void {
    const data = JSON.stringify(env);
    if (!this.connected) {
      if (queueIfOffline) {
        this.queue.push(data);
        if (this.queue.length > this.queueLimit) this.queue.shift();
      }
      return;
    }
    this.rawSend(data);
  }

  private rawSend(data: string): void {
    this.transport.send(data);
    this.stats.messagesSent++;
    this.stats.bytesSent += data.length;
  }

  private onMessage(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return; // 不是我們的格式
    }
    if (!env || typeof env.t !== 'string' || typeof env.f !== 'string' || env.f === this.peerId) return;
    if (env.to && env.to !== this.peerId) return; // 不是給我的
    this.stats.messagesReceived++;
    this.stats.bytesReceived += raw.length;

    const now = this.now();
    const known = this.peers.get(env.f);
    if (known) known.lastSeen = now;

    switch (env.t) {
      case SYS.join:
        this.addPeer(env.f, env.d as Record<string, unknown>, true);
        // 回覆自己的資料給新加入的人
        this.write({ t: SYS.hello, d: this.meta, f: this.peerId, to: env.f });
        return;
      case SYS.hello:
        this.addPeer(env.f, env.d as Record<string, unknown>, true);
        return;
      case SYS.leave:
        this.removePeer(env.f);
        return;
      case SYS.ping:
        if (!known) this.addPeer(env.f, {}); // 錯過了 join（例如自己晚加入又沒收到 hello）
        this.write({ t: SYS.pong, d: env.d, f: this.peerId, to: env.f });
        return;
      case SYS.pong: {
        if (known && typeof env.d === 'number') {
          const rtt = now - env.d;
          known.rtt = known.rtt === null ? rtt : known.rtt * 0.7 + rtt * 0.3;
        }
        return;
      }
      case SYS.reply: {
        const p = env.re !== undefined ? this.pending.get(env.re) : undefined;
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(env.re!);
        if (env.err !== undefined) p.reject(new Error(env.err));
        else p.resolve(env.d);
        return;
      }
    }

    const peer = known ?? this.addPeer(env.f, {});
    if (env.id !== undefined) {
      void this.respond(env, peer);
      return;
    }
    for (const h of [...(this.handlers.get(env.t) ?? [])]) {
      try {
        h(env.d, peer);
      } catch (error) {
        log.error(`處理網路訊息「${env.t}」時發生錯誤：`, error);
      }
    }
  }

  private async respond(env: Envelope, peer: Peer): Promise<void> {
    const handler = this.requestHandlers.get(env.t);
    const reply: Envelope = { t: SYS.reply, f: this.peerId, to: env.f, re: env.id };
    if (!handler) {
      // 廣播的請求：沒有處理函式的人不回應（讓有處理的人回）
      if (!env.to) return;
      reply.err = `對方沒有處理「${env.t}」的請求`;
    } else {
      try {
        reply.d = await handler(env.d, peer);
      } catch (error) {
        reply.err = error instanceof Error ? error.message : String(error);
      }
    }
    this.write(reply);
  }

  /**
   * 記錄玩家。introduced：這是對方的自我介紹（join／hello，帶有對方的資料）。
   * 不是自我介紹（先收到心跳或一般訊息，例如重連後對方的位置更新比 hello 先到）時，
   * 先記下來、向對方要自我介紹，拿到資料後才通知加入。
   */
  private addPeer(id: string, meta: Record<string, unknown> = {}, introduced = false): Peer {
    let peer = this.peers.get(id);
    if (peer) {
      if (introduced) peer.meta = meta ?? {};
      peer.lastSeen = this.now();
    } else {
      peer = { id, meta: introduced ? (meta ?? {}) : {}, rtt: null, lastSeen: this.now() };
      this.peers.set(id, peer);
    }
    if (introduced) this.announce(peer);
    else if (!this.announced.has(id) && !this.introTimers.has(id)) {
      this.write({ t: SYS.join, d: this.meta, f: this.peerId, to: id }); // 請對方回 hello
      this.introTimers.set(
        id,
        setTimeout(() => {
          this.introTimers.delete(id);
          const p = this.peers.get(id);
          if (p) this.announce(p);
        }, 2000),
      );
    }
    return peer;
  }

  /** 通知加入（每位玩家只通知一次） */
  private announce(peer: Peer): void {
    const timer = this.introTimers.get(peer.id);
    if (timer) clearTimeout(timer);
    this.introTimers.delete(peer.id);
    if (this.announced.has(peer.id)) return;
    this.announced.add(peer.id);
    for (const l of [...this.joinListeners]) l(peer);
  }

  private removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    const timer = this.introTimers.get(id);
    if (timer) clearTimeout(timer);
    this.introTimers.delete(id);
    // 沒通知過加入的，也不通知離開
    if (this.announced.delete(id)) for (const l of [...this.leaveListeners]) l(peer);
  }

  private dropAllPeers(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }
}
