/**
 * 矩形樹圖：d3.hierarchy 加總、d3.treemap 排出方塊；點方塊放大那個類別，再點一下回到全部。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { FONT, PALETTE, TEXT, type Pt } from './theme';

interface Node {
  name: string;
  value?: number;
  children?: Node[];
}
const DATA: Node = {
  name: '全部',
  children: [
    {
      name: '動作',
      children: [
        { name: '射擊', value: 46 },
        { name: '格鬥', value: 28 },
        { name: '平台跳躍', value: 17 },
        { name: '潛行', value: 9 },
      ],
    },
    {
      name: '角色扮演',
      children: [
        { name: '動作 RPG', value: 38 },
        { name: '日式', value: 31 },
        { name: '美式', value: 22 },
        { name: 'Roguelike', value: 14 },
      ],
    },
    {
      name: '策略',
      children: [
        { name: '模擬經營', value: 19 },
        { name: '回合制', value: 15 },
        { name: '即時戰略', value: 12 },
        { name: '塔防', value: 11 },
      ],
    },
    {
      name: '休閒',
      children: [
        { name: '消除', value: 26 },
        { name: '放置', value: 18 },
        { name: '解謎', value: 13 },
      ],
    },
    {
      name: '運動',
      children: [
        { name: '賽車', value: 21 },
        { name: '足球', value: 16 },
        { name: '籃球', value: 9 },
      ],
    },
  ],
};
const GENRES = DATA.children!.map((c) => c.name);

export function setupTreemap(chart: UID3Chart): void {
  /** 放大的類別（null：全部） */
  let focus: string | null = null;
  const layout = (width: number, height: number) => {
    const src = focus ? DATA.children!.find((c) => c.name === focus)! : DATA;
    const root = d3
      .hierarchy(src)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return d3.treemap<Node>().size([width, height]).paddingOuter(3).paddingTop(22).paddingInner(2).round(true)(root);
  };
  /** 方塊屬於哪個類別 */
  const genreOf = (n: d3.HierarchyNode<Node>) => focus ?? n.ancestors().at(-2)?.data.name ?? '';
  const leafAt = (root: d3.HierarchyRectangularNode<Node>, p: Pt | null) =>
    p ? (root.leaves().find((l) => p.x >= l.x0 && p.x <= l.x1 && p.y >= l.y0 && p.y <= l.y1) ?? null) : null;

  chart.draw((ctx, { width, height, pointer }) => {
    const root = layout(width, height);
    const hover = leafAt(root, pointer);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // 最上面的標題列
    ctx.fillStyle = TEXT;
    ctx.font = `bold ${FONT}`;
    ctx.fillText(focus ? `${focus}　（點一下回到全部）` : '全部類型　（點方塊放大那個類別）', 6, 6);
    for (const n of root.descendants()) {
      if (n === root) continue;
      const w = n.x1 - n.x0;
      const h = n.y1 - n.y0;
      if (n.children) {
        // 類別：外框與名稱
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(n.x0, n.y0, w, h, 4);
        ctx.fill();
        ctx.fillStyle = PALETTE[GENRES.indexOf(n.data.name)];
        ctx.font = `bold ${FONT}`;
        ctx.fillText(`${n.data.name}　${n.value}`, n.x0 + 6, n.y0 + 6);
        continue;
      }
      // 方塊：同一類別的顏色，越後面越暗
      const base = PALETTE[GENRES.indexOf(genreOf(n))];
      const rank = n.parent ? n.parent.children!.indexOf(n) : 0;
      ctx.fillStyle = d3.interpolateRgb(base, '#0e110c')(0.1 + rank * 0.14);
      ctx.beginPath();
      ctx.roundRect(n.x0, n.y0, w, h, 3);
      ctx.fill();
      if (n === hover) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.font = FONT;
      ctx.fillStyle = '#0e110c';
      if (w > ctx.measureText(n.data.name).width + 10 && h > 20) ctx.fillText(n.data.name, n.x0 + 5, n.y0 + 5);
      if (w > 30 && h > 36) ctx.fillText(String(n.value), n.x0 + 5, n.y0 + 19);
    }
    if (hover && pointer) {
      const genre = genreOf(hover);
      const total = root.descendants().find((d) => d.data.name === genre)?.value ?? root.value ?? 1;
      drawTooltip(
        ctx,
        pointer.x,
        pointer.y,
        [
          `${genre}・${hover.data.name}`,
          `${hover.value} 萬（占${genre} ${(((hover.value ?? 0) / total) * 100).toFixed(0)}%）`,
        ],
        { bounds: { width, height } },
      );
    }
  });
  chart.on('chartclick', (e) => {
    if (focus) focus = null;
    else {
      const leaf = leafAt(layout(chart.width, chart.height), e.value as Pt);
      if (leaf) focus = genreOf(leaf);
    }
    chart.redraw();
  });
}
