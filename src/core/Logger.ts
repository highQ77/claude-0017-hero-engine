/**
 * 記錄訊息（Logger）：分模組、分等級，取代直接 console.*。
 *
 *   const log = createLogger('physics');
 *   log.warn('剛體沒有碰撞體');          // 主控台：[physics] 剛體沒有碰撞體
 *   setLogLevel('warn');                  // 只顯示警告與錯誤（例如正式版）
 *   const off = onLog((e) => …);          // 收到每一則訊息（測試檢查有沒有警告、遊戲顯示在畫面上）
 *
 * 等級由低到高：debug、info、warn、error；設成 'silent' 全部不顯示。
 * 預設 info（debug 不顯示）；new Engine({ debug: true }) 會改成 debug。
 * 等級是全域的（同一個頁面所有引擎、所有模組共用）。
 */

/** 記錄等級 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** 一則記錄 */
export interface LogEntry {
  /** 等級 */
  readonly level: Exclude<LogLevel, 'silent'>;
  /** 模組名稱（createLogger 給的） */
  readonly module: string;
  /** 內容（和 console.log 的參數一樣） */
  readonly args: readonly unknown[];
}

/** 一個模組的記錄器 */
export interface Logger {
  /** 模組名稱 */
  readonly module: string;
  /**
   * 除錯訊息（預設不顯示）
   * @param args 要記錄的內容（和 console.log 一樣）
   */
  debug(...args: unknown[]): void;
  /**
   * 一般訊息
   * @param args 要記錄的內容（和 console.log 一樣）
   */
  info(...args: unknown[]): void;
  /**
   * 警告
   * @param args 要記錄的內容（和 console.log 一樣）
   */
  warn(...args: unknown[]): void;
  /**
   * 錯誤
   * @param args 要記錄的內容（和 console.log 一樣）
   */
  error(...args: unknown[]): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
let current: LogLevel = 'info';
const listeners = new Set<(entry: LogEntry) => void>();

/**
 * 設定要顯示的最低等級（全域）
 * @param level 最低等級：debug、info、warn、error、silent
 */
export function setLogLevel(level: LogLevel): void {
  if (!(level in ORDER)) throw new Error(`不認識的記錄等級「${level}」（可用：debug、info、warn、error、silent）`);
  current = level;
}

/** 目前的最低等級 */
export function getLogLevel(): LogLevel {
  return current;
}

/**
 * 收到每一則（達到等級的）記錄；回傳取消的函式
 * @param listener 每則記錄都會呼叫（等級、模組、內容）
 */
export function onLog(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(level: LogEntry['level'], module: string, args: unknown[]): void {
  if (ORDER[level] < ORDER[current]) return;
  const entry: LogEntry = { level, module, args };
  for (const l of [...listeners]) l(entry);
  // 第一個參數是文字時接在前綴後面（主控台裡比較好讀，也方便搜尋）
  const out = typeof args[0] === 'string' ? [`[${module}] ${args[0]}`, ...args.slice(1)] : [`[${module}]`, ...args];
  // 每次呼叫時才取 console 的方法：測試替換 console.warn 也收得到
  console[level](...out);
}

/**
 * 建立一個模組的記錄器（模組名稱會出現在每則訊息前面）
 * @param module 模組名稱（顯示在每則訊息前面）
 */
export function createLogger(module: string): Logger {
  return {
    module,
    debug: (...args) => write('debug', module, args),
    info: (...args) => write('info', module, args),
    warn: (...args) => write('warn', module, args),
    error: (...args) => write('error', module, args),
  };
}
