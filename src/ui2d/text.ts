/**
 * 文字量測與換行：Yoga 需要知道文字在某個寬度下佔多大，
 * 顯示時也用同一份換行結果，確保量測與畫面一致。
 */

export interface FontSpec {
  /** 字級（像素） */
  size: number;
  /** 字體 */
  family: string;
  /** 粗細 */
  weight: string;
  /** 行高倍率 */
  lineHeight: number;
}

/** 文字排版的結果 */
export interface TextMetrics {
  /** 換行後的每一行 */
  lines: string[];
  /** 最寬的一行的寬度（像素） */
  width: number;
  /** 總高度（像素） */
  height: number;
}

/** 量測單段文字寬度的函式（瀏覽器用 canvas，測試可以替換） */
export type MeasureTextWidth = (text: string, font: FontSpec) => number;

/**
 * @param font 字型：大小、字體、粗細、行高
 */
export function fontString(font: FontSpec): string {
  return `${font.weight} ${font.size}px ${font.family}`;
}

/** 中日韓文字：每個字之間都可以換行 */
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

/**
 * 切成可換行的片段：英文以單字（含後面的空白）、中日韓以單字
 * @param text 文字
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (const ch of text) {
    if (CJK.test(ch)) {
      if (word) tokens.push(word);
      word = '';
      tokens.push(ch);
    } else if (ch === ' ') {
      tokens.push(word + ch);
      word = '';
    } else {
      word += ch;
    }
  }
  if (word) tokens.push(word);
  return tokens;
}

/**
 * 依最大寬度換行。支援 \n 強制換行；單一片段超過寬度時逐字切開。
 * @param text 文字
 * @param font 字型
 * @param maxWidth 最大寬度（像素）
 * @param measure 量文字寬度的函式
 */
export function wrapText(text: string, font: FontSpec, maxWidth: number, measure: MeasureTextWidth): TextMetrics {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!Number.isFinite(maxWidth)) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    for (const token of tokenize(paragraph)) {
      const candidate = line + token;
      if (measure(candidate.trimEnd(), font) <= maxWidth || line === '') {
        if (line === '' && measure(token.trimEnd(), font) > maxWidth) {
          // 單一片段太長：逐字切
          for (const ch of token) {
            if (line !== '' && measure((line + ch).trimEnd(), font) > maxWidth) {
              lines.push(line.trimEnd());
              line = '';
            }
            line += ch;
          }
        } else {
          line = candidate;
        }
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  const width = lines.reduce((w, l) => Math.max(w, measure(l, font)), 0);
  return { lines, width: Math.ceil(width), height: Math.ceil(lines.length * font.size * font.lineHeight) };
}

/** 瀏覽器用：canvas 量測，含快取 */
export function createCanvasMeasurer(): MeasureTextWidth {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const cache = new Map<string, number>();
  let currentFont = '';
  return (text, font) => {
    const f = fontString(font);
    const key = `${f}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      if (f !== currentFont) {
        ctx.font = f;
        currentFont = f;
      }
      w = ctx.measureText(text).width;
      if (cache.size > 5000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}

/**
 * 測試用：每個字元固定寬度（中日韓字為兩倍）
 * @param charWidthRatio 一個字元的寬度是字型大小的幾倍（預設 0.5）
 */
export function createFixedMeasurer(charWidthRatio = 0.5): MeasureTextWidth {
  return (text, font) => {
    let w = 0;
    for (const ch of text) w += font.size * charWidthRatio * (CJK.test(ch) ? 2 : 1);
    return w;
  };
}
