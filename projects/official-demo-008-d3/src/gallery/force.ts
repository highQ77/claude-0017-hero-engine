/**
 * 力導向圖：d3.forceSimulation 排開節點；可以拖曳節點，移過去亮出相連的節點。
 * 模擬不用 d3 自己的計時器（.stop()），由引擎每一幀呼叫 step()：切到別的分頁就不再計算。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { FONT, PALETTE, TEXT, type Pt } from './theme';

interface N extends d3.SimulationNodeDatum {
  id: number;
  team: number;
  lead: boolean;
}
type L = d3.SimulationLinkDatum<N>;

const TEAMS = ['引擎', '美術', '程式', '音效', '企劃'];
const rand = d3.randomLcg(3);
const nodes: N[] = d3.range(42).map((i) => ({ id: i, team: i % 5, lead: i < 5 }));
const links: L[] = [];
for (let i = 0; i < 5; i++) links.push({ source: i, target: (i + 1) % 5 }); // 組長之間
for (const n of nodes.slice(5)) {
  links.push({ source: n.team, target: n.id }); // 組員連到組長
  if (rand() < 0.35) {
    const other = 5 + Math.floor(rand() * 37);
    if (other !== n.id) links.push({ source: n.id, target: other }); // 跨組合作
  }
}
const radius = (n: N) => (n.lead ? 12 : 6);

const sim = d3
  .forceSimulation(nodes)
  .force(
    'link',
    d3.forceLink<N, L>(links).distance((l) => ((l.source as N).lead && (l.target as N).lead ? 120 : 42)),
  )
  .force('charge', d3.forceManyBody<N>().strength(-120))
  .force(
    'collide',
    d3.forceCollide<N>((n) => radius(n) + 2),
  )
  .force('x', d3.forceX(0).strength(0.05))
  .force('y', d3.forceY(0).strength(0.08))
  .stop();

export function setupForce(chart: UID3Chart): { step(): void; reheat(): void } {
  let dragged: N | null = null;
  /** 繪圖座標 → 模擬座標（圖的中心是 0, 0） */
  const local = (p: Pt) => ({ x: p.x - chart.width / 2, y: p.y - chart.height / 2 });
  const nodeAt = (p: Pt | null) => {
    if (!p) return null;
    const q = local(p);
    return sim.find(q.x, q.y, 20) ?? null;
  };

  chart.draw((ctx, { width, height, pointer }) => {
    const hover = dragged ?? nodeAt(pointer);
    const near = new Set<N>();
    if (hover) {
      near.add(hover);
      for (const l of links) {
        if (l.source === hover) near.add(l.target as N);
        if (l.target === hover) near.add(l.source as N);
      }
    }
    ctx.save();
    ctx.translate(width / 2, height / 2);
    for (const l of links) {
      const s = l.source as N;
      const t = l.target as N;
      const lit = hover !== null && (s === hover || t === hover);
      ctx.strokeStyle = lit
        ? 'rgba(255, 255, 255, 0.8)'
        : hover
          ? 'rgba(154, 205, 50, 0.08)'
          : 'rgba(154, 205, 50, 0.25)';
      ctx.lineWidth = lit ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(s.x!, s.y!);
      ctx.lineTo(t.x!, t.y!);
      ctx.stroke();
    }
    ctx.font = `bold ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of nodes) {
      ctx.globalAlpha = hover && !near.has(n) ? 0.25 : 1;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, radius(n) + (n === hover ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[n.team];
      ctx.fill();
      ctx.strokeStyle = '#0e110c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (n.lead) {
        ctx.fillStyle = TEXT;
        ctx.fillText(TEAMS[n.team], n.x!, n.y! - 22);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (hover && !dragged) {
      drawTooltip(
        ctx,
        hover.x! + width / 2,
        hover.y! + height / 2,
        [`${TEAMS[hover.team]}組・${hover.lead ? '組長' : `成員 #${hover.id}`}`, `和 ${near.size - 1} 人合作`],
        { bounds: { width, height } },
      );
    }
  });

  // 拖曳節點：UID3Chart 沒設 zoom 時，按住拖曳會收到畫布的 pointerdown／pointermove／pointerup
  chart.on('pointerdown', (e) => {
    const n = nodeAt(e.value as Pt);
    if (!n) return;
    dragged = n;
    n.fx = n.x;
    n.fy = n.y;
    sim.alphaTarget(0.3);
    if (sim.alpha() < 0.3) sim.alpha(0.3);
  });
  chart.on('pointermove', (e) => {
    if (!dragged || !e.value) return;
    const q = local(e.value as Pt);
    dragged.fx = q.x;
    dragged.fy = q.y;
  });
  chart.on('pointerup', () => {
    if (!dragged) return;
    dragged.fx = null;
    dragged.fy = null;
    dragged = null;
    sim.alphaTarget(0);
  });

  return {
    /** 每一幀呼叫：模擬還沒停下來就算一步並重畫 */
    step() {
      if (sim.alpha() < sim.alphaMin()) return;
      sim.tick();
      chart.redraw();
    },
    /** 重新加熱：切到這個分頁時讓節點再散開一次 */
    reheat() {
      sim.alpha(0.8);
    },
  };
}
