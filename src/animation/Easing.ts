/** 緩動函式：輸入 0~1 的進度，輸出套用曲線後的進度 */
export type EasingFn = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

/**
 * @param t 進度 0~1
 */
function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** 常用緩動曲線（In：慢進、Out：慢出、InOut：兩端慢） */
export const Easing = {
  /**
   * 等速
   * @param t 進度 0~1
   */
  linear: (t: number) => t,
  /**
   * 慢慢開始（二次方）
   * @param t 進度 0~1
   */
  quadIn: (t: number) => t * t,
  /**
   * 慢慢停下（二次方）
   * @param t 進度 0~1
   */
  quadOut: (t: number) => 1 - (1 - t) * (1 - t),
  /**
   * 兩端慢、中間快（二次方）
   * @param t 進度 0~1
   */
  quadInOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  /**
   * 慢慢開始（三次方，比 quad 明顯）
   * @param t 進度 0~1
   */
  cubicIn: (t: number) => t ** 3,
  /**
   * 慢慢停下（三次方）
   * @param t 進度 0~1
   */
  cubicOut: (t: number) => 1 - (1 - t) ** 3,
  /**
   * 兩端慢、中間快（三次方）
   * @param t 進度 0~1
   */
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  /**
   * 慢慢開始（正弦，很柔和）
   * @param t 進度 0~1
   */
  sineIn: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  /**
   * 慢慢停下（正弦，很柔和）
   * @param t 進度 0~1
   */
  sineOut: (t: number) => Math.sin((t * Math.PI) / 2),
  /**
   * 兩端慢、中間快（正弦）
   * @param t 進度 0~1
   */
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  /**
   * 一開始很慢，最後急速加快（指數）
   * @param t 進度 0~1
   */
  expoIn: (t: number) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  /**
   * 一開始很快，最後很慢才停下（指數）
   * @param t 進度 0~1
   */
  expoOut: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  /**
   * 先往反方向退一點再前進
   * @param t 進度 0~1
   */
  backIn: (t: number) => c3 * t ** 3 - c1 * t * t,
  /**
   * 超過一點再回來
   * @param t 進度 0~1
   */
  backOut: (t: number) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  /**
   * 開始時往反方向退一點，結束時超過一點再回來
   * @param t 進度 0~1
   */
  backInOut: (t: number) =>
    t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  /**
   * 彈簧般來回震盪後停下
   * @param t 進度 0~1
   */
  elasticOut: (t: number) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  /** 像球落地彈跳 */
  bounceOut,
  /**
   * 像球彈跳（反過來：從小彈跳到大）
   * @param t 進度 0~1
   */
  bounceIn: (t: number) => 1 - bounceOut(1 - t),
} satisfies Record<string, EasingFn>;

/** 緩動曲線名稱：linear、quadOut、backOut、elasticOut、bounceOut… */
export type EasingName = keyof typeof Easing;

/**
 * @param easing 緩動名稱（例如 'quadOut'）或自訂函式；省略時是 linear
 */
export function resolveEasing(easing: EasingName | EasingFn | undefined): EasingFn {
  if (easing === undefined) return Easing.quadOut;
  if (typeof easing === 'function') return easing;
  const fn = Easing[easing];
  if (!fn) throw new Error(`未知的緩動曲線「${easing}」`);
  return fn;
}
