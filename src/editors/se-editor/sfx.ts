/**
 * 音效檔（public/sounds/<名稱>.sfx.json）：合成音效的參數，音效編輯器打開、修改、存檔；
 * 存檔時同時烘焙成 <名稱>.wav，遊戲播放的是 .wav（遊戲不需要 Tone.js）。
 *
 *   { "format": "hero-sfx", "version": 1,
 *     "layers": [ { "source": "osc", "wave": "square", "freq": 880, "freqEnd": 1760, … } ],
 *     "distortion": 0, "bits": 16, "echoWet": 0, "reverbWet": 0, "volume": -6, "normalize": true, … }
 *
 * 一個音效由 1～4 層疊起來：每層是一個聲音來源（振盪器／雜訊／FM），經過濾波器與音量包絡；
 * 最後整體經過後製（順序見 synth.ts）：音高 → 等化 → 音色（失真、切比雪夫、位元）→ 調變（音量顫抖、顫音、
 * 自動濾波、自動哇音、移相、梳狀濾波）→ 噪音閘門 → 回音 → 殘響 → 壓縮 → 限制 → 音量，最後降低取樣率。
 * 每個後製都有「關」的值（MASTER_PARAMS 的 off）：舊的音效檔沒有這些欄位時用預設值，也就是關著，聲音不變。
 * 這個檔案不使用 Tone.js（開發伺服器檢查檔案、測試也用它）；合成在 synth.ts。
 */

/** 聲音來源 */
export type SourceKind = 'osc' | 'noise' | 'fm';
export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';
export type NoiseKind = 'white' | 'pink' | 'brown';
export type FilterKind = 'none' | 'lowpass' | 'highpass' | 'bandpass';
/** 殘響的算法：卷積（預設，最自然）、Freeverb（明亮）、JCReverb（復古、金屬感） */
export type ReverbKind = 'convolution' | 'freeverb' | 'jc';
/** 壓縮：關、一般、多頻段（低、中、高頻分開壓縮） */
export type CompressorKind = 'off' | 'single' | 'multiband';

/** 一層聲音 */
export interface SfxLayer {
  /** 關掉時不發聲（保留參數） */
  enabled: boolean;
  source: SourceKind;
  /** 振盪器、FM 的波形 */
  wave: Wave;
  /** 雜訊的顏色 */
  noise: NoiseKind;
  /** 起始音高（Hz） */
  freq: number;
  /** 結束音高（Hz）：和起始不同時會滑音 */
  freqEnd: number;
  /** 顫音速度（Hz） */
  vibratoRate: number;
  /** 顫音深度（音分，100 = 半音） */
  vibratoDepth: number;
  /** FM：調變器和載波的頻率比 */
  fmHarmonicity: number;
  /** FM：調變強度 */
  fmIndex: number;
  filter: FilterKind;
  /** 濾波器起始頻率（Hz） */
  cutoff: number;
  /** 濾波器結束頻率（Hz）：和起始不同時會掃頻 */
  cutoffEnd: number;
  /** 濾波器共振 */
  q: number;
  /** 延遲開始（秒） */
  delay: number;
  /** 起音（秒） */
  attack: number;
  /** 衰減（秒） */
  decay: number;
  /** 延音音量（0..1） */
  sustain: number;
  /** 延音維持（秒） */
  hold: number;
  /** 釋音（秒） */
  release: number;
  /** 這一層的音量（dB） */
  volume: number;
}

/** 音效檔 */
export interface SfxData {
  format: 'hero-sfx';
  version: 1;
  layers: SfxLayer[];
  /** 移調（半音，0 = 關）：整體升降音高，長度不變 */
  pitchShift: number;
  /** 頻率位移（Hz，0 = 關）：所有頻率平移，不和諧的機械、外星感 */
  freqShift: number;
  /** 等化：低頻（dB，0 = 不變） */
  eqLow: number;
  /** 等化：中頻（dB） */
  eqMid: number;
  /** 等化：高頻（dB） */
  eqHigh: number;
  /** 失真（0..1） */
  distortion: number;
  /** 切比雪夫波形塑形的份量（0 = 關）：加上特定諧波 */
  chebyWet: number;
  /** 切比雪夫的階數（越大諧波越高、越刺耳） */
  chebyOrder: number;
  /** 位元數（16 = 不壓縮；越小越粗糙、越復古） */
  bits: number;
  /** 降低取樣率（1 = 關；N = 每 N 個樣本只留一個，高頻變得粗糙） */
  downsample: number;
  /** 音量顫抖的深度（0 = 關） */
  tremoloDepth: number;
  /** 音量顫抖的速度（Hz） */
  tremoloRate: number;
  /** 整體顫音的深度（0 = 關）：連雜訊也會晃 */
  vibratoDepth: number;
  /** 整體顫音的速度（Hz） */
  vibratoRate: number;
  /** 自動濾波的深度（0 = 關）：濾波器週期掃動 */
  autoFilterDepth: number;
  /** 自動濾波的速度（Hz） */
  autoFilterRate: number;
  /** 自動濾波的最低頻率（Hz） */
  autoFilterBase: number;
  /** 自動哇音的份量（0 = 關）：依音量大小掃動濾波器 */
  autoWahWet: number;
  /** 自動哇音的最低頻率（Hz） */
  autoWahBase: number;
  /** 移相的份量（0 = 關） */
  phaserWet: number;
  /** 移相的速度（Hz） */
  phaserRate: number;
  /** 移相掃過的範圍（八度） */
  phaserOctaves: number;
  /** 梳狀濾波的份量（0 = 關）：金屬感、管狀的共鳴 */
  combWet: number;
  /** 梳狀濾波的共鳴音高（Hz） */
  combFreq: number;
  /** 梳狀濾波的回饋（越大共鳴越久） */
  combFeedback: number;
  /** 噪音閘門的門檻（dB，-100 = 關）：小於門檻的聲音直接關掉 */
  gateThreshold: number;
  /** 回音間隔（秒） */
  echoTime: number;
  /** 回音回饋（0..0.9） */
  echoFeedback: number;
  /** 回音份量（0 = 關） */
  echoWet: number;
  /** 殘響長度（秒） */
  reverbDecay: number;
  /** 殘響份量（0 = 關） */
  reverbWet: number;
  /** 殘響的算法 */
  reverbType: ReverbKind;
  /** 壓縮：關、一般、多頻段 */
  compressor: CompressorKind;
  /** 壓縮門檻（dB）：超過的部分被壓下來 */
  compThreshold: number;
  /** 壓縮比（越大壓得越多） */
  compRatio: number;
  /** 限制器的上限（dB，0 = 關）：超過的部分直接壓住，防止爆音 */
  limiterThreshold: number;
  /** 整體音量（dB） */
  volume: number;
  /** 把最大音量調到接近滿格（不同音效的音量比較一致） */
  normalize: boolean;
}

export const SFX_FORMAT = 'hero-sfx';
/** 最多幾層 */
export const MAX_LAYERS = 4;
/** 最長幾秒（含回音、殘響的尾巴） */
export const MAX_DURATION = 6;

/** 數字參數的說明：範圍、間隔、單位、是否用對數刻度（頻率） */
export interface NumberParam<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  log?: boolean;
  /** 說明（滑鼠移上去顯示） */
  hint?: string;
  /** 這個值代表「關」（後製處理器）：隨機微調時，關著的保持關著 */
  off?: number;
}

type LayerNumberKey = {
  [K in keyof SfxLayer]: SfxLayer[K] extends number ? K : never;
}[keyof SfxLayer];
/** 整體的數字參數的鍵 */
export type SfxNumberKey = Exclude<
  { [K in keyof SfxData]: SfxData[K] extends number ? K : never }[keyof SfxData],
  'version'
>;

/** 每一層的數字參數（編輯器的欄位、微調變化、檢查都用這份） */
export const LAYER_PARAMS: readonly NumberParam<LayerNumberKey>[] = [
  { key: 'freq', label: '起始音高', min: 20, max: 8000, step: 1, unit: 'Hz', log: true },
  { key: 'freqEnd', label: '結束音高', min: 20, max: 8000, step: 1, unit: 'Hz', log: true, hint: '和起始不同時會滑音' },
  { key: 'vibratoRate', label: '顫音速度', min: 0, max: 40, step: 0.1, unit: 'Hz' },
  { key: 'vibratoDepth', label: '顫音深度', min: 0, max: 1200, step: 1, unit: '音分', hint: '100 音分 = 半音' },
  { key: 'fmHarmonicity', label: 'FM 頻率比', min: 0.1, max: 16, step: 0.01 },
  { key: 'fmIndex', label: 'FM 強度', min: 0, max: 60, step: 0.1 },
  { key: 'cutoff', label: '濾波起始', min: 20, max: 20000, step: 1, unit: 'Hz', log: true },
  {
    key: 'cutoffEnd',
    label: '濾波結束',
    min: 20,
    max: 20000,
    step: 1,
    unit: 'Hz',
    log: true,
    hint: '和起始不同時會掃頻',
  },
  { key: 'q', label: '共振', min: 0.1, max: 20, step: 0.1 },
  { key: 'delay', label: '延遲開始', min: 0, max: 2, step: 0.005, unit: '秒' },
  { key: 'attack', label: '起音', min: 0.001, max: 2, step: 0.001, unit: '秒' },
  { key: 'decay', label: '衰減', min: 0.001, max: 2, step: 0.001, unit: '秒' },
  { key: 'sustain', label: '延音音量', min: 0, max: 1, step: 0.01 },
  { key: 'hold', label: '延音維持', min: 0, max: 3, step: 0.005, unit: '秒' },
  { key: 'release', label: '釋音', min: 0.001, max: 3, step: 0.001, unit: '秒' },
  { key: 'volume', label: '音量', min: -40, max: 6, step: 0.5, unit: 'dB' },
];

/** 整體的數字參數 */
export const MASTER_PARAMS: readonly NumberParam<SfxNumberKey>[] = [
  // 音高
  {
    key: 'pitchShift',
    label: '移調',
    min: -24,
    max: 24,
    step: 1,
    unit: '半音',
    off: 0,
    hint: '整體升降音高、長度不變（大怪物、小怪物）；0 = 關',
  },
  {
    key: 'freqShift',
    label: '頻率位移',
    min: -1000,
    max: 1000,
    step: 1,
    unit: 'Hz',
    off: 0,
    hint: '所有頻率平移，不和諧的機械、外星感；0 = 關',
  },
  // 等化
  { key: 'eqLow', label: '低頻', min: -24, max: 12, step: 0.5, unit: 'dB', off: 0, hint: '400 Hz 以下；0 = 不變' },
  { key: 'eqMid', label: '中頻', min: -24, max: 12, step: 0.5, unit: 'dB', off: 0, hint: '400～2500 Hz；0 = 不變' },
  { key: 'eqHigh', label: '高頻', min: -24, max: 12, step: 0.5, unit: 'dB', off: 0, hint: '2500 Hz 以上；0 = 不變' },
  // 音色
  { key: 'distortion', label: '失真', min: 0, max: 1, step: 0.01, off: 0 },
  { key: 'chebyWet', label: '諧波份量', min: 0, max: 1, step: 0.01, off: 0, hint: '切比雪夫波形塑形；0 = 關' },
  { key: 'chebyOrder', label: '諧波階數', min: 2, max: 40, step: 1, hint: '越大諧波越高、越刺耳' },
  { key: 'bits', label: '位元數', min: 1, max: 16, step: 1, off: 16, hint: '16 = 不壓縮；越小越粗糙、越復古' },
  {
    key: 'downsample',
    label: '降低取樣率',
    min: 1,
    max: 32,
    step: 1,
    unit: '倍',
    off: 1,
    hint: '每 N 個樣本只留一個，高頻變得粗糙；1 = 關（套用在最後）',
  },
  // 調變
  { key: 'tremoloDepth', label: '顫抖深度', min: 0, max: 1, step: 0.01, off: 0, hint: '音量週期起伏；0 = 關' },
  { key: 'tremoloRate', label: '顫抖速度', min: 0.1, max: 40, step: 0.1, unit: 'Hz' },
  {
    key: 'vibratoDepth',
    label: '顫音深度',
    min: 0,
    max: 1,
    step: 0.01,
    off: 0,
    hint: '整體音高起伏（連雜訊也會晃）；0 = 關',
  },
  { key: 'vibratoRate', label: '顫音速度', min: 0.1, max: 40, step: 0.1, unit: 'Hz' },
  { key: 'autoFilterDepth', label: '濾波深度', min: 0, max: 1, step: 0.01, off: 0, hint: '濾波器週期掃動；0 = 關' },
  { key: 'autoFilterRate', label: '濾波速度', min: 0.1, max: 20, step: 0.1, unit: 'Hz' },
  { key: 'autoFilterBase', label: '最低頻率', min: 50, max: 5000, step: 1, unit: 'Hz', log: true },
  { key: 'autoWahWet', label: '哇音份量', min: 0, max: 1, step: 0.01, off: 0, hint: '依音量大小掃動濾波器；0 = 關' },
  { key: 'autoWahBase', label: '最低頻率', min: 50, max: 2000, step: 1, unit: 'Hz', log: true },
  { key: 'phaserWet', label: '移相份量', min: 0, max: 1, step: 0.01, off: 0, hint: '旋轉、太空感的掃動；0 = 關' },
  { key: 'phaserRate', label: '移相速度', min: 0.05, max: 20, step: 0.05, unit: 'Hz' },
  { key: 'phaserOctaves', label: '移相範圍', min: 0.5, max: 6, step: 0.1, unit: '八度' },
  { key: 'combWet', label: '梳狀份量', min: 0, max: 1, step: 0.01, off: 0, hint: '金屬感、管狀的共鳴；0 = 關' },
  { key: 'combFreq', label: '梳狀音高', min: 40, max: 4000, step: 1, unit: 'Hz', log: true },
  { key: 'combFeedback', label: '梳狀回饋', min: 0, max: 0.95, step: 0.01, hint: '越大共鳴越久' },
  // 空間
  {
    key: 'gateThreshold',
    label: '閘門門檻',
    min: -100,
    max: 0,
    step: 1,
    unit: 'dB',
    off: -100,
    hint: '小於門檻的聲音直接關掉，尾巴收得乾淨；-100 = 關',
  },
  { key: 'echoTime', label: '回音間隔', min: 0.01, max: 1, step: 0.005, unit: '秒' },
  { key: 'echoFeedback', label: '回音回饋', min: 0, max: 0.9, step: 0.01 },
  { key: 'echoWet', label: '回音份量', min: 0, max: 1, step: 0.01, off: 0, hint: '0 = 關' },
  { key: 'reverbDecay', label: '殘響長度', min: 0.1, max: 5, step: 0.05, unit: '秒' },
  { key: 'reverbWet', label: '殘響份量', min: 0, max: 1, step: 0.01, off: 0, hint: '0 = 關' },
  // 動態
  { key: 'compThreshold', label: '壓縮門檻', min: -60, max: 0, step: 0.5, unit: 'dB', hint: '超過的部分被壓下來' },
  { key: 'compRatio', label: '壓縮比', min: 1, max: 20, step: 0.1, hint: '越大壓得越多；4 左右是常見的值' },
  {
    key: 'limiterThreshold',
    label: '限制上限',
    min: -24,
    max: 0,
    step: 0.5,
    unit: 'dB',
    off: 0,
    hint: '超過的部分直接壓住，防止爆音；0 = 關',
  },
  { key: 'volume', label: '整體音量', min: -40, max: 6, step: 0.5, unit: 'dB' },
];

export const SOURCES: readonly [SourceKind, string][] = [
  ['osc', '振盪器'],
  ['noise', '雜訊'],
  ['fm', 'FM 合成'],
];
export const WAVES: readonly [Wave, string][] = [
  ['square', '方波'],
  ['sawtooth', '鋸齒波'],
  ['triangle', '三角波'],
  ['sine', '正弦波'],
];
export const NOISES: readonly [NoiseKind, string][] = [
  ['white', '白雜訊'],
  ['pink', '粉紅雜訊'],
  ['brown', '棕雜訊'],
];
export const REVERBS: readonly [ReverbKind, string][] = [
  ['convolution', '自然（卷積）'],
  ['freeverb', '明亮（Freeverb）'],
  ['jc', '復古金屬（JCReverb）'],
];
export const COMPRESSORS: readonly [CompressorKind, string][] = [
  ['off', '關'],
  ['single', '一般'],
  ['multiband', '多頻段'],
];
export const FILTERS: readonly [FilterKind, string][] = [
  ['none', '不過濾'],
  ['lowpass', '低通'],
  ['highpass', '高通'],
  ['bandpass', '帶通'],
];

/** 預設的一層：短短的方波嗶聲 */
export function defaultLayer(): SfxLayer {
  return {
    enabled: true,
    source: 'osc',
    wave: 'square',
    noise: 'white',
    freq: 440,
    freqEnd: 440,
    vibratoRate: 0,
    vibratoDepth: 0,
    fmHarmonicity: 2,
    fmIndex: 8,
    filter: 'none',
    cutoff: 4000,
    cutoffEnd: 4000,
    q: 1,
    delay: 0,
    attack: 0.005,
    decay: 0.08,
    sustain: 0.4,
    hold: 0.05,
    release: 0.12,
    volume: -6,
  };
}

/** 預設的音效 */
export function defaultSfx(): SfxData {
  return {
    format: SFX_FORMAT,
    version: 1,
    layers: [defaultLayer()],
    pitchShift: 0,
    freqShift: 0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    distortion: 0,
    chebyWet: 0,
    chebyOrder: 3,
    bits: 16,
    downsample: 1,
    tremoloDepth: 0,
    tremoloRate: 8,
    vibratoDepth: 0,
    vibratoRate: 6,
    autoFilterDepth: 0,
    autoFilterRate: 2,
    autoFilterBase: 300,
    autoWahWet: 0,
    autoWahBase: 150,
    phaserWet: 0,
    phaserRate: 0.5,
    phaserOctaves: 3,
    combWet: 0,
    combFreq: 220,
    combFeedback: 0.7,
    gateThreshold: -100,
    echoTime: 0.12,
    echoFeedback: 0.3,
    echoWet: 0,
    reverbDecay: 1.2,
    reverbWet: 0,
    reverbType: 'convolution',
    compressor: 'off',
    compThreshold: -18,
    compRatio: 4,
    limiterThreshold: 0,
    volume: -3,
    normalize: true,
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = <T extends string>(v: unknown, options: readonly (readonly [T, string])[], fallback: T): T =>
  options.some(([o]) => o === v) ? (v as T) : fallback;

/** 整理一層：補上預設值、限制範圍 */
function normalizeLayer(raw: unknown): SfxLayer {
  const d = defaultLayer();
  if (!isObject(raw)) return d;
  const out: SfxLayer = {
    ...d,
    enabled: raw.enabled !== false,
    source: pick(raw.source, SOURCES, d.source),
    wave: pick(raw.wave, WAVES, d.wave),
    noise: pick(raw.noise, NOISES, d.noise),
    filter: pick(raw.filter, FILTERS, d.filter),
  };
  for (const p of LAYER_PARAMS) {
    const v = Number(raw[p.key]);
    if (Number.isFinite(v)) out[p.key] = clamp(v, p.min, p.max);
  }
  return out;
}

/**
 * 讀取音效檔（JSON 文字或已經解析的物件）：補上預設值、限制範圍、去掉多的圖層。
 * 格式不對（不是物件、沒有 layers）時丟出錯誤。
 */
export function parseSfx(input: string | unknown): SfxData {
  const data = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isObject(data)) throw new Error('音效檔要是 JSON 物件');
  if (data.format !== undefined && data.format !== SFX_FORMAT)
    throw new Error(`不是音效檔（format 是 ${data.format}）`);
  if (!Array.isArray(data.layers) || data.layers.length === 0) throw new Error('音效檔需要至少一層（layers）');
  const out = defaultSfx();
  out.layers = data.layers.slice(0, MAX_LAYERS).map(normalizeLayer);
  for (const p of MASTER_PARAMS) {
    const v = Number(data[p.key]);
    if (Number.isFinite(v)) out[p.key] = clamp(v, p.min, p.max);
  }
  out.reverbType = pick(data.reverbType, REVERBS, out.reverbType);
  out.compressor = pick(data.compressor, COMPRESSORS, out.compressor);
  out.normalize = data.normalize !== false;
  return out;
}

/** 音效檔轉成文字 */
export const stringifySfx = (sfx: SfxData) => `${JSON.stringify(sfx, null, 2)}\n`;

/** 一層聲音的長度（延遲 + 起音 + 衰減 + 延音維持 + 釋音） */
export const layerLength = (l: SfxLayer) => l.delay + l.attack + l.decay + l.hold + l.release;

/** 整個音效的長度（秒）：最長的一層，加上回音、殘響的尾巴；最多 MAX_DURATION */
export function sfxDuration(sfx: SfxData): number {
  const layers = sfx.layers.filter((l) => l.enabled);
  let len = layers.length ? Math.max(...layers.map(layerLength)) : 0.1;
  if (sfx.echoWet > 0)
    len += sfx.echoTime * Math.min(12, 1 + Math.log(0.01) / Math.log(Math.max(0.05, sfx.echoFeedback)));
  if (sfx.combWet > 0)
    len += Math.min(2, (1 / sfx.combFreq) * (Math.log(0.001) / Math.log(Math.max(0.05, sfx.combFeedback))));
  if (sfx.reverbWet > 0) len += sfx.reverbDecay;
  return clamp(len, 0.02, MAX_DURATION);
}

/** 降低取樣率：每 factor 個樣本只留第一個（取樣保持），高頻變得粗糙 */
export function downsample(samples: Float32Array, factor: number): void {
  const n = Math.max(1, Math.round(factor));
  if (n <= 1) return;
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i - (i % n)];
}

// ───────── 隨機 ─────────

/** 亂數產生器（給種子時每次一樣，測試用） */
export type Rng = () => number;

/** 有種子的亂數（mulberry32） */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rng: Rng, min: number, max: number) => min + (max - min) * rng();
/** 對數範圍（頻率） */
const logRange = (rng: Rng, min: number, max: number) => Math.exp(range(rng, Math.log(min), Math.log(max)));
const choose = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/** 一層（從預設值開始，覆蓋部分欄位） */
const layer = (patch: Partial<SfxLayer>): SfxLayer => ({ ...defaultLayer(), ...patch });
const sfx = (layers: SfxLayer[], patch: Partial<SfxData> = {}): SfxData => ({ ...defaultSfx(), layers, ...patch });

/** 範本：每次產生時帶一點隨機（同一種音效的不同版本） */
export const PRESETS: readonly { id: string; label: string; make(rng: Rng): SfxData }[] = [
  {
    id: 'coin',
    label: '金幣',
    make: (r) => {
      const f = logRange(r, 700, 1400);
      return sfx([
        layer({
          wave: choose(r, ['square', 'triangle'] as const),
          freq: f,
          freqEnd: f,
          attack: 0.002,
          decay: 0.05,
          sustain: 0.5,
          hold: 0.04,
          release: 0.08,
        }),
        layer({
          wave: 'square',
          freq: f * 1.5,
          freqEnd: f * 1.5,
          delay: range(r, 0.06, 0.09),
          attack: 0.002,
          decay: 0.08,
          sustain: 0.4,
          hold: 0.08,
          release: 0.2,
        }),
      ]);
    },
  },
  {
    id: 'jump',
    label: '跳躍',
    make: (r) => {
      const f = logRange(r, 180, 360);
      return sfx([
        layer({
          wave: 'square',
          freq: f,
          freqEnd: f * range(r, 2.2, 3.5),
          attack: 0.005,
          decay: 0.12,
          sustain: 0.3,
          hold: 0.04,
          release: 0.1,
          filter: 'lowpass',
          cutoff: 3000,
          cutoffEnd: 3000,
        }),
      ]);
    },
  },
  {
    id: 'laser',
    label: '雷射',
    make: (r) => {
      const f = logRange(r, 900, 2200);
      return sfx(
        [
          layer({
            wave: choose(r, ['sawtooth', 'square'] as const),
            freq: f,
            freqEnd: f * range(r, 0.12, 0.3),
            attack: 0.002,
            decay: 0.12,
            sustain: 0.2,
            hold: 0.02,
            release: 0.08,
          }),
        ],
        { echoWet: r() < 0.5 ? 0.25 : 0, echoTime: 0.07 },
      );
    },
  },
  {
    id: 'explosion',
    label: '爆炸',
    make: (r) =>
      sfx(
        [
          layer({
            source: 'noise',
            noise: 'brown',
            filter: 'lowpass',
            cutoff: logRange(r, 1500, 4000),
            cutoffEnd: 120,
            attack: 0.005,
            decay: 0.3,
            sustain: 0.5,
            hold: 0.15,
            release: range(r, 0.5, 0.9),
            volume: 0,
          }),
          layer({
            wave: 'sine',
            freq: logRange(r, 80, 140),
            freqEnd: 35,
            attack: 0.002,
            decay: 0.25,
            sustain: 0.2,
            hold: 0.05,
            release: 0.3,
            volume: -4,
          }),
        ],
        { distortion: range(r, 0.2, 0.5), reverbWet: 0.25, reverbDecay: 1.5 },
      ),
  },
  {
    id: 'powerup',
    label: '升級',
    make: (r) => {
      const f = logRange(r, 250, 450);
      return sfx(
        [
          layer({
            wave: choose(r, ['square', 'triangle'] as const),
            freq: f,
            freqEnd: f * 4,
            vibratoRate: range(r, 10, 18),
            vibratoDepth: 60,
            attack: 0.01,
            decay: 0.1,
            sustain: 0.6,
            hold: range(r, 0.3, 0.5),
            release: 0.2,
          }),
        ],
        { echoWet: 0.2, echoTime: 0.09 },
      );
    },
  },
  {
    id: 'hurt',
    label: '受傷',
    make: (r) =>
      sfx(
        [
          layer({
            wave: 'sawtooth',
            freq: logRange(r, 300, 600),
            freqEnd: 90,
            attack: 0.002,
            decay: 0.12,
            sustain: 0.3,
            hold: 0.03,
            release: 0.1,
          }),
          layer({
            source: 'noise',
            noise: 'white',
            filter: 'bandpass',
            cutoff: 1800,
            cutoffEnd: 600,
            q: 2,
            attack: 0.001,
            decay: 0.08,
            sustain: 0.1,
            hold: 0,
            release: 0.05,
            volume: -10,
          }),
        ],
        { distortion: 0.3 },
      ),
  },
  {
    id: 'click',
    label: '點擊',
    make: (r) => {
      const f = logRange(r, 1200, 2600);
      return sfx(
        [
          layer({
            wave: 'sine',
            freq: f,
            freqEnd: f * 0.7,
            attack: 0.001,
            decay: 0.03,
            sustain: 0,
            hold: 0,
            release: 0.02,
            volume: -4,
          }),
        ],
        { normalize: false, volume: -8 },
      );
    },
  },
  {
    id: 'blip',
    label: '選單移動',
    make: (r) => {
      const f = logRange(r, 500, 900);
      return sfx(
        [
          layer({
            wave: 'square',
            freq: f,
            freqEnd: f,
            attack: 0.002,
            decay: 0.04,
            sustain: 0.3,
            hold: 0.02,
            release: 0.04,
            filter: 'lowpass',
            cutoff: 2500,
            cutoffEnd: 2500,
          }),
        ],
        { volume: -8 },
      );
    },
  },
  {
    id: 'pickup',
    label: '拾取',
    make: (r) => {
      const f = logRange(r, 400, 700);
      return sfx([
        layer({
          wave: 'triangle',
          freq: f,
          freqEnd: f * 1.25,
          attack: 0.002,
          decay: 0.05,
          sustain: 0.4,
          hold: 0.03,
          release: 0.06,
        }),
        layer({
          wave: 'triangle',
          freq: f * 1.5,
          freqEnd: f * 2,
          delay: 0.07,
          attack: 0.002,
          decay: 0.06,
          sustain: 0.4,
          hold: 0.05,
          release: 0.12,
        }),
      ]);
    },
  },
  {
    id: 'teleport',
    label: '傳送',
    make: (r) =>
      sfx(
        [
          layer({
            source: 'fm',
            wave: 'sine',
            freq: logRange(r, 200, 400),
            freqEnd: logRange(r, 1500, 3000),
            fmHarmonicity: range(r, 1.5, 3.5),
            fmIndex: range(r, 6, 20),
            attack: 0.05,
            decay: 0.2,
            sustain: 0.6,
            hold: 0.3,
            release: 0.4,
          }),
        ],
        { reverbWet: 0.35, reverbDecay: 2, echoWet: 0.2, echoTime: 0.15 },
      ),
  },
  {
    id: 'shoot',
    label: '射擊',
    make: (r) =>
      sfx(
        [
          // 槍口的爆裂：雜訊從亮掃到悶
          layer({
            source: 'noise',
            noise: 'white',
            filter: 'lowpass',
            cutoff: logRange(r, 4000, 7000),
            cutoffEnd: 600,
            attack: 0.001,
            decay: 0.06,
            sustain: 0.2,
            hold: 0.02,
            release: 0.12,
            volume: -2,
          }),
          // 低頻的推力
          layer({
            wave: 'square',
            freq: logRange(r, 160, 260),
            freqEnd: 60,
            filter: 'lowpass',
            cutoff: 1200,
            cutoffEnd: 400,
            attack: 0.002,
            decay: 0.08,
            sustain: 0.2,
            hold: 0.02,
            release: 0.08,
            volume: -6,
          }),
        ],
        { distortion: range(r, 0.1, 0.25), reverbWet: 0.12, reverbDecay: 0.8 },
      ),
  },
  {
    id: 'punch',
    label: '打擊',
    make: (r) =>
      sfx([
        layer({
          wave: 'sine',
          freq: logRange(r, 110, 160),
          freqEnd: 45,
          attack: 0.002,
          decay: 0.12,
          sustain: 0.1,
          hold: 0.02,
          release: 0.08,
        }),
        layer({
          source: 'noise',
          noise: 'brown',
          filter: 'lowpass',
          cutoff: logRange(r, 1500, 2500),
          cutoffEnd: 300,
          attack: 0.001,
          decay: 0.05,
          sustain: 0.1,
          hold: 0,
          release: 0.05,
          volume: -6,
        }),
      ]),
  },
  {
    id: 'footstep',
    label: '腳步',
    make: (r) =>
      sfx(
        [
          layer({
            source: 'noise',
            noise: 'brown',
            filter: 'bandpass',
            cutoff: logRange(r, 350, 700),
            cutoffEnd: logRange(r, 200, 350),
            q: 1.5,
            attack: 0.004,
            decay: 0.05,
            sustain: 0.15,
            hold: 0.01,
            release: 0.05,
          }),
        ],
        // 帶通濾掉了大部分的能量：用自動音量拉回來（遊戲裡播放時再調小聲）
        { normalize: true },
      ),
  },
  {
    id: 'whoosh',
    label: '揮動',
    make: (r) =>
      sfx([
        layer({
          source: 'noise',
          noise: 'pink',
          filter: 'bandpass',
          cutoff: logRange(r, 300, 600),
          cutoffEnd: logRange(r, 1800, 3200),
          q: 2,
          attack: range(r, 0.06, 0.12),
          decay: 0.08,
          sustain: 0.5,
          hold: 0.04,
          release: range(r, 0.12, 0.2),
        }),
      ]),
  },
  {
    id: 'bell',
    label: '鈴聲',
    make: (r) => {
      const f = logRange(r, 600, 1000);
      return sfx(
        [
          // FM 的金屬泛音，強度不高：清脆但不刺耳
          layer({
            source: 'fm',
            wave: 'sine',
            freq: f,
            freqEnd: f,
            fmHarmonicity: choose(r, [1.4, 2.76, 3.5] as const),
            fmIndex: range(r, 2, 5),
            attack: 0.003,
            decay: 0.3,
            sustain: 0.25,
            hold: 0.1,
            release: range(r, 0.8, 1.4),
          }),
        ],
        { reverbWet: 0.2, reverbDecay: 1.6 },
      );
    },
  },
  {
    id: 'drop',
    label: '水滴',
    make: (r) => {
      const f = logRange(r, 500, 800);
      return sfx(
        [
          layer({
            wave: 'sine',
            freq: f,
            freqEnd: f * range(r, 2.5, 3.5),
            attack: 0.002,
            decay: 0.05,
            sustain: 0.2,
            hold: 0.01,
            release: 0.06,
          }),
        ],
        { reverbWet: 0.3, reverbDecay: 1.2 },
      );
    },
  },
  {
    id: 'error',
    label: '錯誤',
    make: (r) => {
      const f = logRange(r, 150, 220);
      return sfx([
        // 兩個差一點點的音：不和諧的「嗡」聲（低通讓它不刺耳）
        layer({
          wave: 'square',
          freq: f,
          freqEnd: f,
          filter: 'lowpass',
          cutoff: 1600,
          cutoffEnd: 1600,
          attack: 0.008,
          decay: 0.05,
          sustain: 0.7,
          hold: 0.06,
          release: 0.05,
        }),
        layer({
          wave: 'square',
          freq: f * 1.06,
          freqEnd: f * 1.06,
          filter: 'lowpass',
          cutoff: 1600,
          cutoffEnd: 1600,
          attack: 0.008,
          decay: 0.05,
          sustain: 0.7,
          hold: 0.06,
          release: 0.05,
        }),
        layer({
          wave: 'square',
          freq: f * 0.9,
          freqEnd: f * 0.9,
          filter: 'lowpass',
          cutoff: 1400,
          cutoffEnd: 1400,
          delay: 0.17,
          attack: 0.008,
          decay: 0.05,
          sustain: 0.7,
          hold: 0.12,
          release: 0.08,
        }),
      ]);
    },
  },
  {
    id: 'success',
    label: '成功',
    make: (r) => {
      // 大三和弦往上琶音（Do Mi Sol 高音 Do）
      const f = logRange(r, 440, 620);
      const note = (k: number, i: number) =>
        layer({
          wave: 'triangle',
          freq: f * k,
          freqEnd: f * k,
          delay: i * 0.09,
          attack: 0.006,
          decay: 0.08,
          sustain: 0.45,
          hold: i === 3 ? 0.25 : 0.06,
          release: i === 3 ? 0.4 : 0.1,
        });
      return sfx([note(1, 0), note(1.26, 1), note(1.5, 2), note(2, 3)], { reverbWet: 0.15, reverbDecay: 1.2 });
    },
  },
  {
    id: 'land',
    label: '落地',
    make: (r) =>
      sfx([
        layer({
          wave: 'sine',
          freq: logRange(r, 140, 200),
          freqEnd: 50,
          attack: 0.003,
          decay: 0.1,
          sustain: 0.15,
          hold: 0.02,
          release: 0.1,
        }),
        layer({
          source: 'noise',
          noise: 'brown',
          filter: 'lowpass',
          cutoff: logRange(r, 600, 1000),
          cutoffEnd: 200,
          attack: 0.002,
          decay: 0.08,
          sustain: 0.1,
          hold: 0,
          release: 0.08,
          volume: -4,
        }),
      ]),
  },
  {
    id: 'alarm',
    label: '警報',
    make: (r) => {
      const f = logRange(r, 500, 750);
      return sfx(
        [
          layer({
            wave: 'square',
            freq: f,
            freqEnd: f,
            vibratoRate: range(r, 4, 7),
            vibratoDepth: range(r, 300, 500),
            filter: 'lowpass',
            cutoff: 2500,
            cutoffEnd: 2500,
            attack: 0.02,
            decay: 0.05,
            sustain: 0.8,
            hold: range(r, 0.8, 1.2),
            release: 0.15,
          }),
        ],
        { volume: -6 },
      );
    },
  },
  // ───────── 介面 ─────────
  // 介面音效不開自動音量：用整體音量對齊「點擊」（最大音量約 -12 dB），常出現的懸停更輕、通知稍微突出
  {
    id: 'hover',
    label: '懸停',
    make: (r) => {
      // 滑鼠移到按鈕上：極短、很輕的高音（常常連續出現，要不搶耳）
      const f = logRange(r, 2200, 3200);
      return sfx(
        [
          layer({
            wave: 'sine',
            freq: f,
            freqEnd: f * 1.05,
            attack: 0.001,
            decay: 0.015,
            sustain: 0,
            hold: 0,
            release: 0.015,
            volume: -6,
          }),
        ],
        { normalize: false, volume: -16 },
      );
    },
  },
  {
    id: 'confirm',
    label: '確認',
    make: (r) => {
      // 兩個音往上跳五度：「好」的感覺
      const f = logRange(r, 620, 880);
      const note = (k: number, i: number) =>
        layer({
          wave: 'triangle',
          freq: f * k,
          freqEnd: f * k,
          delay: i * 0.06,
          attack: 0.002,
          decay: 0.05,
          sustain: 0.4,
          hold: i === 1 ? 0.05 : 0.02,
          release: i === 1 ? 0.15 : 0.05,
        });
      return sfx([note(1, 0), note(1.5, 1)], { reverbWet: 0.1, reverbDecay: 0.6, normalize: false, volume: -8 });
    },
  },
  {
    id: 'cancel',
    label: '取消',
    make: (r) => {
      // 兩個音往下走：「返回、算了」（低通讓它柔和，不像錯誤那麼刺耳）
      const f = logRange(r, 520, 700);
      const note = (k: number, i: number) =>
        layer({
          wave: 'square',
          freq: f * k,
          freqEnd: f * k,
          filter: 'lowpass',
          cutoff: 1800,
          cutoffEnd: 1800,
          delay: i * 0.07,
          attack: 0.002,
          decay: 0.05,
          sustain: 0.3,
          hold: 0.02,
          release: i === 1 ? 0.1 : 0.04,
          volume: -8,
        });
      return sfx([note(1, 0), note(0.75, 1)], { normalize: false, volume: -6 });
    },
  },
  {
    id: 'openPanel',
    label: '開啟視窗',
    make: (r) => {
      // 往上掃：空氣聲（帶通掃頻的雜訊）＋ 往上滑的音
      const f = logRange(r, 260, 360);
      return sfx(
        [
          layer({
            source: 'noise',
            noise: 'pink',
            filter: 'bandpass',
            cutoff: 500,
            cutoffEnd: logRange(r, 3000, 4500),
            q: 1.5,
            attack: 0.03,
            decay: 0.1,
            sustain: 0.3,
            hold: 0.02,
            release: 0.08,
            volume: -10,
          }),
          layer({
            wave: 'sine',
            freq: f,
            freqEnd: f * 2.2,
            attack: 0.01,
            decay: 0.1,
            sustain: 0.3,
            hold: 0.02,
            release: 0.08,
            volume: -8,
          }),
        ],
        { reverbWet: 0.12, reverbDecay: 0.5, normalize: false, volume: -4 },
      );
    },
  },
  {
    id: 'closePanel',
    label: '關閉視窗',
    make: (r) => {
      // 和開啟相反：往下掃，比較短
      const f = logRange(r, 600, 800);
      return sfx(
        [
          layer({
            source: 'noise',
            noise: 'pink',
            filter: 'bandpass',
            cutoff: logRange(r, 3000, 4000),
            cutoffEnd: 450,
            q: 1.5,
            attack: 0.01,
            decay: 0.09,
            sustain: 0.2,
            hold: 0.01,
            release: 0.06,
            volume: -10,
          }),
          layer({
            wave: 'sine',
            freq: f,
            freqEnd: f * 0.45,
            attack: 0.005,
            decay: 0.09,
            sustain: 0.2,
            hold: 0.01,
            release: 0.06,
            volume: -8,
          }),
        ],
        { reverbWet: 0.1, reverbDecay: 0.4, normalize: false, volume: -4 },
      );
    },
  },
  {
    id: 'toggle',
    label: '切換開關',
    make: (r) =>
      // 機械的「咔嗒」：很短的雜訊 ＋ 短音，梳狀濾波做出塑膠外殼的共鳴
      sfx(
        [
          layer({
            source: 'noise',
            noise: 'white',
            filter: 'highpass',
            cutoff: 2500,
            cutoffEnd: 2500,
            attack: 0.001,
            decay: 0.012,
            sustain: 0,
            hold: 0,
            release: 0.01,
            volume: -4,
          }),
          layer({
            wave: 'square',
            freq: logRange(r, 900, 1300),
            freqEnd: 700,
            filter: 'lowpass',
            cutoff: 3000,
            cutoffEnd: 3000,
            attack: 0.001,
            decay: 0.025,
            sustain: 0,
            hold: 0,
            release: 0.015,
            volume: -10,
          }),
        ],
        { combWet: 0.35, combFreq: logRange(r, 1400, 2200), combFeedback: 0.5, normalize: false, volume: -8 },
      ),
  },
  {
    id: 'notify',
    label: '通知',
    make: (r) => {
      // FM 鈴聲「叮咚」：第二個音低四度
      const f = logRange(r, 880, 1180);
      const bell = (k: number, i: number) =>
        layer({
          source: 'fm',
          wave: 'sine',
          freq: f * k,
          freqEnd: f * k,
          fmHarmonicity: 3.5,
          fmIndex: range(r, 4, 7),
          delay: i * 0.14,
          attack: 0.002,
          decay: 0.25,
          sustain: 0.05,
          hold: 0,
          release: 0.35,
          volume: i === 0 ? -6 : -8,
        });
      return sfx([bell(1, 0), bell(0.75, 1)], { reverbWet: 0.2, reverbDecay: 1, normalize: false, volume: -4 });
    },
  },
];

/** 每個數字參數依間隔取整（範本用亂數產生的值，例如 338.123 → 338） */
export function tidySfx(src: SfxData): SfxData {
  const out: SfxData = { ...src, layers: src.layers.map((l) => ({ ...l })) };
  for (const l of out.layers) for (const p of LAYER_PARAMS) l[p.key] = roundTo(clamp(l[p.key], p.min, p.max), p.step);
  for (const p of MASTER_PARAMS) out[p.key] = roundTo(clamp(out[p.key], p.min, p.max), p.step);
  return out;
}

/** 用範本產生音效（rng 省略時用 Math.random） */
export function fromPreset(id: string, rng: Rng = Math.random): SfxData {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return tidySfx(p.make(rng));
}

/** 隨機產生：隨機挑一個範本，再大幅變化 */
export function randomSfx(rng: Rng = Math.random): SfxData {
  return mutateSfx(fromPreset(choose(rng, PRESETS).id, rng), 0.35, rng);
}

/**
 * 微調變化：每個數字參數在目前的值附近隨機變動（amount 是範圍的比例，0.1 = 10%）。
 * 頻率用對數刻度變動（聽起來比較平均）。
 */
export function mutateSfx(src: SfxData, amount = 0.1, rng: Rng = Math.random): SfxData {
  const jitter = (v: number, p: NumberParam<string>) => {
    if (p.log) return clamp(Math.exp(Math.log(v) + (rng() * 2 - 1) * amount * Math.log(p.max / p.min)), p.min, p.max);
    return clamp(v + (rng() * 2 - 1) * amount * (p.max - p.min), p.min, p.max);
  };
  const out: SfxData = { ...src, layers: src.layers.map((l) => ({ ...l })) };
  for (const l of out.layers)
    for (const p of LAYER_PARAMS) {
      // 音量、延遲開始不變動（保持圖層的平衡與節奏）
      if (p.key === 'volume' || p.key === 'delay') continue;
      l[p.key] = roundTo(jitter(l[p.key], p), p.step);
    }
  for (const p of MASTER_PARAMS) {
    if (p.key === 'volume' || p.key === 'bits' || p.key === 'downsample') continue;
    // 關著的後製保持關著
    if (p.off !== undefined && out[p.key] === p.off) continue;
    out[p.key] = roundTo(jitter(out[p.key], p), p.step);
  }
  return out;
}

/** 依間隔取整（避免 0.30000000004 這種數字寫進檔案） */
export function roundTo(v: number, step: number): number {
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(v / step) * step).toFixed(digits));
}
