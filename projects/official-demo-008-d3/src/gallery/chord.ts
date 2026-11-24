/**
 * 弦圖：d3.chord 把矩陣排成圓環，d3.ribbon 畫出兩個類別之間的流向；移到外圈只看那個類別。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { FONT, PALETTE, TEXT, angleOf } from './theme';

const NAMES = ['動作', '角色扮演', '策略', '休閒', '運動'];
/** MATRIX[從][到]：從某類型轉去玩另一類型的玩家（萬人） */
const MATRIX = [
  [0, 42, 18, 25, 30],
  [38, 0, 27, 15, 8],
  [12, 30, 0, 9, 6],
  [22, 10, 7, 0, 14],
  [26, 6, 5, 18, 0],
];
const chords = d3.chord().padAngle(0.05).sortSubgroups(d3.descending)(MATRIX);

export function setupChord(chart: UID3Chart): void {
  const geometry = (width: number, height: number) => {
    const R = Math.min(width, height) / 2 - 36;
    return { cx: width / 2, cy: height / 2, R, r0: R - 16 };
  };
  chart.draw((ctx, { width, height, pointer, d3Context }) => {
    const { cx, cy, R, r0 } = geometry(width, height);
    // 滑鼠下的類別：外圈以內，依角度判斷
    let hover = -1;
    if (pointer) {
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      if (Math.hypot(dx, dy) <= R + 6) {
        const a = angleOf(dx, dy);
        hover = chords.groups.findIndex((g) => a >= g.startAngle && a <= g.endAngle);
      }
    }
    ctx.save();
    ctx.translate(cx, cy);
    const ribbon = d3
      .ribbon<d3.Chord, d3.ChordSubgroup>()
      .radius(r0 - 2)
      .context(d3Context);
    for (const c of chords) {
      const lit = hover < 0 || c.source.index === hover || c.target.index === hover;
      ctx.beginPath();
      ribbon(c);
      ctx.globalAlpha = lit ? (hover < 0 ? 0.6 : 0.85) : 0.06;
      ctx.fillStyle = PALETTE[c.source.index];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const arc = d3.arc<d3.ChordGroup>().innerRadius(r0).outerRadius(R).cornerRadius(2).context(d3Context);
    ctx.font = `bold ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const g of chords.groups) {
      ctx.beginPath();
      arc(g);
      ctx.fillStyle = PALETTE[g.index];
      ctx.globalAlpha = hover < 0 || hover === g.index ? 1 : 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      const mid = (g.startAngle + g.endAngle) / 2;
      ctx.textAlign = mid > Math.PI ? 'right' : 'left';
      ctx.fillStyle = TEXT;
      ctx.fillText(NAMES[g.index], Math.sin(mid) * (R + 10), -Math.cos(mid) * (R + 10));
    }
    ctx.restore();
    if (hover >= 0 && pointer) {
      const out = d3.sum(MATRIX[hover]);
      const into = d3.sum(MATRIX, (row) => row[hover]);
      const top = d3.greatestIndex(MATRIX[hover]) ?? 0;
      drawTooltip(
        ctx,
        pointer.x,
        pointer.y,
        [NAMES[hover], `轉出 ${out} 萬・轉入 ${into} 萬`, `最多轉去：${NAMES[top]}（${MATRIX[hover][top]} 萬）`],
        { bounds: { width, height } },
      );
    }
  });
}
