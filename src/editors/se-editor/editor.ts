/**
 * 音效編輯器：用 Tone.js 合成音效（synth.ts），存成 public/sounds/<名稱>.sfx.json（參數）與 <名稱>.wav（遊戲播放）。
 *
 * - 左：範本（每次點都有一點隨機）、圖層（1～4 層）
 * - 中：波形（點一下播放）、選取圖層的音量包絡與音高／濾波曲線（可以拖曳圓點調整）
 * - 右：選取圖層的參數、整體後製（音高、等化、音色、調變、空間、動態；順序見 synth.ts）
 * - 每次修改都重新離線合成，播放的就是會存成 .wav 的那份聲音
 */
import { showConfirm, showPrompt } from '../shared/dialog';
import { download, h } from '../shared/dom';
import { storage } from '../shared/storage';
import {
  deleteSfxFile,
  fileNameOf,
  listSfxFiles,
  listWavs,
  readSfxFile,
  soundNameOf,
  writeSfxFile,
  type SfxFileInfo,
} from './files';
import {
  COMPRESSORS,
  FILTERS,
  LAYER_PARAMS,
  MASTER_PARAMS,
  MAX_LAYERS,
  NOISES,
  type NumberParam,
  PRESETS,
  REVERBS,
  SOURCES,
  type SfxData,
  type SfxLayer,
  WAVES,
  defaultLayer,
  defaultSfx,
  fromPreset,
  layerLength,
  mutateSfx,
  randomSfx,
  roundTo,
  stringifySfx,
} from './sfx';
import { SAMPLE_RATE, peakOf, renderSfx } from './synth';
import { encodeWav } from './wav';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const LAST_FILE_KEY = 'hero-se-editor/last-file';
const AUTO_KEY = 'hero-se-editor/autoplay';

// ───────── 狀態 ─────────

let sfx: SfxData = defaultSfx();
let selected = 0;
let fileName: string | null = null;
let savedText = '';
let files: SfxFileInfo[] = [];
let samples: Float32Array<ArrayBuffer> = new Float32Array(0);
let tab: 'layer' | 'master' = 'layer';
let autoplay = storage.get(AUTO_KEY) !== '0';

const undoStack: string[] = [];
const redoStack: string[] = [];
/** 拖曳滑桿、圓點時：開始那一刻的內容（放開時才算一個復原步驟） */
let pending: string | null = null;
const snapshot = () => JSON.stringify(sfx);

/**
 * 修改音效。done 為 false 代表還在拖曳（只重新合成，放開時才記錄復原、自動播放）。
 */
function change(fn: () => void, done = true): void {
  if (pending === null) pending = snapshot();
  fn();
  scheduleRender(done && autoplay);
  if (done) {
    if (pending !== snapshot()) {
      undoStack.push(pending);
      if (undoStack.length > 200) undoStack.shift();
      redoStack.length = 0;
    }
    pending = null;
  }
  refreshUI();
}

/** 整份換掉（範本、隨機、復原） */
function replace(next: SfxData, play = autoplay): void {
  change(() => {
    sfx = next;
    selected = Math.min(selected, sfx.layers.length - 1);
  });
  renderParams();
  if (play) scheduleRender(true);
}

function undo(): void {
  const prev = undoStack.pop();
  if (prev === undefined) return toast('沒有可復原的動作');
  redoStack.push(snapshot());
  sfx = JSON.parse(prev) as SfxData;
  selected = Math.min(selected, sfx.layers.length - 1);
  renderParams();
  refreshUI();
  scheduleRender(false);
}
function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(snapshot());
  sfx = JSON.parse(next) as SfxData;
  selected = Math.min(selected, sfx.layers.length - 1);
  renderParams();
  refreshUI();
  scheduleRender(false);
}

const layerOf = () => sfx.layers[selected];

// ───────── 合成、播放 ─────────

let renderTimer = 0;
let renderSerial = 0;
let playAfter = false;
function scheduleRender(play: boolean): void {
  playAfter ||= play;
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => void renderNow(), 50);
}

async function renderNow(): Promise<Float32Array<ArrayBuffer>> {
  const serial = ++renderSerial;
  const play = playAfter;
  playAfter = false;
  try {
    const out = await renderSfx(sfx);
    if (serial !== renderSerial) return samples; // 已經有更新的合成
    samples = out;
    drawWave();
    $('waveInfo').textContent =
      `${(samples.length / SAMPLE_RATE).toFixed(2)} 秒・最大音量 ${(20 * Math.log10(Math.max(1e-6, peakOf(samples)))).toFixed(1)} dB`;
    if (play) void playSamples();
  } catch (error) {
    toast(`合成失敗：${(error as Error).message}`, true);
  }
  return samples;
}

let audioCtx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
let playStart = 0;
async function playSamples(): Promise<void> {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  stopPlaying();
  if (!samples.length) return;
  const buffer = audioCtx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.onended = () => {
    if (playing === src) {
      playing = null;
      $('playBtn').classList.remove('playing');
      drawWave();
    }
  };
  playing = src;
  playStart = audioCtx.currentTime;
  src.start();
  $('playBtn').classList.add('playing');
  requestAnimationFrame(animatePlayhead);
}
function stopPlaying(): void {
  if (!playing) return;
  playing.onended = null;
  playing.stop();
  playing = null;
  $('playBtn').classList.remove('playing');
}
function animatePlayhead(): void {
  if (!playing || !audioCtx) return;
  drawWave((audioCtx.currentTime - playStart) / (samples.length / SAMPLE_RATE));
  requestAnimationFrame(animatePlayhead);
}

// ───────── 畫圖 ─────────

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const FILTER_COLOR = '#6ec6ff';

/** 準備畫布（依實際大小與螢幕密度） */
function canvas2d(el: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = el.clientWidth;
  const ht = el.clientHeight;
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(ht * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(ht * dpr);
  }
  const g = el.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, ht);
  return { g, w, h: ht };
}

/** 時間格線（每 0.1／0.5 秒） */
function timeGrid(g: CanvasRenderingContext2D, w: number, ht: number, seconds: number, pad = 0): void {
  const step = seconds > 2 ? 0.5 : seconds > 0.6 ? 0.1 : 0.05;
  g.strokeStyle = css('--line');
  g.fillStyle = css('--muted');
  g.font = '10px ui-monospace, monospace';
  g.lineWidth = 1;
  for (let t = step; t < seconds; t += step) {
    const x = pad + (t / seconds) * (w - pad * 2);
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, 0);
    g.lineTo(Math.round(x) + 0.5, ht);
    g.stroke();
    if (Math.round(t / step) % (step === 0.05 ? 2 : step === 0.1 ? 5 : 2) === 0)
      g.fillText(`${roundTo(t, 0.01)}s`, x + 3, ht - 4);
  }
}

function drawWave(progress = -1): void {
  const { g, w, h: ht } = canvas2d($<HTMLCanvasElement>('wave'));
  const seconds = samples.length / SAMPLE_RATE || 1;
  timeGrid(g, w, ht, seconds);
  const mid = ht / 2;
  g.strokeStyle = css('--line-hi');
  g.beginPath();
  g.moveTo(0, mid + 0.5);
  g.lineTo(w, mid + 0.5);
  g.stroke();
  if (!samples.length) return;
  // 每一欄：最小、最大值
  const accent = css('--accent');
  const grad = g.createLinearGradient(0, 0, 0, ht);
  grad.addColorStop(0, css('--accent-hi'));
  grad.addColorStop(0.5, accent);
  grad.addColorStop(1, css('--accent-hi'));
  g.fillStyle = grad;
  const per = samples.length / w;
  for (let x = 0; x < w; x++) {
    let lo = 0;
    let hi = 0;
    const a = Math.floor(x * per);
    const b = Math.min(samples.length, Math.floor((x + 1) * per) + 1);
    for (let i = a; i < b; i++) {
      const s = samples[i];
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    const y0 = mid - hi * (mid - 6);
    const y1 = mid - lo * (mid - 6);
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  if (progress >= 0 && progress <= 1) {
    g.fillStyle = css('--text');
    g.fillRect(progress * w, 0, 1.5, ht);
  }
}

/** 包絡、音高圖共用：拖曳中的時間刻度固定（避免一邊拖一邊縮放） */
let frozenSeconds: number | null = null;
const graphSeconds = () => frozenSeconds ?? Math.max(0.25, layerLength(layerOf()) * 1.15);
const PAD = 14;

/** 包絡圖的控制點：起音頂點、衰減結束（延音音量）、維持結束、釋音結束 */
function envPoints(l: SfxLayer, w: number, ht: number) {
  const s = graphSeconds();
  const x = (t: number) => PAD + (t / s) * (w - PAD * 2);
  const y = (v: number) => ht - PAD - v * (ht - PAD * 2);
  const t1 = l.delay + l.attack;
  const t2 = t1 + l.decay;
  const t3 = t2 + l.hold;
  const t4 = t3 + l.release;
  return {
    toX: x,
    toY: y,
    toTime: (px: number) => ((px - PAD) / (w - PAD * 2)) * s,
    toLevel: (py: number) => (ht - PAD - py) / (ht - PAD * 2),
    points: [
      { key: 'start', x: x(l.delay), y: y(0) },
      { key: 'attack', x: x(t1), y: y(1) },
      { key: 'decay', x: x(t2), y: y(l.sustain) },
      { key: 'hold', x: x(t3), y: y(l.sustain) },
      { key: 'release', x: x(t4), y: y(0) },
    ],
  };
}

function drawEnv(): void {
  const { g, w, h: ht } = canvas2d($<HTMLCanvasElement>('env'));
  const l = layerOf();
  timeGrid(g, w, ht, graphSeconds(), PAD);
  const { points } = envPoints(l, w, ht);
  const accent = css('--accent');
  // 填色
  g.beginPath();
  g.moveTo(PAD, ht - PAD);
  for (const p of points) g.lineTo(p.x, p.y);
  g.lineTo(points.at(-1)!.x, ht - PAD);
  g.closePath();
  g.fillStyle = 'rgba(154, 205, 50, 0.14)';
  g.fill();
  g.beginPath();
  g.moveTo(PAD, ht - PAD);
  for (const p of points) g.lineTo(p.x, p.y);
  g.strokeStyle = accent;
  g.lineWidth = 2;
  g.stroke();
  for (const p of points.slice(1)) handle(g, p.x, p.y, accent, hover === `env:${p.key}`);
}

/** 音高圖：頻率用對數刻度（20Hz～20kHz） */
const F_MIN = 20;
const F_MAX = 20000;
function pitchMap(w: number, ht: number) {
  const s = graphSeconds();
  const l = layerOf();
  const x = (t: number) => PAD + (t / s) * (w - PAD * 2);
  const y = (f: number) => ht - PAD - (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * (ht - PAD * 2);
  const t0 = l.delay;
  const t1 = l.delay + layerLength(l) - l.delay;
  return {
    x,
    y,
    toFreq: (py: number) => F_MIN * (F_MAX / F_MIN) ** ((ht - PAD - py) / (ht - PAD * 2)),
    t0,
    t1,
  };
}

function drawPitch(): void {
  const { g, w, h: ht } = canvas2d($<HTMLCanvasElement>('pitch'));
  const l = layerOf();
  timeGrid(g, w, ht, graphSeconds(), PAD);
  const m = pitchMap(w, ht);
  // 頻率格線：100、1k、10k
  g.fillStyle = css('--muted');
  g.font = '10px ui-monospace, monospace';
  for (const f of [100, 1000, 10000]) {
    g.strokeStyle = css('--line');
    g.beginPath();
    g.moveTo(PAD, Math.round(m.y(f)) + 0.5);
    g.lineTo(w - PAD, Math.round(m.y(f)) + 0.5);
    g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 2, m.y(f) - 3);
  }
  const line = (a: number, b: number, color: string, dashed: boolean, key: string) => {
    g.setLineDash(dashed ? [5, 4] : []);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(m.x(m.t0), m.y(a));
    g.lineTo(m.x(m.t1), m.y(b));
    g.stroke();
    g.setLineDash([]);
    handle(g, m.x(m.t0), m.y(a), color, hover === `pitch:${key}Start`);
    handle(g, m.x(m.t1), m.y(b), color, hover === `pitch:${key}End`);
  };
  if (l.filter !== 'none') line(l.cutoff, l.cutoffEnd, FILTER_COLOR, true, 'cutoff');
  if (l.source !== 'noise') line(l.freq, l.freqEnd, css('--accent'), false, 'freq');
}

function handle(g: CanvasRenderingContext2D, x: number, y: number, color: string, hot: boolean): void {
  g.beginPath();
  g.arc(x, y, hot ? 6.5 : 5, 0, Math.PI * 2);
  g.fillStyle = css('--panel');
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = color;
  g.stroke();
}

// ───────── 拖曳圖上的圓點 ─────────

let hover: string | null = null;

/** 找出滑鼠下的圓點 */
function hitEnv(px: number, py: number): string | null {
  const c = $<HTMLCanvasElement>('env');
  const { points } = envPoints(layerOf(), c.clientWidth, c.clientHeight);
  for (const p of points.slice(1)) if (Math.hypot(p.x - px, p.y - py) < 9) return `env:${p.key}`;
  return null;
}
function hitPitch(px: number, py: number): string | null {
  const c = $<HTMLCanvasElement>('pitch');
  const l = layerOf();
  const m = pitchMap(c.clientWidth, c.clientHeight);
  const pts: [string, number, number][] = [];
  if (l.source !== 'noise') pts.push(['freqStart', m.x(m.t0), m.y(l.freq)], ['freqEnd', m.x(m.t1), m.y(l.freqEnd)]);
  if (l.filter !== 'none')
    pts.push(['cutoffStart', m.x(m.t0), m.y(l.cutoff)], ['cutoffEnd', m.x(m.t1), m.y(l.cutoffEnd)]);
  for (const [key, x, y] of pts) if (Math.hypot(x - px, y - py) < 9) return `pitch:${key}`;
  return null;
}

const paramOf = (key: string) => LAYER_PARAMS.find((p) => p.key === key)!;
const clampParam = (key: string, v: number) => {
  const p = paramOf(key);
  return roundTo(Math.min(p.max, Math.max(p.min, v)), p.step);
};

function setupDrag(
  el: HTMLCanvasElement,
  hit: (x: number, y: number) => string | null,
  apply: (key: string, x: number, y: number) => void,
  draw: () => void,
): void {
  el.addEventListener('pointermove', (e) => {
    if (el.hasPointerCapture(e.pointerId)) return;
    const r = el.getBoundingClientRect();
    const k = hit(e.clientX - r.left, e.clientY - r.top);
    el.style.cursor = k ? 'grab' : 'default';
    if (k !== hover) {
      hover = k;
      draw();
    }
  });
  el.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      draw();
    }
  });
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    const key = hit(e.clientX - r.left, e.clientY - r.top);
    if (!key) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    frozenSeconds = graphSeconds();
    const move = (ev: PointerEvent) => apply(key, ev.clientX - r.left, ev.clientY - r.top);
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      apply(key, ev.clientX - r.left, ev.clientY - r.top);
      frozenSeconds = null;
      change(() => {}, true); // 放開：記錄復原、自動播放
      el.style.cursor = 'grab';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

setupDrag(
  $<HTMLCanvasElement>('env'),
  hitEnv,
  (key, px, py) => {
    const c = $<HTMLCanvasElement>('env');
    const l = layerOf();
    const m = envPoints(l, c.clientWidth, c.clientHeight);
    const t = m.toTime(px);
    change(() => {
      if (key === 'env:attack') l.attack = clampParam('attack', t - l.delay);
      else if (key === 'env:decay') {
        l.decay = clampParam('decay', t - l.delay - l.attack);
        l.sustain = clampParam('sustain', m.toLevel(py));
      } else if (key === 'env:hold') {
        l.hold = clampParam('hold', t - l.delay - l.attack - l.decay);
        l.sustain = clampParam('sustain', m.toLevel(py));
      } else if (key === 'env:release') l.release = clampParam('release', t - l.delay - l.attack - l.decay - l.hold);
    }, false);
  },
  drawEnv,
);
setupDrag(
  $<HTMLCanvasElement>('pitch'),
  hitPitch,
  (key, _px, py) => {
    const c = $<HTMLCanvasElement>('pitch');
    const f = pitchMap(c.clientWidth, c.clientHeight).toFreq(py);
    const l = layerOf();
    change(() => {
      if (key === 'pitch:freqStart') l.freq = clampParam('freq', f);
      else if (key === 'pitch:freqEnd') l.freqEnd = clampParam('freqEnd', f);
      else if (key === 'pitch:cutoffStart') l.cutoff = clampParam('cutoff', f);
      else if (key === 'pitch:cutoffEnd') l.cutoffEnd = clampParam('cutoffEnd', f);
    }, false);
  },
  drawPitch,
);

$<HTMLCanvasElement>('wave').addEventListener('click', () => void playSamples());

// ───────── 參數面板 ─────────

/** 每個欄位：資料改了（拖曳圖上的圓點、復原）時更新顯示 */
let setters: (() => void)[] = [];

/** 數字參數：滑桿（頻率用對數刻度）＋ 數字 */
function numberRow(p: NumberParam<string>, get: () => number, set: (v: number) => void): HTMLElement {
  const row = h('div', 'p-row');
  const label = h('label', '', p.label);
  if (p.hint) label.title = p.hint;
  const range = h('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1000';
  const toSlider = (v: number) =>
    (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min)) * 1000;
  const fromSlider = (s: number) => {
    const k = s / 1000;
    return p.log ? p.min * (p.max / p.min) ** k : p.min + k * (p.max - p.min);
  };
  const num = h('input');
  num.type = 'number';
  num.min = String(p.min);
  num.max = String(p.max);
  num.step = String(p.step);
  num.title = p.unit ? `單位：${p.unit}` : '';
  const show = () => {
    const v = get();
    range.value = String(toSlider(v));
    range.style.setProperty('--fill', `${toSlider(v) / 10}%`);
    if (document.activeElement !== num) num.value = String(v);
  };
  const apply = (v: number, done: boolean) => {
    const clamped = roundTo(Math.min(p.max, Math.max(p.min, v)), p.step);
    change(() => set(clamped), done);
    show();
  };
  range.addEventListener('input', () => apply(fromSlider(Number(range.value)), false));
  range.addEventListener('change', () => apply(fromSlider(Number(range.value)), true));
  num.addEventListener('change', () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) apply(v, true);
    else show();
  });
  show();
  setters.push(show);
  const unit = h('span', 'p-unit', p.unit ?? '');
  const numWrap = h('div');
  numWrap.style.cssText = 'display:flex;align-items:center';
  numWrap.append(num, unit);
  row.append(label, range, numWrap);
  return row;
}

function selectRow<T extends string>(
  label: string,
  options: readonly (readonly [T, string])[],
  get: () => T,
  set: (v: T) => void,
): HTMLElement {
  const row = h('div', 'p-row select');
  const sel = h('select');
  for (const [v, l] of options) sel.add(new Option(l, v));
  sel.value = get();
  sel.addEventListener('change', () => {
    change(() => set(sel.value as T));
    renderParams(); // 欄位可能要換（例如雜訊沒有音高）
  });
  setters.push(() => {
    sel.value = get();
  });
  row.append(h('label', '', label), sel);
  return row;
}

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const s = h('div', 'p-section');
  s.append(h('div', 'p-title', title), ...rows);
  return s;
}

function renderParams(): void {
  setters = [];
  const box = $('params');
  box.replaceChildren();
  if (tab === 'master') {
    const p = (key: string) => MASTER_PARAMS.find((x) => x.key === key)!;
    const num = (key: string) =>
      numberRow(
        p(key),
        () => sfx[p(key).key],
        (v) => {
          sfx[p(key).key] = v;
        },
      );
    const nums = (...keys: string[]) => keys.map(num);
    const norm = h('div', 'p-row select');
    const check = h('input');
    check.type = 'checkbox';
    check.checked = sfx.normalize;
    check.addEventListener('change', () => change(() => (sfx.normalize = check.checked)));
    setters.push(() => (check.checked = sfx.normalize));
    const lab = h('label', '', '自動音量');
    lab.title = '把最大音量調到接近滿格（不同音效的音量比較一致）';
    const wrap = h('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;color:var(--text2);font-size:12px';
    wrap.append(check, '調到接近滿格');
    norm.append(lab, wrap);
    // 依訊號經過的順序排列（synth.ts 的 buildMaster）；每個處理器都有「關」的值（見欄位說明）
    box.append(
      section('音高', ...nums('pitchShift', 'freqShift')),
      section('等化', ...nums('eqLow', 'eqMid', 'eqHigh')),
      section('音色', ...nums('distortion', 'chebyWet', 'chebyOrder', 'bits', 'downsample')),
      section('音量顫抖', ...nums('tremoloDepth', 'tremoloRate')),
      section('顫音', ...nums('vibratoDepth', 'vibratoRate')),
      section('自動濾波', ...nums('autoFilterDepth', 'autoFilterRate', 'autoFilterBase')),
      section('自動哇音', ...nums('autoWahWet', 'autoWahBase')),
      section('移相', ...nums('phaserWet', 'phaserRate', 'phaserOctaves')),
      section('梳狀濾波', ...nums('combWet', 'combFreq', 'combFeedback')),
      section('噪音閘門', num('gateThreshold')),
      section('回音', ...nums('echoWet', 'echoTime', 'echoFeedback')),
      section(
        '殘響',
        num('reverbWet'),
        num('reverbDecay'),
        selectRow(
          '算法',
          REVERBS,
          () => sfx.reverbType,
          (v) => (sfx.reverbType = v),
        ),
      ),
      section(
        '壓縮與限制',
        selectRow(
          '壓縮',
          COMPRESSORS,
          () => sfx.compressor,
          (v) => (sfx.compressor = v),
        ),
        ...(sfx.compressor === 'off' ? [] : nums('compThreshold', 'compRatio')),
        num('limiterThreshold'),
      ),
      section('音量', num('volume'), norm),
    );
    return;
  }
  const l = layerOf();
  if (!l) {
    box.append(h('div', 'p-empty', '沒有圖層'));
    return;
  }
  const num = (key: string) =>
    numberRow(
      paramOf(key),
      () => layerOf()[paramOf(key).key],
      (v) => {
        layerOf()[paramOf(key).key] = v;
      },
    );
  const src = section(
    `圖層 ${selected + 1}`,
    selectRow(
      '聲音來源',
      SOURCES,
      () => layerOf().source,
      (v) => (layerOf().source = v),
    ),
  );
  if (l.source === 'noise')
    src.append(
      selectRow(
        '雜訊',
        NOISES,
        () => layerOf().noise,
        (v) => (layerOf().noise = v),
      ),
    );
  else
    src.append(
      selectRow(
        '波形',
        WAVES,
        () => layerOf().wave,
        (v) => (layerOf().wave = v),
      ),
    );
  box.append(src);
  if (l.source !== 'noise')
    box.append(section('音高', num('freq'), num('freqEnd'), num('vibratoRate'), num('vibratoDepth')));
  if (l.source === 'fm') box.append(section('FM', num('fmHarmonicity'), num('fmIndex')));
  const filter = section(
    '濾波',
    selectRow(
      '濾波器',
      FILTERS,
      () => layerOf().filter,
      (v) => (layerOf().filter = v),
    ),
  );
  if (l.filter !== 'none') filter.append(num('cutoff'), num('cutoffEnd'), num('q'));
  box.append(
    filter,
    section('音量包絡', num('delay'), num('attack'), num('decay'), num('sustain'), num('hold'), num('release')),
    section('音量', num('volume')),
  );
}

for (const t of document.querySelectorAll<HTMLElement>('.tab'))
  t.addEventListener('click', () => {
    tab = t.dataset.tab as typeof tab;
    for (const x of document.querySelectorAll('.tab')) x.classList.toggle('active', x === t);
    renderParams();
  });

// ───────── 圖層清單 ─────────

const describe = (l: SfxLayer) =>
  l.source === 'noise'
    ? (NOISES.find(([k]) => k === l.noise)?.[1] ?? '')
    : `${WAVES.find(([k]) => k === l.wave)?.[1] ?? ''}${l.source === 'fm' ? ' FM' : ''} ${Math.round(l.freq)}${l.freqEnd !== l.freq ? `→${Math.round(l.freqEnd)}` : ''}Hz`;

function renderLayers(): void {
  const box = $('layers');
  box.replaceChildren();
  sfx.layers.forEach((l, i) => {
    const row = h('div', `layer-row${i === selected ? ' selected' : ''}${l.enabled ? '' : ' off'}`);
    const check = h('input');
    check.type = 'checkbox';
    check.checked = l.enabled;
    check.title = '開關這一層';
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => change(() => (l.enabled = check.checked)));
    const name = h('div', 'layer-name', `圖層 ${i + 1}`);
    name.append(h('small', '', describe(l)));
    row.append(check, name);
    row.addEventListener('click', () => {
      selected = i;
      tab = 'layer';
      for (const x of document.querySelectorAll<HTMLElement>('.tab'))
        x.classList.toggle('active', x.dataset.tab === 'layer');
      renderParams();
      refreshUI();
    });
    box.append(row);
  });
  $<HTMLButtonElement>('addLayerBtn').disabled = sfx.layers.length >= MAX_LAYERS;
  $<HTMLButtonElement>('dupLayerBtn').disabled = sfx.layers.length >= MAX_LAYERS;
  $<HTMLButtonElement>('delLayerBtn').disabled = sfx.layers.length <= 1;
}

$('addLayerBtn').addEventListener('click', () => {
  change(() => {
    sfx.layers.push(defaultLayer());
    selected = sfx.layers.length - 1;
  });
  renderParams();
});
$('dupLayerBtn').addEventListener('click', () => {
  change(() => {
    sfx.layers.splice(selected + 1, 0, { ...layerOf() });
    selected++;
  });
  renderParams();
});
$('delLayerBtn').addEventListener('click', () => {
  change(() => {
    sfx.layers.splice(selected, 1);
    selected = Math.max(0, selected - 1);
  });
  renderParams();
});

// ───────── 範本、隨機 ─────────

for (const p of PRESETS) {
  const b = h('button', '', p.label);
  b.addEventListener('click', () => replace(fromPreset(p.id), true));
  $('presets').append(b);
}
$('randomBtn').addEventListener('click', () => replace(randomSfx(), true));
$('mutateBtn').addEventListener('click', () =>
  replace(mutateSfx(sfx, Number($<HTMLSelectElement>('mutateAmount').value)), true),
);

// ───────── 介面更新 ─────────

function refreshUI(): void {
  renderLayers();
  for (const s of setters) s();
  drawEnv();
  drawPitch();
  $<HTMLButtonElement>('undoBtn').disabled = !undoStack.length;
  $<HTMLButtonElement>('redoBtn').disabled = !redoStack.length;
  const dirty = isDirty();
  const doc = $('docName');
  doc.textContent = fileName ?? '未存檔';
  doc.classList.toggle('dirty', dirty);
  $<HTMLButtonElement>('deleteBtn').disabled = !fileName;
  $('stats').textContent = `${sfx.layers.length} 層`;
  document.title = `${dirty ? '● ' : ''}${fileName ? soundNameOf(fileName) : '未存檔'} — 音效編輯器`;
}

const isDirty = () => stringifySfx(sfx) !== savedText;

// ───────── 播放、自動播放 ─────────

$('playBtn').addEventListener('click', () => {
  if (playing) stopPlaying();
  else void playSamples();
});
const autoBtn = $('autoBtn');
autoBtn.classList.toggle('on', autoplay);
autoBtn.addEventListener('click', () => {
  autoplay = !autoplay;
  autoBtn.classList.toggle('on', autoplay);
  storage.set(AUTO_KEY, autoplay ? '1' : '0');
});
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

// ───────── 檔案 ─────────

let toastTimer = 0;
function toast(msg: string, error = false): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800 + msg.length * 40);
}

function renderFileSelect(): void {
  const sel = $<HTMLSelectElement>('fileSelect');
  sel.replaceChildren();
  if (!fileName) sel.add(new Option('（未存檔）', ''));
  for (const f of files) sel.add(new Option(soundNameOf(f.name), f.name));
  sel.value = fileName ?? '';
}

async function refreshFiles(): Promise<void> {
  try {
    files = await listSfxFiles();
  } catch (error) {
    toast(`讀取檔案清單失敗：${(error as Error).message}`, true);
    files = [];
  }
  renderFileSelect();
}

const confirmDiscard = async () =>
  !isDirty() ||
  (await showConfirm('目前的修改還沒儲存，要放棄嗎？', { title: '放棄修改', ok: '放棄修改', danger: true }));

/** 換成另一份音效；saved：這份內容已經在磁碟上（不算修改過） */
function setDocument(next: SfxData, name: string | null, saved: boolean): void {
  sfx = next;
  selected = 0;
  fileName = name;
  undoStack.length = 0;
  redoStack.length = 0;
  savedText = saved || !name ? stringifySfx(sfx) : '';
  if (name) storage.set(LAST_FILE_KEY, name);
  renderFileSelect();
  renderParams();
  refreshUI();
  scheduleRender(false);
}

async function openFile(name: string): Promise<void> {
  try {
    setDocument(await readSfxFile(name), name, true);
  } catch (error) {
    toast(`開啟 ${name} 失敗：${(error as Error).message}`, true);
    renderFileSelect();
  }
}

/** 問名稱（新增、第一次存檔）；名稱和不是用這裡做的 .wav 撞名時先確認；取消時回傳 null */
async function askName(suggest: string): Promise<string | null> {
  const wavs = await listWavs().catch(() => [] as string[]);
  for (;;) {
    const input = await showPrompt('英數字、-、_；會存成 public/sounds/名稱.sfx.json 與 名稱.wav', suggest, {
      title: '音效的名稱',
      validate: (v) => (fileNameOf(v) ? null : '名稱只能用英數字、-、_'),
    });
    if (input === null) return null;
    const name = fileNameOf(input)!;
    const base = soundNameOf(name);
    const hasSfx = files.some((f) => f.name === name);
    const hasWav = wavs.includes(`${base}.wav`);
    const question = hasSfx
      ? `已經有音效「${base}」，要覆蓋嗎？`
      : hasWav
        ? `public/sounds 裡已經有 ${base}.wav（不是用音效編輯器做的），存檔會覆蓋它，確定嗎？`
        : null;
    if (question && !(await showConfirm(question, { ok: '覆蓋', danger: true }))) {
      suggest = input;
      continue;
    }
    return name;
  }
}

async function save(): Promise<void> {
  if (!fileName) {
    const name = await askName(sfxSuggestName());
    if (!name) return;
    fileName = name;
  }
  try {
    clearTimeout(renderTimer);
    const out = await renderNow(); // 用目前的參數重新合成一次（存的就是聽到的）
    await writeSfxFile(fileName, sfx, out, SAMPLE_RATE);
    savedText = stringifySfx(sfx);
    storage.set(LAST_FILE_KEY, fileName);
    await refreshFiles();
    refreshUI();
    toast(`已儲存 sounds/${soundNameOf(fileName)}.sfx.json 與 .wav`);
  } catch (error) {
    toast(`儲存失敗：${(error as Error).message}`, true);
  }
}

/** 新音效的建議名稱：sfx1、sfx2… */
function sfxSuggestName(): string {
  for (let i = 1; ; i++) if (!files.some((f) => f.name === `sfx${i}.sfx.json`)) return `sfx${i}`;
}

$<HTMLSelectElement>('fileSelect').addEventListener('change', async () => {
  const name = $<HTMLSelectElement>('fileSelect').value;
  if (!name || name === fileName) return;
  if (!(await confirmDiscard())) return renderFileSelect();
  void openFile(name);
});
$('newBtn').addEventListener('click', async () => {
  if (!(await confirmDiscard())) return;
  setDocument(fromPreset('coin'), null, false);
  scheduleRender(autoplay);
});
$('deleteBtn').addEventListener('click', async () => {
  if (!fileName) return;
  const base = soundNameOf(fileName);
  const ok = await showConfirm(
    `會刪除 public/sounds/${base}.sfx.json 與 ${base}.wav，無法復原。用到這個音效的地方會播不出聲音。`,
    {
      title: `刪除音效「${base}」`,
      ok: '刪除',
      danger: true,
    },
  );
  if (!ok) return;
  try {
    await deleteSfxFile(fileName);
    toast(`已刪除 ${base}`);
    await refreshFiles();
    if (files.length) await openFile(files[0].name);
    else setDocument(fromPreset('coin'), null, false);
  } catch (error) {
    toast(`刪除失敗：${(error as Error).message}`, true);
  }
});
$('saveBtn').addEventListener('click', () => void save());
$('exportBtn').addEventListener('click', async () => {
  clearTimeout(renderTimer);
  const out = await renderNow();
  download(
    `${fileName ? soundNameOf(fileName) : 'sound'}.wav`,
    new Blob([encodeWav(out, SAMPLE_RATE)], { type: 'audio/wav' }),
  );
});
addEventListener('beforeunload', (e) => {
  if (isDirty()) e.preventDefault();
});

// ───────── 鍵盤 ─────────

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox'));

addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') {
    e.preventDefault();
    void save();
  } else if (typing(e.target)) return;
  else if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    redo();
  } else if (e.key === ' ' && !mod) {
    e.preventDefault();
    if (playing) stopPlaying();
    else void playSamples();
  }
});

addEventListener('resize', () => {
  drawWave();
  drawEnv();
  drawPitch();
});

// ───────── 啟動 ─────────

await refreshFiles();
const wanted = new URLSearchParams(location.search).get('file');
const last = storage.get(LAST_FILE_KEY);
const start = [wanted && fileNameOf(wanted), last].find((n) => n && files.some((f) => f.name === n)) ?? files[0]?.name;
if (start) await openFile(start);
else setDocument(fromPreset('coin'), null, false);

// 除錯用：在瀏覽器主控台可以用 seEditor.sfx 查看狀態（自動測試也用它）
(window as unknown as { seEditor: unknown }).seEditor = {
  get sfx() {
    return sfx;
  },
  get samples() {
    return samples;
  },
  get file() {
    return fileName;
  },
  get dirty() {
    return isDirty();
  },
  render: renderNow,
  save,
};
