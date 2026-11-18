/**
 * 音效檔（public/sounds/<名稱>.sfx.json）：合成音效的參數，音效編輯器打開、修改、存檔；
 * 存檔時同時烘焙成 <名稱>.wav，遊戲播放的是 .wav（遊戲不需要 Tone.js）。
 *
 *   { "format": "hero-sfx", "version": 1,
 *     "layers": [ { "source": "osc", "wave": "square", "freq": 880, "freqEnd": 1760, … } ],
 *     "distortion": 0, "bits": 16, "echoWet": 0, "reverbWet": 0, "volume": -6, "normalize": true }
 *
 * 一個音效由 1～4 層疊起來：每層是一個聲音來源（振盪器／雜訊／FM），經過濾波器與音量包絡；
 * 最後整體經過失真、位元壓縮、回音、殘響。
 * 這個檔案不使用 Tone.js（開發伺服器檢查檔案、測試也用它）；合成在 synth.ts。
 */

/** 聲音來源 */
export type SourceKind = 'osc' | 'noise' | 'fm';
export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';
export type NoiseKind = 'white' | 'pink' | 'brown';
export type FilterKind = 'none' | 'lowpass' | 'highpass' | 'bandpass';

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
  /** 失真（0..1） */
  distortion: number;
  /** 位元數（16 = 不壓縮；越小越粗糙、越復古） */
  bits: number;
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
}

type LayerNumberKey = {
  [K in keyof SfxLayer]: SfxLayer[K] extends number ? K : never;
}[keyof SfxLayer];
type SfxNumberKey = Exclude<{ [K in keyof SfxData]: SfxData[K] extends number ? K : never }[keyof SfxData], 'version'>;

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
  { key: 'distortion', label: '失真', min: 0, max: 1, step: 0.01 },
  { key: 'bits', label: '位元數', min: 1, max: 16, step: 1, hint: '16 = 不壓縮；越小越粗糙、越復古' },
  { key: 'echoTime', label: '回音間隔', min: 0.01, max: 1, step: 0.005, unit: '秒' },
  { key: 'echoFeedback', label: '回音回饋', min: 0, max: 0.9, step: 0.01 },
  { key: 'echoWet', label: '回音份量', min: 0, max: 1, step: 0.01, hint: '0 = 關' },
  { key: 'reverbDecay', label: '殘響長度', min: 0.1, max: 5, step: 0.05, unit: '秒' },
  { key: 'reverbWet', label: '殘響份量', min: 0, max: 1, step: 0.01, hint: '0 = 關' },
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
    distortion: 0,
    bits: 16,
    echoTime: 0.12,
    echoFeedback: 0.3,
    echoWet: 0,
    reverbDecay: 1.2,
    reverbWet: 0,
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
  if (sfx.reverbWet > 0) len += sfx.reverbDecay;
  return clamp(len, 0.02, MAX_DURATION);
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
    if (p.key === 'volume' || p.key === 'bits') continue;
    // 關著的效果（份量 0）保持關著
    if ((p.key === 'echoWet' || p.key === 'reverbWet' || p.key === 'distortion') && out[p.key] === 0) continue;
    out[p.key] = roundTo(jitter(out[p.key], p), p.step);
  }
  return out;
}

/** 依間隔取整（避免 0.30000000004 這種數字寫進檔案） */
export function roundTo(v: number, step: number): number {
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(v / step) * step).toFixed(digits));
}
