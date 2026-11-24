/**
 * 事件：物件之間互相通知，不用互相知道對方（world.events）。
 *
 *   // 定義事件（有型別：payload 的內容）
 *   export const CoinCollected = define.event<{ value: number }>('CoinCollected');
 *
 *   world.events.emit(CoinCollected, { value: 1 });                  // 發出
 *   const off = world.events.on(CoinCollected, (e) => score += e.value); // 收聽，off() 取消
 *   world.events.on(PlayerDied, showGameOver, { owner: hud });        // 綁定實體：實體銷毀時自動取消
 *   world.events.once(LevelLoaded, startMusic);                       // 只收一次
 *
 * 腳本裡用 this.on(事件, 函式)：腳本結束（實體銷毀或移除腳本）時自動取消。
 * emit 是同步的（馬上呼叫所有收聽的函式）；某個函式出錯時記錄錯誤，其他函式照常收到。
 */
import { createLogger } from '../core/Logger';
import type { Entity } from './Entity';

const log = createLogger('events');

/** 事件的種類（define.event 建立）；T 是事件內容的型別 */
export interface EventType<T = void> {
  /** 事件名稱（除錯訊息用） */
  readonly name: string;
  /** 只用來記住型別，沒有實際的值 */
  readonly _payload?: T;
}

/**
 * 定義事件：define.event<{ value: number }>('CoinCollected')
 * @param name 事件名稱（除錯時顯示）
 */
export function defineEvent<T = void>(name: string): EventType<T> {
  return Object.freeze({ name });
}

/** on 的設定 */
export interface EventOptions {
  /** 只收一次 */
  once?: boolean;
  /** 擁有者（例如實體）：events.offOwner(擁有者) 一次取消；實體銷毀時 world 會自動取消 */
  owner?: Entity | object;
}

type Handler = (payload: never) => void;

interface Listener {
  handler: Handler;
  once: boolean;
  owner: unknown;
}

/**
 * 事件（world.events）：on 收聽、emit 發出、once 只收一次；綁定擁有者（實體）的收聽在實體銷毀時自動取消。
 * @example
 * world.events.on(CoinCollected, (e) => (score += e.value));
 */
export class EventBus {
  private readonly listeners = new Map<EventType<unknown>, Listener[]>();

  /**
   * 收聽事件，回傳取消的函式
   * @param type 事件（define.event 定義的）
   * @param handler 事件發生時呼叫，拿到事件的資料
   * @param options 只收一次、擁有者（offOwner 一起取消）
   */
  on<T>(type: EventType<T>, handler: (payload: T) => void, options: EventOptions = {}): () => void {
    const listener: Listener = { handler: handler as Handler, once: options.once ?? false, owner: options.owner };
    const list = this.listeners.get(type as EventType<unknown>) ?? [];
    list.push(listener);
    this.listeners.set(type as EventType<unknown>, list);
    return () => this.remove(type as EventType<unknown>, listener);
  }

  /**
   * 只收一次
   * @param type 事件（define.event 定義的）
   * @param handler 事件發生時呼叫，拿到事件的資料
   * @param options 擁有者（offOwner 一起取消）
   */
  once<T>(type: EventType<T>, handler: (payload: T) => void, options: Omit<EventOptions, 'once'> = {}): () => void {
    return this.on(type, handler, { ...options, once: true });
  }

  /**
   * 發出事件：馬上呼叫所有收聽的函式
   * @param type 事件（define.event 定義的）
   * @param payload 事件的資料（沒有資料的事件不用給）
   */
  emit<T>(type: EventType<T>, ...payload: T extends void ? [] : [T]): void {
    const list = this.listeners.get(type as EventType<unknown>);
    if (!list?.length) return;
    for (const l of [...list]) {
      if (l.once) this.remove(type as EventType<unknown>, l);
      try {
        (l.handler as (p: unknown) => void)(payload[0]);
      } catch (error) {
        log.error(`事件「${type.name}」的收聽函式發生錯誤`, error);
      }
    }
  }

  /**
   * 取消某個擁有者（例如實體）的所有收聽
   * @param owner 擁有者（收聽時給的 owner）
   */
  offOwner(owner: unknown): void {
    for (const [type, list] of this.listeners) {
      const kept = list.filter((l) => l.owner !== owner);
      if (kept.length === list.length) continue;
      if (kept.length) this.listeners.set(type, kept);
      else this.listeners.delete(type);
    }
  }

  /**
   * 收聽某個事件的數量（不給事件時是全部）
   * @param type 事件；省略時算全部
   */
  listenerCount(type?: EventType<unknown>): number {
    if (type) return this.listeners.get(type)?.length ?? 0;
    let n = 0;
    for (const list of this.listeners.values()) n += list.length;
    return n;
  }

  /** 取消全部收聽 */
  clear(): void {
    this.listeners.clear();
  }

  private remove(type: EventType<unknown>, listener: Listener): void {
    const list = this.listeners.get(type);
    const i = list?.indexOf(listener) ?? -1;
    if (!list || i === -1) return;
    list.splice(i, 1);
    if (!list.length) this.listeners.delete(type);
  }
}
