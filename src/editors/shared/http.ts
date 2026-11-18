/**
 * 編輯器呼叫開發伺服器 API（tools/*-plugin.ts）的小工具：
 * 失敗時丟出錯誤，訊息用伺服器回傳的 { error }（沒有時是狀態碼）。
 */

async function send(url: string, init?: RequestInit): Promise<{ text: string; json: boolean }> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* 不是 JSON：直接顯示 */
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return { text, json: res.headers.get('Content-Type')?.includes('json') ?? false };
}

/** 送出請求，回傳文字內容（JSON 也不解析） */
export async function requestText(url: string, init?: RequestInit): Promise<string> {
  return (await send(url, init)).text;
}

/** 送出請求：回應是 JSON 時解析成物件，否則是文字 */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const { text, json } = await send(url, init);
  return (json ? JSON.parse(text) : text) as T;
}
