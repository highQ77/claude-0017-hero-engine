/**
 * 編輯器的文件模型：XML 樹的操作與輸出（純函式，方便測試）。
 * 節點用「路徑」定位：從根元素開始，每一層在 children 裡的索引。
 */
import { COMMENT_TAG, parseXml, type XmlNode } from '../../ui2d/xml';

export type Path = number[];

/** 可以放子元件的元件 */
export const CONTAINER_TAGS = new Set([
  'UI',
  'UILayout',
  'UIButton',
  'UIList',
  'UIWindow',
  'UITabs',
  'UITab',
  'UIScrollView',
  'UISlot',
  'UIStackView',
]);

export function isContainer(node: XmlNode): boolean {
  // 下拉選單裡只能放 UIOption，不當成一般容器
  const leaves = [
    'UILabel',
    'UIImage',
    'UIStyle',
    'UITemplate',
    'UICheckBox',
    'UIRadioButton',
    'UISelect',
    'UIOption',
    'UISlider',
    'UIProgressBar',
    'UIToggle',
    'UIIcon',
    'UIToast',
    'UICooldown',
    'UIBadge',
    'UIDialogue',
    'UIDialog',
    'UIChoice',
    'UIJoystick',
    'UIMinimap',
    'UITable',
    'UIColumn',
    'UIRow',
    'UIRichText',
    'UISkin',
    COMMENT_TAG,
  ];
  return CONTAINER_TAGS.has(node.tag) || (!leaves.includes(node.tag) && node.children.length > 0);
}

/** 是否為一般元件（不是註解、樣式定義） */
export function isElement(node: XmlNode): boolean {
  return node.tag !== COMMENT_TAG && node.tag !== 'UIStyle' && node.tag !== 'UISkin';
}

export function parseDocument(text: string): XmlNode {
  return parseXml(text, { voidTags: ['UIImage', 'UIStyle', 'UISkin', 'UIColumn', 'UIRow'], keepComments: true });
}

// ───────── 輸出 ─────────

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escapeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 把樹輸出成縮排整齊的 XML（保留註解） */
export function serialize(root: XmlNode, indent = '  '): string {
  const out: string[] = [];
  const write = (node: XmlNode, depth: number) => {
    const pad = indent.repeat(depth);
    if (node.tag === COMMENT_TAG) {
      out.push(`${pad}<!--${node.text}-->`);
      return;
    }
    const attrs = Object.entries(node.attrs)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('');
    const open = `${pad}<${node.tag}${attrs}`;
    if (node.children.length === 0 && !node.text) {
      out.push(`${open}/>`);
    } else if (node.children.length === 0) {
      out.push(`${open}>${escapeText(node.text)}</${node.tag}>`);
    } else {
      out.push(`${open}>`);
      if (node.text) out.push(`${pad}${indent}${escapeText(node.text)}`);
      for (const c of node.children) write(c, depth + 1);
      out.push(`${pad}</${node.tag}>`);
    }
  };
  for (const c of root.prolog ?? []) write(c, 0);
  write(root, 0);
  for (const c of root.epilogue ?? []) write(c, 0);
  return `${out.join('\n')}\n`;
}

// ───────── 路徑 ─────────

export function nodeAt(root: XmlNode, path: Path): XmlNode | undefined {
  let node: XmlNode | undefined = root;
  for (const i of path) node = node?.children[i];
  return node;
}

export function pathOf(root: XmlNode, target: XmlNode): Path | null {
  if (root === target) return [];
  for (let i = 0; i < root.children.length; i++) {
    const sub = pathOf(root.children[i], target);
    if (sub) return [i, ...sub];
  }
  return null;
}

/** 依原始碼行號找節點（取該行第一個元件） */
export function pathAtLine(root: XmlNode, line: number): Path | null {
  if (root.line === line) return [];
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (!isElement(c)) continue;
    const sub = pathAtLine(c, line);
    if (sub) return [i, ...sub];
  }
  return null;
}

export function parentPath(path: Path): Path {
  return path.slice(0, -1);
}

export function samePath(a: Path | null, b: Path | null): boolean {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** a 是否為 b 的祖先（或相同） */
export function isAncestorPath(a: Path, b: Path): boolean {
  return a.length <= b.length && a.every((v, i) => v === b[i]);
}

// ───────── 結構操作（都會修改傳入的樹，回傳新位置） ─────────

export function cloneNode(node: XmlNode): XmlNode {
  return { tag: node.tag, attrs: { ...node.attrs }, text: node.text, line: 0, children: node.children.map(cloneNode) };
}

/** 插入節點到 parent 的 index 位置 */
export function insertNode(root: XmlNode, parent: Path, index: number, node: XmlNode): Path {
  const p = nodeAt(root, parent);
  if (!p) throw new Error('找不到要插入的位置');
  const i = Math.max(0, Math.min(index, p.children.length));
  p.children.splice(i, 0, node);
  return [...parent, i];
}

export function removeNode(root: XmlNode, path: Path): XmlNode {
  if (path.length === 0) throw new Error('不能刪除最外層的元件');
  const p = nodeAt(root, parentPath(path))!;
  return p.children.splice(path[path.length - 1], 1)[0];
}

/** 移動節點到新的父節點與位置，回傳移動後的路徑 */
export function moveNode(root: XmlNode, from: Path, toParent: Path, toIndex: number): Path {
  if (from.length === 0) throw new Error('不能移動最外層的元件');
  if (isAncestorPath(from, toParent)) throw new Error('不能把元件移到自己裡面');
  const fromParent = parentPath(from);
  const fromIndex = from[from.length - 1];
  const node = removeNode(root, from);
  // 同一層往後移：移除後索引要減一
  let index = toIndex;
  if (samePath(fromParent, toParent) && fromIndex < toIndex) index--;
  // 移除後，若目標父節點路徑在被移除節點之後，要調整
  const adjusted = toParent.map((v, depth) =>
    depth === fromParent.length && samePath(fromParent, toParent.slice(0, depth)) && v > fromIndex ? v - 1 : v,
  );
  return insertNode(root, adjusted, index, node);
}

/** 在同一層前後移動 */
export function shiftNode(root: XmlNode, path: Path, delta: -1 | 1): Path {
  const parent = parentPath(path);
  const p = nodeAt(root, parent)!;
  const i = path[path.length - 1];
  let j = i + delta;
  // 跳過註解等非元件
  while (j >= 0 && j < p.children.length && !isElement(p.children[j])) j += delta;
  if (j < 0 || j >= p.children.length) return path;
  [p.children[i], p.children[j]] = [p.children[j], p.children[i]];
  return [...parent, j];
}

export function duplicateNode(root: XmlNode, path: Path): Path {
  if (path.length === 0) throw new Error('不能複製最外層的元件');
  const node = nodeAt(root, path)!;
  const copy = cloneNode(node);
  delete copy.attrs.id; // id 要唯一
  return insertNode(root, parentPath(path), path[path.length - 1] + 1, copy);
}

/**
 * 決定新元件要放哪裡：選到排版容器或列表就放進去最後面，選到其他元件就放在它後面。
 */
export function insertionPoint(root: XmlNode, selected: Path | null): { parent: Path; index: number } {
  if (!selected) return { parent: [], index: root.children.length };
  const node = nodeAt(root, selected);
  // 只有排版容器與列表會放進去；按鈕雖然也能放子元件，但點選後新增通常是想加在旁邊
  // （要放進按鈕可以在結構樹上拖進去）
  if (node && ['UI', 'UILayout', 'UIList', 'UIWindow', 'UITab', 'UIScrollView', 'UIStackView'].includes(node.tag))
    return { parent: selected, index: node.children.length };
  if (selected.length === 0) return { parent: [], index: root.children.length };
  return { parent: parentPath(selected), index: selected[selected.length - 1] + 1 };
}

/** 元件面板的預設內容 */
/** 元件庫：中文名稱、元件英文名稱、插入的 XML */
export interface PaletteItem {
  label: string;
  tag: string;
  group: string;
  /** 元件說明（滑鼠移到元件庫按鈕上時顯示） */
  desc: string;
  xml: string;
}

export const PALETTE: PaletteItem[] = [
  // 基本
  {
    group: '基本',
    label: '文字',
    tag: 'UILabel',
    desc: '顯示文字，會依寬度自動換行。可設字級、顏色、粗細、對齊、文字陰影。',
    xml: '<UILabel>文字</UILabel>',
  },
  {
    group: '基本',
    label: '多樣式文字',
    tag: 'UIRichText',
    desc: '同一段文字混用粗體、顏色、大小與圖示，例如「造成 120 點🔥傷害」。標記：[b] [i] [u] [color=#f55] [size=22] [bg=#333] [icon=fire] [br]。',
    xml: '<UIRichText>造成 [b][color=#ff6b6b]120[/color][/b] 點 [icon=fire color=#ffb347] 火焰傷害</UIRichText>',
  },
  {
    group: '基本',
    label: '圖片',
    tag: 'UIImage',
    desc: '顯示圖片。只給寬或高時維持比例；fit 可設 contain、cover、fill。',
    xml: '<UIImage src="coin.png" width="48"/>',
  },
  {
    group: '基本',
    label: '按鈕',
    tag: 'UIButton',
    desc: '可以點擊，觸發 onClick。有滑鼠移入、按下、停用的外觀，裡面也能放圖示等元件。',
    xml: '<UIButton text="按鈕"/>',
  },
  {
    group: '基本',
    label: '圖示',
    tag: 'UIIcon',
    desc: '內建 41 個向量圖示（愛心、金幣、劍、盾、齒輪…），不需要圖檔，可以換顏色與大小。',
    xml: '<UIIcon name="heart" size="28" color="#ff5a5a"/>',
  },
  {
    group: '基本',
    label: '進度條',
    tag: 'UIProgressBar',
    desc: '血條、經驗值、載入進度。數值變化有動畫，減少時會留下殘影；可用兩色漸層。',
    xml: '<UIProgressBar value="70" max="100" fill="#ff5a5a,#ffb347" showText="true"/>',
  },
  {
    group: '基本',
    label: '圓形進度',
    tag: 'UIProgressBar',
    desc: '環狀的進度條（shape="radial"）：圓形血量、技能充能、載入轉圈。中間可以顯示百分比，ringWidth 設環的粗細，一樣有動畫與殘影。',
    xml: '<UIProgressBar shape="radial" value="65" width="72" height="72" fill="#9acd32,#4fd1c5" showText="true"/>',
  },
  {
    group: '基本',
    label: '提示訊息',
    tag: 'UIToast',
    desc: '放一次在介面裡，程式用 ui.toast("文字") 顯示會自動淡出的訊息，例如「獲得金幣」。',
    xml: '<UIToast placement="top"/>',
  },
  // 版面
  {
    group: '版面',
    label: '圖片背景',
    tag: 'bgImage',
    desc: '任何元件都可以加背景圖片：<UIxxx bgImage="圖.png">。bgFit 設 cover／contain／fill／tile（重複）；bgSlice="16" 九宮格（四角不變形，適合做框與按鈕）；hoverBgImage、pressedBgImage 是滑鼠移入、按下時的圖片；bgOpacity、bgFilter 調整透明度與濾鏡。',
    xml: '<UILayout padding="22" gap="8" bgImage="frame.svg" bgSlice="16"><UILabel fontSize="18" fontWeight="bold" color="#c8f07a">九宮格面板</UILabel><UILabel fontSize="13" color="#b8c0ae">四角保持原樣，邊與中間自動延伸</UILabel></UILayout>',
  },
  {
    group: '版面',
    label: '垂直排版',
    tag: 'UILayout',
    desc: '把子元件由上到下排列。用 gap 設間距、padding 設內距、align／justify 對齊。',
    xml: '<UILayout dir="v" gap="8" padding="8"/>',
  },
  {
    group: '版面',
    label: '水平排版',
    tag: 'UILayout',
    desc: '把子元件由左到右排列；加上 wrap="true" 空間不夠時會換行。',
    xml: '<UILayout dir="h" gap="8" padding="8" align="center"/>',
  },
  {
    group: '版面',
    label: '垂直列表',
    tag: 'UIList',
    desc: '可以捲動的直向列表。搭配 <UITemplate> 與 ui.setItems() 可以用資料產生項目。',
    xml: '<UIList type="vertical" height="160" gap="6"><UILabel>項目 1</UILabel><UILabel>項目 2</UILabel><UILabel>項目 3</UILabel></UIList>',
  },
  {
    group: '版面',
    label: '水平列表',
    tag: 'UIList',
    desc: '可以左右捲動的列表，適合卡片、關卡選擇。',
    xml: '<UIList type="horizontal" height="80" gap="8"><UIButton text="A"/><UIButton text="B"/><UIButton text="C"/></UIList>',
  },
  {
    group: '版面',
    label: '格狀列表',
    tag: 'UIList',
    desc: '依 columns 自動排成格子，例如背包、商店。',
    xml: '<UIList type="grid" columns="3" height="200" gap="8"><UIButton text="1"/><UIButton text="2"/><UIButton text="3"/><UIButton text="4"/></UIList>',
  },
  {
    group: '版面',
    label: '捲動區',
    tag: 'UIScrollView',
    desc: '任何內容都能捲動（垂直、水平或兩個方向），會顯示捲軸。',
    xml: '<UIScrollView height="160" scroll="v"><UILabel>很長的內容…</UILabel></UIScrollView>',
  },
  {
    group: '版面',
    label: '頁面堆疊',
    tag: 'UIStackView',
    desc: '一次只顯示一頁，切換時有滑動動畫。任何按鈕加上 select="堆疊id:頁" 就能切換頁面（自己做分頁），也可以左右滑動。',
    xml: '<UILayout gap="8"><UILayout dir="h" gap="6"><UIButton text="第一頁" select="pages:0" activeBackground="#9acd32" activeColor="#141a07"/><UIButton text="第二頁" select="pages:1" activeBackground="#9acd32" activeColor="#141a07"/></UILayout><UIStackView id="pages" height="120" indicator="dots" swipe="true"><UILayout padding="12" background="rgba(255,255,255,0.05)" radius="10"><UILabel>第一頁的內容</UILabel></UILayout><UILayout padding="12" background="rgba(255,255,255,0.05)" radius="10"><UILabel>第二頁的內容</UILabel></UILayout></UIStackView></UILayout>',
  },
  {
    group: '版面',
    label: '視窗',
    tag: 'UIWindow',
    desc: '有標題列與關閉鈕的對話框，可以拖曳標題列移動。裡面的元件放在內容區。',
    xml: '<UIWindow title="視窗" width="300"><UILabel>內容</UILabel></UIWindow>',
  },
  {
    group: '版面',
    label: '外部介面',
    tag: 'UIComponent',
    desc: '把另一個 XML 介面檔的內容放進來（重複使用同一份介面，例如卡片、對話框）：<UIComponent src="card.xml"/>。外部檔案的 <UIStyle>、<UISkin> 只套用在裡面；根元素 <UI> 的屬性也會套用，自己寫的屬性優先；寬高只能寫在外部檔案的 <UI width="…" height="…">（UIComponent 上的寬高會被忽略）。',
    xml: '<UIComponent src=""/>',
  },
  {
    group: '版面',
    label: '分頁',
    tag: 'UITabs',
    desc: '上方是分頁標籤、下方是內容，點標籤切換。每一頁用 <UITab title="…">。',
    xml: '<UITabs value="0"><UITab title="分頁一"><UILabel>第一頁</UILabel></UITab><UITab title="分頁二"><UILabel>第二頁</UILabel></UITab></UITabs>',
  },
  {
    group: '版面',
    label: '表格',
    tag: 'UITable',
    desc: '標題列加資料列，點標題排序、點資料列選取（onSelect）。欄位用 <UIColumn>，資料用 <UIRow> 或 table.setRows()。',
    xml: '<UITable height="180"><UIColumn key="rank" title="#" width="44" align="center"/><UIColumn key="name" title="玩家"/><UIColumn key="score" title="分數" width="90" align="right"/><UIRow rank="1" name="小明" score="1200"/><UIRow rank="2" name="阿華" score="980"/><UIRow rank="3" name="Bob" score="760"/></UITable>',
  },
  // 表單
  {
    group: '表單',
    label: '勾選框',
    tag: 'UICheckBox',
    desc: '點擊切換勾選，觸發 onChange（event.checked）。',
    xml: '<UICheckBox text="選項" checked="true"/>',
  },
  {
    group: '表單',
    label: '開關',
    tag: 'UIToggle',
    desc: '切換開關，比勾選框更像遊戲設定；切換時圓鈕有滑動動畫。',
    xml: '<UIToggle text="開關" checked="true"/>',
  },
  {
    group: '表單',
    label: '單選按鈕',
    tag: 'UIRadioButton',
    desc: '同一個 group 裡只能選一個，觸發 onChange（event.value）。',
    xml: '<UILayout dir="h" gap="12"><UIRadioButton group="choice" value="a" text="A" checked="true"/><UIRadioButton group="choice" value="b" text="B"/></UILayout>',
  },
  {
    group: '表單',
    label: '下拉選單',
    tag: 'UISelect',
    desc: '點擊展開選項（蓋在所有介面之上），選項用 <UIOption>。',
    xml: '<UISelect value="1"><UIOption value="1">選項一</UIOption><UIOption value="2">選項二</UIOption><UIOption value="3">選項三</UIOption></UISelect>',
  },
  {
    group: '表單',
    label: '水平滑桿',
    tag: 'UISlider',
    desc: '左右拖曳選擇數值（左邊是最小值），拖曳中觸發 onInput、放開觸發 onChange；可顯示數值提示。用 orientation 切換水平／垂直。',
    xml: '<UISlider orientation="horizontal" min="0" max="100" step="1" value="50" showValue="true"/>',
  },
  {
    group: '表單',
    label: '垂直滑桿',
    tag: 'UISlider',
    desc: '上下拖曳選擇數值（下方是最小值），適合音量推桿、等化器。數值提示顯示在圓點右側；length 設長度、thickness 設粗細。',
    xml: '<UISlider orientation="vertical" length="160" min="0" max="100" step="1" value="50" showValue="true"/>',
  },
  // 遊戲
  {
    group: '遊戲',
    label: '物品格',
    tag: 'UISlot',
    desc: '背包、快捷列的格子：圖示、數量、稀有度外框。可以拖到另一格（onDrop）。',
    xml: '<UISlot iconName="sword" count="3" rarity="epic" tooltip="傷害 +12" tooltipTitle="鐵劍"/>',
  },
  {
    group: '遊戲',
    label: '冷卻遮罩',
    tag: 'UICooldown',
    desc: '放在物品格或按鈕裡，start(秒) 後顯示扇形遮罩與倒數，結束觸發 onReady；不擋點擊。',
    xml: '<UISlot iconName="fire"><UICooldown value="0.4"/></UISlot>',
  },
  {
    group: '遊戲',
    label: 'FPS 顯示',
    tag: 'UIFpsMeter',
    desc: '內建的畫面更新率顯示，依 FPS 變色（綠／黃／紅）。預設 pointerEvents="none"：滑鼠會穿透，不影響遊戲操作。format 可以用 {fps}、{ms}。',
    xml: '<UIFpsMeter format="FPS {fps} · {ms} ms"/>',
  },
  {
    group: '遊戲',
    label: '角標',
    tag: 'UIBadge',
    desc: '紅點或數字通知，放在父元件右上角。超過上限顯示 99+，為 0 時自動隱藏。',
    xml: '<UIButton text="任務"><UIBadge value="3"/></UIButton>',
  },
  {
    group: '遊戲',
    label: '對話框',
    tag: 'UIDialogue',
    desc: 'RPG 對話：頭像、名字、逐字打字效果，內容可以用多樣式文字標記。點擊跳過或下一句（onNext），選項用 <UIChoice>（onChoose）。舊名稱 UIDialog 仍可使用。',
    xml: '<UIDialogue speaker="村長">歡迎來到村子！<UIChoice value="quest">有什麼任務嗎？</UIChoice><UIChoice value="bye">再見</UIChoice></UIDialogue>',
  },
  {
    group: '遊戲',
    label: '虛擬搖桿',
    tag: 'UIJoystick',
    desc: '手機操作用：拖曳圓鈕得到 x、y（-1～1），觸發 onInput，放開會彈回中央。',
    xml: '<UIJoystick width="120" height="120"/>',
  },
  {
    group: '遊戲',
    label: '小地圖',
    tag: 'UIMinimap',
    desc: '俯視小地圖：格線、標記、玩家方向。搭配 MinimapPlugin 會自動顯示有 MinimapMarker 的實體。',
    xml: '<UIMinimap width="160" height="160" range="30"/>',
  },
];

export function paletteNode(xml: string): XmlNode {
  const node = parseDocument(xml);
  delete node.prolog;
  delete node.epilogue;
  return node;
}

/** 每種元件常用的屬性（屬性面板的建議清單） */
export const ATTRIBUTE_HINTS: Record<string, string[]> = {
  common: [
    'id',
    'style',
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'flex',
    'grow',
    'shrink',
    'margin',
    'padding',
    'gap',
    'align',
    'justify',
    'self',
    'position',
    'left',
    'top',
    'right',
    'bottom',
    'aspectRatio',
    'hidden',
    'pointerEvents',
    'background',
    'radius',
    'border',
    'opacity',
    'shadow',
    'onClick',
    'tooltip',
    'tooltipTitle',
    'tooltipColor',
    'tooltipDelay',
    'tooltipFontSize',
    'tooltipWidth',
    'cursor',
    'select',
    'activeBackground',
    'activeColor',
    'hoverBackground',
    'bgImage',
    'bgFit',
    'bgPosition',
    'bgSlice',
    'bgSliceWidth',
    'bgOpacity',
    'bgFilter',
    'hoverBgImage',
    'pressedBgImage',
    'disabledBgImage',
  ],
  UILayout: ['dir', 'wrap'],
  UI: ['dir'],
  UILabel: ['text', 'fontSize', 'fontWeight', 'fontFamily', 'color', 'textAlign', 'lineHeight', 'textShadow'],
  UIImage: ['src', 'fit', 'tint'],
  UIComponent: ['src', 'dir', 'gap', 'padding', 'align', 'justify'],
  UIButton: ['text', 'color', 'fontSize', 'hoverBackground', 'pressedBackground', 'disabled', 'disabledBackground'],
  UIList: ['type', 'columns'],
  UICheckBox: ['text', 'checked', 'disabled', 'onChange', 'boxSize', 'accent', 'checkColor', 'color', 'fontSize'],
  UIRadioButton: [
    'text',
    'group',
    'value',
    'checked',
    'disabled',
    'onChange',
    'boxSize',
    'accent',
    'color',
    'fontSize',
  ],
  UISelect: [
    'value',
    'placeholder',
    'onChange',
    'disabled',
    'maxItems',
    'popupBackground',
    'accent',
    'color',
    'fontSize',
  ],
  UIOption: ['value', 'label'],
  UISlider: [
    'value',
    'min',
    'max',
    'step',
    'orientation',
    'length',
    'thickness',
    'showValue',
    'prefix',
    'suffix',
    'onInput',
    'onChange',
    'disabled',
    'thumbSize',
    'trackHeight',
    'accent',
    'trackColor',
    'thumbColor',
  ],
  UIProgressBar: [
    'value',
    'min',
    'max',
    'shape',
    'ringWidth',
    'startAngle',
    'fill',
    'trackColor',
    'trailColor',
    'animate',
    'showText',
    'textFormat',
    'vertical',
    'color',
    'fontSize',
  ],
  UIToggle: [
    'text',
    'checked',
    'disabled',
    'onChange',
    'accent',
    'offColor',
    'knobColor',
    'boxSize',
    'switchWidth',
    'color',
    'fontSize',
  ],
  UIIcon: ['name', 'size', 'color', 'strokeWidth'],
  UIToast: ['placement', 'max', 'itemBackground', 'accent', 'color', 'fontSize'],
  UIWindow: ['title', 'closable', 'draggable', 'onClose', 'onOpen', 'onMove', 'headerBackground', 'titleColor'],
  UITabs: ['value', 'onChange', 'accent', 'tabBackground', 'tabHoverBackground', 'tabColor', 'activeColor', 'fontSize'],
  UITab: ['title', 'dir'],
  UIScrollView: ['scroll', 'dir', 'onScroll', 'scrollbarColor'],
  UISlot: [
    'icon',
    'iconName',
    'iconColor',
    'count',
    'rarity',
    'selected',
    'draggable',
    'disabled',
    'onDrop',
    'onDragstart',
    'onDragend',
    'accent',
  ],
  UICooldown: ['value', 'maskColor', 'showText', 'color', 'fontSize', 'onReady'],
  UIBadge: ['value', 'max', 'dot', 'showZero', 'color', 'fontSize'],
  UIDialogue: [
    'speaker',
    'portrait',
    'text',
    'speed',
    'autoplay',
    'nameColor',
    'color',
    'fontSize',
    'onNext',
    'onChoose',
    'onDone',
    'indicator',
  ],
  UIChoice: ['value'],
  UIJoystick: ['deadzone', 'knobSize', 'baseColor', 'ringColor', 'knobColor', 'accent', 'onInput', 'onEnd'],
  UIStackView: ['value', 'transition', 'duration', 'indicator', 'swipe', 'loop', 'onChange', 'accent', 'dotColor'],
  UITable: [
    'onSelect',
    'onSort',
    'sortable',
    'selectable',
    'striped',
    'cellPadding',
    'headerBackground',
    'headerColor',
    'stripeBackground',
    'rowHoverBackground',
    'selectedBackground',
    'selectedColor',
    'color',
    'fontSize',
    'emptyText',
  ],
  UIColumn: ['key', 'title', 'width', 'flex', 'align', 'sort'],
  UIRow: [],
  UIRichText: ['text', 'fontSize', 'fontWeight', 'fontFamily', 'color', 'lineHeight', 'textAlign'],
  UISkin: ['for'],
  UIImport: ['src'],
  UIFpsMeter: ['format', 'interval', 'color', 'fontSize'],
  UIMinimap: [
    'range',
    'shape',
    'rotate',
    'grid',
    'gridColor',
    'playerColor',
    'markerColor',
    'markerSize',
    'showPlayer',
  ],
};

const ICON_HINTS = [
  'heart',
  'star',
  'coin',
  'gem',
  'gear',
  'close',
  'check',
  'plus',
  'minus',
  'play',
  'pause',
  'home',
  'menu',
  'search',
  'lock',
  'sound',
  'mute',
  'sword',
  'shield',
  'potion',
  'bolt',
  'fire',
  'clock',
  'info',
  'warning',
  'user',
  'trophy',
  'bag',
  'map',
  'refresh',
  'arrowUp',
  'arrowDown',
  'arrowLeft',
  'arrowRight',
  'chevronUp',
  'chevronDown',
  'chevronLeft',
  'chevronRight',
  'chat',
  'flag',
  'target',
];

/** 屬性值的建議 */
export const VALUE_HINTS: Record<string, string[]> = {
  dir: ['v', 'h'],
  pointerEvents: ['none', 'auto'],
  align: ['start', 'center', 'end', 'stretch'],
  self: ['start', 'center', 'end', 'stretch'],
  justify: ['start', 'center', 'end', 'between', 'around', 'evenly'],
  type: ['vertical', 'horizontal', 'grid'],
  fit: ['contain', 'cover', 'fill'],
  position: ['absolute'],
  hidden: ['true', 'false'],
  wrap: ['true', 'false'],
  disabled: ['true', 'false'],
  checked: ['true', 'false'],
  vertical: ['true', 'false'],
  showValue: ['true', 'false'],
  textAlign: ['left', 'center', 'right'],
  fontWeight: ['normal', 'bold'],
  placement: ['top', 'bottom'],
  bgFit: ['cover', 'contain', 'fill', 'tile', 'none'],
  bgPosition: ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'],
  bgImage: ['frame.svg', 'pattern.svg', 'banner.svg', 'coin.png', 'none'],
  orientation: ['horizontal', 'vertical'],
  transition: ['slide', 'fade', 'none'],
  indicator: ['none', 'dots'],
  sort: ['auto', 'number', 'text', 'none'],
  swipe: ['true', 'false'],
  striped: ['true', 'false'],
  scroll: ['v', 'h', 'both'],
  rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
  shape: ['circle', 'square', 'radial', 'bar'],
  closable: ['true', 'false'],
  draggable: ['true', 'false'],
  rotate: ['true', 'false'],
  autoplay: ['true', 'false'],
  dot: ['true', 'false'],
  showText: ['true', 'false'],
  iconName: ICON_HINTS,
  name: ICON_HINTS,
  width: ['100%', '50%', 'auto', 'fit'],
  height: ['100%', '50%', 'auto', 'fit'],
};
