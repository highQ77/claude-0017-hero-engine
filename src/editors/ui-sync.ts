/**
 * UI 編輯器與 3D 場景編輯器之間的即時同步（同一個瀏覽器的不同分頁，用 BroadcastChannel）：
 * UI 編輯器每次修改都送出目前的內容（還沒存檔也會），3D 場景編輯器的 UI 層收到後馬上重新顯示。
 *
 *   { type: 'draft', name: 'orbit/hud.xml', text: '<UI>…' }   內容改了（name 相對於 public/ui）
 *   { type: 'saved', name: 'orbit/hud.xml' }                    存檔或捨棄修改：以磁碟上的檔案為準
 *   { type: 'request' }                                          3D 場景編輯器剛打開：請 UI 編輯器送出還沒存檔的內容
 */

/** 頻道名稱 */
export const UI_SYNC_CHANNEL = 'hero-ui-editor';

/** 頻道裡的訊息 */
export type UISyncMessage =
  | { type: 'draft'; name: string; text: string }
  | { type: 'saved'; name: string }
  | { type: 'request' };

/** 打開同步頻道（瀏覽器不支援時是 null） */
export function openUISyncChannel(onMessage?: (msg: UISyncMessage) => void): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(UI_SYNC_CHANNEL);
  if (onMessage)
    channel.addEventListener('message', (e: MessageEvent<UISyncMessage>) => {
      if (e.data && typeof e.data === 'object' && typeof e.data.type === 'string') onMessage(e.data);
    });
  return channel;
}

/** UI 編輯器的檔名（相對於 public/ui）→ 遊戲裡的網址（相對於 public） */
export const uiUrl = (name: string) => `ui/${name}`;

/** 遊戲裡的網址 → UI 編輯器的檔名（不在 ui/ 裡時回傳 null） */
export function uiEditorName(url: string): string | null {
  const path = url.replace(/^(\.\/|\/)+/, '');
  return path.startsWith('ui/') ? path.slice(3) : null;
}
