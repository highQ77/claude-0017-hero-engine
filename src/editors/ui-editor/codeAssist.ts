/**
 * 原始碼編輯的提示：依游標位置判斷正在打什麼（標籤名稱、屬性名稱、屬性值），列出可以用的選項。
 * 純函式，不碰 DOM（方便測試）；顯示的部分在 editor.ts。
 */
import { ATTRIBUTE_HINTS, PALETTE, VALUE_HINTS } from './model';

export type CodeContext =
  /** 打標籤名稱：<UIBu| */
  | { kind: 'tag'; prefix: string; start: number }
  /** 打屬性名稱：<UIButton te| （breakpoint 為 md: 這類前綴） */
  | { kind: 'attr'; tag: string; prefix: string; start: number; breakpoint: string; existing: Set<string> }
  /** 打屬性值：<UIButton style="pri| */
  | { kind: 'value'; tag: string; attr: string; prefix: string; start: number };

/** 分析游標所在位置（不在標籤裡、在註解或結尾標籤裡時回傳 null） */
export function analyzeCode(text: string, caret: number): CodeContext | null {
  const lt = text.lastIndexOf('<', caret - 1);
  if (lt < 0) return null;
  const gt = text.lastIndexOf('>', caret - 1);
  if (gt > lt) return null; // 標籤已經結束
  const before = text.slice(lt + 1, caret);
  if (before.startsWith('!') || before.startsWith('?') || before.startsWith('/')) return null; // 註解、宣告、結尾標籤
  // 標籤名稱
  const tagOnly = /^[\w]*$/.exec(before);
  if (tagOnly) return { kind: 'tag', prefix: before, start: lt + 1 };
  const tag = /^(\w+)/.exec(before)?.[1];
  if (!tag) return null;
  // 在引號裡：屬性值
  const quotes = (before.match(/"/g) ?? []).length;
  if (quotes % 2 === 1) {
    const m = /([\w:-]+)\s*=\s*"([^"]*)$/.exec(before);
    if (!m) return null;
    const attr = m[1].replace(/^\w+:/, ''); // md:dir → dir
    return { kind: 'value', tag, attr, prefix: m[2], start: caret - m[2].length };
  }
  // 屬性名稱：游標前是空白或屬性名稱的一部分（剛打完 = 時不提示）
  const m = /(?:^|\s)([\w:-]*)$/.exec(before);
  if (!m || /=\s*$/.test(before)) return null;
  const word = m[1];
  const colon = word.lastIndexOf(':');
  const breakpoint = colon >= 0 ? word.slice(0, colon + 1) : '';
  const prefix = word.slice(breakpoint.length);
  // 這個標籤已經寫了哪些屬性（含游標後面的部分）
  const close = text.indexOf('>', caret);
  const whole = text.slice(lt + 1, close < 0 ? text.length : close);
  const existing = new Set([...whole.matchAll(/([\w:-]+)\s*=/g)].map((x) => x[1]));
  return { kind: 'attr', tag, prefix, start: caret - prefix.length, breakpoint, existing };
}

export interface Suggestion {
  /** 插入的文字 */
  value: string;
  /** 顯示的名稱 */
  label: string;
  /** 說明 */
  detail?: string;
  /** 右側的小字（預設值、類型） */
  hint?: string;
}

/** 屬性的說明 */
export const ATTR_DOCS: Record<string, string> = {
  id: '元件的名稱，程式用 ui.get("id") 取得',
  style: '套用 <UIStyle name="…"> 定義的樣式（可以用空白隔開多個）',
  width: '寬度：數字（像素）、百分比、auto 或 fit（依內容；<UI> 的 auto 是滿版）',
  height: '高度：數字（像素）、百分比、auto 或 fit（依內容；<UI> 的 auto 是滿版）',
  minWidth: '最小寬度',
  maxWidth: '最大寬度',
  minHeight: '最小高度',
  maxHeight: '最大高度',
  flex: '佔用剩下空間的比例（1 = 填滿）',
  grow: '有多餘空間時放大的比例',
  shrink: '空間不夠時縮小的比例',
  basis: '伸縮前的基本大小',
  margin: '外距："8" 或 "上 右 下 左"',
  padding: '內距："8" 或 "上 右 下 左"',
  gap: '子元件之間的距離',
  dir: '排列方向：v（上到下）、h（左到右）',
  align: '交叉軸對齊：start、center、end、stretch',
  justify: '主軸分布：start、center、end、between、around、evenly',
  self: '自己在父元件裡的對齊（覆蓋父元件的 align）',
  wrap: '空間不夠時換行（true）',
  position: 'absolute：脫離排版，用 left／top／right／bottom 定位',
  left: '絕對定位：左邊距離',
  top: '絕對定位：上方距離',
  right: '絕對定位：右邊距離',
  bottom: '絕對定位：下方距離',
  aspectRatio: '寬高比，例如 16/9',
  hidden: '隱藏（true）',
  pointerEvents: 'none：滑鼠穿透（點擊、滾輪交給後面的介面或遊戲）',
  format: 'FPS 顯示格式：{fps}、{ms}',
  interval: '更新間隔（秒）',
  background: '背景顏色；兩個顏色用逗號隔開是漸層（進度條）',
  radius: '圓角半徑',
  border: '邊框："寬度 顏色"，例如 "1 #fff"',
  opacity: '透明度 0～1',
  shadow: '陰影："x y 模糊 顏色"',
  color: '文字顏色',
  fontSize: '字級（像素）',
  fontWeight: '粗細：normal、bold',
  fontFamily: '字型',
  lineHeight: '行高倍率',
  textAlign: '文字對齊：left、center、right',
  textShadow: '文字陰影："x y 模糊 顏色"',
  text: '顯示的文字（也可以寫在標籤中間）',
  src: '圖片或介面檔（UIComponent）的網址，以介面檔所在的資料夾為準',
  fit: '圖片縮放：contain、cover、fill',
  tint: '濾鏡，例如 grayscale(1)',
  onClick: '點擊時呼叫的處理函式；screen.open:名稱 可以直接開其他畫面',
  onChange: '數值改變時呼叫（勾選框、單選、下拉、滑桿放開…）',
  onInput: '拖曳中持續呼叫（滑桿、搖桿）',
  tooltip: '滑鼠停在上面時顯示的說明',
  tooltipTitle: '浮動說明的標題',
  hoverBackground: '滑鼠移入時的背景',
  pressedBackground: '按下時的背景',
  disabledBackground: '停用時的背景',
  disabled: '停用（true）',
  checked: '已勾選（true）',
  value: '目前的值',
  group: '單選按鈕的分組名稱（同組只能選一個）',
  accent: '強調色（勾選、填滿、選取的顏色）',
  min: '最小值',
  max: '最大值',
  step: '間隔',
  orientation: '方向：horizontal（水平）、vertical（垂直）',
  showValue: '拖曳時顯示數值',
  prefix: '數值前面的文字',
  suffix: '數值後面的文字（例如 %）',
  type: '列表排列：vertical、horizontal、grid',
  columns: 'grid 的欄數',
  scroll: '捲動方向：v、h、both',
  select: '點擊時切換頁面堆疊："堆疊id:頁"',
  activeBackground: 'select 的頁面顯示中時的背景',
  activeColor: 'select 的頁面顯示中時的文字顏色',
  bgImage: '背景圖片',
  bgFit: '背景圖片縮放：cover、contain、fill、tile、none',
  bgPosition: '背景圖片位置：center、top、left…',
  bgSlice: '九宮格切割（圖片像素）：四角不變形',
  bgSliceWidth: '九宮格邊框在畫面上的寬度',
  bgOpacity: '背景圖片透明度',
  bgFilter: '背景圖片濾鏡',
  hoverBgImage: '滑鼠移入時的背景圖片',
  pressedBgImage: '按下時的背景圖片',
  disabledBgImage: '停用時的背景圖片',
  name: '名稱（UIStyle 的樣式名稱、UIIcon 的圖示名稱）',
  for: '這份外觀套用到哪種元件，例如 UIButton',
  title: '標題（視窗、分頁）',
  closable: '顯示關閉鈕',
  draggable: '可以拖曳',
  shape: '形狀：radial（圓形進度）、circle／square（小地圖）',
  fill: '填滿顏色，兩個顏色用逗號隔開是漸層',
  showText: '顯示數值文字',
  textFormat: '文字格式：{value} {max} {percent}',
  ringWidth: '圓形進度的環寬',
  animate: '數值變化的動畫時間（秒）',
  icon: '物品圖片',
  iconName: '內建圖示名稱',
  count: '數量（1 不顯示）',
  rarity: '稀有度：common、uncommon、rare、epic、legendary',
  speaker: '說話者名稱',
  portrait: '頭像圖片',
  speed: '每秒顯示幾個字',
  autoplay: '一開始就逐字播放',
  transition: '切換動畫：slide、fade、none',
  indicator: '頁面指示：dots',
  swipe: '可以左右滑動換頁',
  loop: '最後一頁再往後回到第一頁',
  range: '小地圖顯示範圍（世界單位）',
  rotate: '跟著玩家轉向',
  placement: '提示訊息的位置：top、bottom',
  sortable: '點標題排序',
  selectable: '點列選取',
  striped: '斑馬紋',
  key: '欄位對應的資料名稱',
  sort: '排序方式：number、text、none',
  label: '選項顯示的文字（沒寫時用內容文字）',
  baseColor: '搖桿底座的顏色',
  boxSize: '勾選框、開關的大小（像素）',
  cellPadding: '儲存格的內距',
  checkColor: '勾的顏色',
  deadzone: '死區（0~1）：推得比這個小視為沒推',
  dot: '只顯示一個紅點（不顯示數字）',
  dotColor: '頁面指示點的顏色',
  duration: '切換頁面的動畫秒數',
  emptyText: '沒有資料時顯示的文字',
  grid: '格線間距（世界單位；0 不畫格線）',
  gridColor: '格線的顏色',
  headerBackground: '標題列的背景',
  headerColor: '標題列的文字顏色',
  iconColor: '內建圖示的顏色',
  itemBackground: '每則提示訊息的背景',
  knobColor: '圓鈕的顏色',
  knobSize: '圓鈕的大小（像素）',
  length: '滑桿的長度（像素）',
  markerColor: '標記的預設顏色',
  markerSize: '標記的預設大小（像素）',
  maskColor: '冷卻遮罩的顏色',
  maxItems: '展開時最多顯示幾個選項（超過可以捲動）',
  nameColor: '說話者名稱的顏色',
  onChoose: '選了對話選項時呼叫（event.value 是選項的值）',
  onClose: '視窗關閉時呼叫',
  onDone: '對話全部顯示完時呼叫',
  onDragend: '拖曳結束時呼叫',
  onDragstart: '開始拖曳時呼叫',
  onDrop: '有東西拖放到這裡時呼叫（event.source 是被拖過來的元件）',
  onEnd: '放開搖桿時呼叫',
  onMove: '視窗被拖曳移動後呼叫',
  onNext: '點對話框繼續時呼叫（打字已經顯示完）',
  onOpen: '視窗打開時呼叫',
  onReady: '冷卻結束時呼叫',
  onScroll: '捲動時呼叫',
  onSelect: '點選一列時呼叫（event.item 是那一列的資料）',
  onSort: '點標題排序時呼叫',
  offColor: '開關關閉時的顏色',
  placeholder: '還沒選時顯示的提示文字',
  playerColor: '玩家標記的顏色',
  popupBackground: '展開選單的背景',
  ringColor: '搖桿外圈的顏色',
  rowHoverBackground: '滑鼠移到列上時的背景',
  scrollbarColor: '捲軸的顏色',
  selected: '是否選中（顯示選中的外觀）',
  selectedBackground: '選中列的背景',
  selectedColor: '選中列的文字顏色',
  showPlayer: '是否在中心顯示玩家標記',
  showZero: '數字是 0 時也顯示',
  size: '圖示大小（像素）',
  startAngle: '圓形進度的起點角度（度，0 為正上方）',
  stripeBackground: '斑馬紋的背景（隔行）',
  strokeWidth: '圖示線條的粗細',
  switchWidth: '開關的寬度（像素）',
  tabBackground: '分頁標籤的背景',
  tabColor: '分頁標籤的文字顏色',
  tabHoverBackground: '滑鼠移到分頁標籤上時的背景',
  thickness: '滑桿軌道的粗細（像素）',
  thumbColor: '滑桿圓鈕的顏色',
  thumbSize: '滑桿圓鈕的大小（像素）',
  titleColor: '標題文字的顏色',
  trackColor: '軌道（未填滿部分）的顏色',
  trackHeight: '軌道的高度（像素）',
  trailColor: '減少時殘影的顏色',
  vertical: '垂直方向（由下往上填滿）',
  cursor: '滑鼠移到這個元件上時的游標（pointer、grab、text…；可以點的元件預設 pointer）',
  tooltipColor: '浮動說明的強調色（標題、邊框）',
  tooltipDelay: '滑鼠停留幾秒後顯示浮動說明（預設 0.45）',
  tooltipFontSize: '浮動說明的字級（預設 13）',
  tooltipWidth: '浮動說明的最大寬度（像素，預設 240）',
};

/** 子元件（不是一般元件，只能放在特定元件裡） */
const CHILD_TAGS: Record<string, string> = {
  UIStyle: '樣式：<UIStyle name="…" 屬性…/>，元件用 style="名稱" 套用',
  UISkin: '外觀：<UISkin for="UIButton" 屬性…/>，同一種元件的預設樣子',
  UIImport: '匯入另一個檔案的樣式與外觀：<UIImport src="theme.xml"/>（共用主題）',
  UITemplate: '列表樣板（放在 UIList 裡），{欄位} 會換成資料',
  UIOption: '下拉選單的選項（放在 UISelect 裡）',
  UIChoice: '對話的選項（放在 UIDialogue 裡）',
  UIColumn: '表格欄位（放在 UITable 裡）',
  UIRow: '表格資料列（放在 UITable 裡）',
  UITab: '分頁的一頁（放在 UITabs 裡）',
};

const tagDesc = (tag: string): string | undefined => PALETTE.find((p) => p.tag === tag)?.desc ?? CHILD_TAGS[tag];

/** 名稱 a → z（不分大小寫，例如 background、bgImage、border） */
const byName = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** 依前綴過濾：開頭相符的排前面，其次是包含（各自維持原本的順序） */
function rank(items: Suggestion[], prefix: string): Suggestion[] {
  const p = prefix.toLowerCase();
  if (!p) return items;
  const starts = items.filter((s) => s.label.toLowerCase().startsWith(p));
  const contains = items.filter((s) => !s.label.toLowerCase().startsWith(p) && s.label.toLowerCase().includes(p));
  return [...starts, ...contains];
}

export interface SuggestOptions {
  /** 可以用的元件名稱 */
  components: string[];
  /** 文件裡定義的樣式名稱 */
  styles?: string[];
  /** 元件的預設屬性（顯示預設值） */
  defaults?: (tag: string) => Record<string, string>;
}

export function suggest(ctx: CodeContext, options: SuggestOptions): Suggestion[] {
  if (ctx.kind === 'tag') {
    const tags = [...new Set([...options.components, ...Object.keys(CHILD_TAGS)])].filter((t) => t !== 'UIDialog');
    return rank(
      tags.sort().map((t) => ({ value: t, label: t, detail: tagDesc(t) })),
      ctx.prefix,
    );
  }
  if (ctx.kind === 'attr') {
    const own = ATTRIBUTE_HINTS[ctx.tag] ?? [];
    // 依字母 a → z 排列（不分大小寫）；元件專屬的屬性在右邊標示元件名稱
    // <UIComponent> 的寬高由外部檔案的 <UI width height> 決定，不提示
    const names = [...new Set([...own, ...ATTRIBUTE_HINTS.common])]
      .filter((n) => ctx.tag !== 'UIComponent' || (n !== 'width' && n !== 'height'))
      .sort(byName);
    const defaults = options.defaults?.(ctx.tag) ?? {};
    const items = names
      .filter((n) => !ctx.existing.has(ctx.breakpoint + n))
      .map((n) => ({
        value: n,
        label: n,
        detail: ATTR_DOCS[n],
        hint: defaults[n] !== undefined ? `預設 ${defaults[n]}` : own.includes(n) ? ctx.tag : undefined,
      }));
    return rank(items, ctx.prefix);
  }
  // 屬性值
  let values: string[] = VALUE_HINTS[ctx.attr] ?? [];
  if (ctx.attr === 'style') values = options.styles ?? [];
  if (ctx.attr === 'for') values = options.components.filter((t) => t !== 'UI' && t !== 'UIDialog');
  if (/^on[A-Z]/.test(ctx.attr))
    values = ['screen.back', 'screen.close', 'screen.open:', 'screen.show:', 'screen.toggle:'];
  return rank(
    values.map((v) => ({ value: v, label: v })),
    ctx.prefix,
  );
}
