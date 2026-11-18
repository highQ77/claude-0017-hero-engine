/**
 * 自動產生「UI 元件參考」：資料來自 UI 編輯器的元件庫（PALETTE）、屬性清單（ATTRIBUTE_HINTS）
 * 與屬性說明（ATTR_DOCS）。編輯器新增元件或屬性時，手冊會跟著更新。
 */
import { ATTR_DOCS } from '@engine/editors/ui-editor/codeAssist';
import {
  ATTRIBUTE_HINTS,
  PALETTE,
  VALUE_HINTS,
  paletteNode,
  serialize,
  type PaletteItem,
} from '@engine/editors/ui-editor/model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 個別元件的範例調整：預覽高度、改寫範例、補充說明 */
const TWEAKS: Record<string, { height?: number; xml?: string; note?: string }> = {
  提示訊息: {
    height: 160,
    xml: '<UI padding="16" align="center" justify="center">\n  <UIToast placement="top"/>\n  <UILabel color="#9aa292">UIToast 本身看不到，要用程式顯示訊息（見下方）</UILabel>\n</UI>\n',
    note: '<p>程式裡呼叫 <code>ui.toast()</code> 顯示訊息：</p><script type="text/plain" class="example" data-lang="ts" data-run="false" data-title="顯示提示訊息">ui.toast(\'獲得金幣 +10\', { icon: \'coin\', color: \'#ffd75e\', duration: 1.6 });\n</script>',
  },
  外部介面: {
    height: 120,
    xml: '<UI padding="16" gap="12">\n  <!-- 把 coin-badge.xml 的內容放進來（可以放很多次） -->\n  <UIComponent src="coin-badge.xml"/>\n  <UIComponent src="coin-badge.xml"/>\n</UI>\n',
  },
  視窗: { height: 220 },
  分頁: { height: 200 },
  表格: { height: 240 },
  頁面堆疊: { height: 240 },
  垂直滑桿: { height: 240 },
  垂直列表: { height: 220 },
  格狀列表: { height: 260 },
  捲動區: { height: 220 },
  對話框: { height: 240 },
  虛擬搖桿: {
    height: 200,
    xml: '<UI padding="16" align="center" justify="center">\n  <UIJoystick width="120" height="120" onInput="move" onEnd="stop"/>\n</UI>\n',
    note: '<p>拖曳搖桿時下方會印出 <code>onInput</code> 事件。遊戲裡可以直接讀 <code>joystick.x</code>、<code>joystick.y</code>（-1～1）。</p>',
  },
  小地圖: {
    height: 220,
    note: '<p>搭配 <code>MinimapPlugin</code> 時，有 <code>MinimapMarker</code> 元件的實體會自動顯示在小地圖上（見「2D 介面」章節）。</p>',
  },
  圖片背景: { height: 160 },
  按鈕: {
    xml: '<UI padding="16" dir="h" gap="10" align="start" wrap="true">\n  <UIButton text="按鈕" onClick="hello"/>\n  <UIButton text="停用" disabled="true"/>\n  <UIButton text="自訂顏色" background="#9acd32" hoverBackground="#b4e05a" color="#141a07" onClick="hello"/>\n</UI>\n',
  },
};

function exampleXml(item: PaletteItem): string {
  const tweak = TWEAKS[item.label];
  if (tweak?.xml) return tweak.xml;
  const body = serialize(paletteNode(item.xml))
    .trimEnd()
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
  return `<UI padding="16" align="start">\n${body}\n</UI>\n`;
}

function attrTable(names: string[]): string {
  const rows = names
    .map((n) => {
      const values = VALUE_HINTS[n];
      const vals =
        values && values.length <= 12
          ? `<div class="attr-values">${values.map((v) => `<code>${esc(v)}</code>`).join(' ')}</div>`
          : '';
      return `<tr><td><code>${esc(n)}</code></td><td>${esc(ATTR_DOCS[n] ?? '')}${vals}</td></tr>`;
    })
    .join('');
  return `<table class="attr-table"><thead><tr><th>屬性</th><th>說明</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

export function generateUIReference(): string {
  let html = '';
  // 元件總覽
  const groups = [...new Set(PALETTE.map((p) => p.group))];
  html += '<div class="ref-index">';
  for (const g of groups) {
    html += `<div><strong>${esc(g)}</strong>`;
    html += PALETTE.filter((p) => p.group === g)
      .map(
        (p) =>
          `<a href="#/ui-reference/${encodeURIComponent(`ref-${p.label}`)}">${esc(p.label)} <code>${esc(p.tag)}</code></a>`,
      )
      .join('');
    html += '</div>';
  }
  html += '</div>';

  // 共通屬性
  html += '<h2 id="common-attrs">共通屬性</h2>';
  html +=
    '<p>所有元件都可以使用這些屬性（排版、外觀、事件）。屬性前面加上斷點，例如 <code>md:dir="h"</code>，就只在畫面寬度達到該斷點時套用（見「2D 介面」的 RWD 小節）。</p>';
  html += `<details class="attr-details"><summary>展開共通屬性（${ATTRIBUTE_HINTS.common.length} 個）</summary>${attrTable([...ATTRIBUTE_HINTS.common].sort(byName))}</details>`;

  for (const g of groups) {
    html += `<h2 id="group-${esc(g)}">${esc(g)}</h2>`;
    for (const item of PALETTE.filter((p) => p.group === g)) {
      const tweak = TWEAKS[item.label] ?? {};
      html += `<section class="ref-item"><h3 id="ref-${esc(item.label)}">${esc(item.label)} <code>${esc(item.tag === 'bgImage' ? 'bgImage 屬性' : `<${item.tag}>`)}</code></h3>`;
      html += `<p>${esc(item.desc)}</p>`;
      html += `<script type="text/plain" class="example" data-lang="xml" data-title="${esc(item.label)}"${tweak.height ? ` data-height="${tweak.height}"` : ''}>\n${exampleXml(item)}</script>`;
      if (tweak.note) html += tweak.note;
      const own = ATTRIBUTE_HINTS[item.tag];
      if (own?.length)
        html += `<details class="attr-details"><summary>${esc(item.tag)} 專屬屬性（${own.length} 個）</summary>${attrTable([...own].sort(byName))}</details>`;
      html += '</section>';
    }
  }
  return html;
}
