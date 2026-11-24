/**
 * 用 Tone.js 把音效檔「離線算成」聲音（Tone.Offline）：預覽播放、存成 .wav 都用同一份結果，
 * 所以編輯器裡聽到的就是遊戲裡播放的 .wav。
 *
 * 每一層：聲音來源（振盪器／雜訊／FM，音高可以滑音、加顫音）→ 濾波器（可以掃頻）→ 音量包絡 → 這層的音量
 * 整體（關著的處理器不接進去）：
 *   移調 → 頻率位移 → 三段等化 → 失真 → 切比雪夫 → 位元壓縮 → 音量顫抖 → 顫音 → 自動濾波 → 自動哇音 → 移相
 *   → 梳狀濾波 → 噪音閘門 → 回音 → 殘響 → 壓縮（一般／多頻段）→ 限制器 → 整體音量
 * 算完之後：降低取樣率 → 調到接近滿格 → 結尾很短的淡出（避免爆音）。
 *
 * 輸出是單聲道（遊戲的 3D 音效要單聲道才能定位）。Tone.js 有些效果是立體聲的：
 * 音量顫抖預設左右相位相反，合成單聲道時起伏會抵消，所以 spread 設成 0（左右同相位）。
 * 用 AudioWorklet 的效果（BitCrusher、FeedbackCombFilter）在離線算圖時不好用：位元壓縮用波形塑形、
 * 降低取樣率在算完之後處理、梳狀濾波用很短的回音（延遲 = 1 / 音高）做。
 */
import * as Tone from 'tone';
import { type SfxData, type SfxLayer, downsample, sfxDuration } from './sfx';

/** 合成的取樣率 */
export const SAMPLE_RATE = 44100;
/** 調到滿格時的最大值（-1 dBFS 左右，留一點空間） */
const PEAK = 0.89;

const dbToGain = (db: number) => 10 ** (db / 20);

/** 建立一層聲音，接到 out；回傳在 when 秒開始播放的函式 */
function buildLayer(l: SfxLayer, out: Tone.ToneAudioNode): void {
  const t0 = l.delay;
  const len = l.attack + l.decay + l.hold;
  const end = t0 + len + l.release;

  // 聲音來源
  let source: Tone.Oscillator | Tone.FMOscillator | Tone.Noise;
  let frequency: Tone.Signal<'frequency'> | null = null;
  let detune: Tone.Signal<'cents'> | null = null;
  if (l.source === 'noise') source = new Tone.Noise(l.noise);
  else if (l.source === 'fm') {
    const fm = new Tone.FMOscillator({
      frequency: l.freq,
      type: l.wave,
      modulationType: 'sine',
      harmonicity: l.fmHarmonicity,
      modulationIndex: l.fmIndex,
    });
    frequency = fm.frequency;
    detune = fm.detune;
    source = fm;
  } else {
    const osc = new Tone.Oscillator(l.freq, l.wave);
    frequency = osc.frequency;
    detune = osc.detune;
    source = osc;
  }
  // 滑音：起始音高 → 結束音高（指數變化，聽起來比較自然）
  if (frequency) {
    frequency.setValueAtTime(l.freq, t0);
    if (l.freqEnd !== l.freq) frequency.exponentialRampToValueAtTime(l.freqEnd, t0 + Math.max(0.001, len + l.release));
  }
  // 顫音：低頻振盪接到音分
  if (detune && l.vibratoRate > 0 && l.vibratoDepth > 0) {
    const lfo = new Tone.LFO(l.vibratoRate, -l.vibratoDepth, l.vibratoDepth);
    lfo.connect(detune);
    lfo.start(t0).stop(end);
  }

  // 濾波器（可以掃頻）
  let node: Tone.ToneAudioNode = source;
  if (l.filter !== 'none') {
    const filter = new Tone.Filter({ type: l.filter, frequency: l.cutoff, Q: l.q });
    filter.frequency.setValueAtTime(l.cutoff, t0);
    if (l.cutoffEnd !== l.cutoff)
      filter.frequency.exponentialRampToValueAtTime(l.cutoffEnd, t0 + Math.max(0.001, len + l.release));
    node.connect(filter);
    node = filter;
  }

  // 音量包絡 → 這層的音量
  const env = new Tone.AmplitudeEnvelope({
    attack: l.attack,
    decay: l.decay,
    sustain: l.sustain,
    release: l.release,
    attackCurve: 'linear',
    releaseCurve: 'exponential',
  });
  const gain = new Tone.Gain(dbToGain(l.volume));
  node.chain(env, gain, out);
  source.start(t0).stop(end + 0.01);
  env.triggerAttackRelease(len, t0);
}

/** 整體效果鏈：回傳要接進去的節點 */
async function buildMaster(sfx: SfxData): Promise<Tone.ToneAudioNode> {
  const bus = new Tone.Gain(1);
  let node: Tone.ToneAudioNode = bus;
  const then = (next: Tone.ToneAudioNode) => {
    node.connect(next);
    node = next;
  };

  // 音高
  if (sfx.pitchShift !== 0) then(new Tone.PitchShift({ pitch: sfx.pitchShift, windowSize: 0.05 }));
  if (sfx.freqShift !== 0) then(new Tone.FrequencyShifter(sfx.freqShift));

  // 等化
  if (sfx.eqLow !== 0 || sfx.eqMid !== 0 || sfx.eqHigh !== 0)
    then(new Tone.EQ3({ low: sfx.eqLow, mid: sfx.eqMid, high: sfx.eqHigh, lowFrequency: 400, highFrequency: 2500 }));

  // 音色
  if (sfx.distortion > 0) then(new Tone.Distortion({ distortion: sfx.distortion, oversample: '2x' }));
  if (sfx.chebyWet > 0) then(new Tone.Chebyshev({ order: sfx.chebyOrder, wet: sfx.chebyWet, oversample: '2x' }));
  // 位元壓縮：用波形塑形把音量量化成 2^bits 階（不用 AudioWorklet，離線算也可以）
  if (sfx.bits < 16) {
    const steps = 2 ** (sfx.bits - 1);
    then(new Tone.WaveShaper((x) => Math.round(x * steps) / steps, 4096));
  }

  // 調變
  if (sfx.tremoloDepth > 0)
    // spread 0：左右同相位（合成單聲道時不會抵消）
    then(new Tone.Tremolo({ frequency: sfx.tremoloRate, depth: sfx.tremoloDepth, spread: 0 }).start(0));
  if (sfx.vibratoDepth > 0) then(new Tone.Vibrato({ frequency: sfx.vibratoRate, depth: sfx.vibratoDepth }));
  if (sfx.autoFilterDepth > 0)
    then(
      new Tone.AutoFilter({
        frequency: sfx.autoFilterRate,
        depth: sfx.autoFilterDepth,
        baseFrequency: sfx.autoFilterBase,
        octaves: 3,
      }).start(0),
    );
  if (sfx.autoWahWet > 0) then(new Tone.AutoWah({ baseFrequency: sfx.autoWahBase, octaves: 4, wet: sfx.autoWahWet }));
  if (sfx.phaserWet > 0)
    then(
      new Tone.Phaser({
        frequency: sfx.phaserRate,
        octaves: sfx.phaserOctaves,
        baseFrequency: 350,
        wet: sfx.phaserWet,
      }),
    );
  if (sfx.combWet > 0)
    // 梳狀濾波：延遲 1 / 音高 秒的回音，回饋越大共鳴越久
    then(
      new Tone.FeedbackDelay({
        delayTime: 1 / sfx.combFreq,
        feedback: sfx.combFeedback,
        wet: sfx.combWet,
        maxDelay: 0.05,
      }),
    );

  // 噪音閘門（放在回音、殘響之前：只清掉聲音本身的尾巴，空間感保留）
  if (sfx.gateThreshold > -100) then(new Tone.Gate({ threshold: sfx.gateThreshold, smoothing: 0.01 }));

  // 空間
  if (sfx.echoWet > 0)
    then(
      new Tone.FeedbackDelay({ delayTime: sfx.echoTime, feedback: sfx.echoFeedback, wet: sfx.echoWet, maxDelay: 1 }),
    );
  if (sfx.reverbWet > 0) {
    // Freeverb、JCReverb 用房間大小：依殘響長度換算（0.1 秒 → 0.5，5 秒 → 0.98）
    const room = 0.5 + 0.48 * Math.min(1, Math.max(0, (sfx.reverbDecay - 0.1) / 4.9));
    if (sfx.reverbType === 'freeverb') then(new Tone.Freeverb({ roomSize: room, dampening: 3000, wet: sfx.reverbWet }));
    else if (sfx.reverbType === 'jc') then(new Tone.JCReverb({ roomSize: room, wet: sfx.reverbWet }));
    else {
      const reverb = new Tone.Reverb({ decay: sfx.reverbDecay, wet: sfx.reverbWet, preDelay: 0.01 });
      await reverb.generate(); // 殘響的脈衝響應要先算好
      then(reverb);
    }
  }

  // 動態
  if (sfx.compressor === 'single')
    then(new Tone.Compressor({ threshold: sfx.compThreshold, ratio: sfx.compRatio, attack: 0.003, release: 0.1 }));
  else if (sfx.compressor === 'multiband') {
    const band = { threshold: sfx.compThreshold, ratio: sfx.compRatio, attack: 0.003, release: 0.1 };
    then(new Tone.MultibandCompressor({ lowFrequency: 250, highFrequency: 2500, low: band, mid: band, high: band }));
  }
  if (sfx.limiterThreshold < 0) then(new Tone.Limiter(sfx.limiterThreshold));

  then(new Tone.Gain(dbToGain(sfx.volume)));
  node.toDestination();
  return bus;
}

/**
 * 把音效算成聲音樣本（單聲道，SAMPLE_RATE）。
 * 需要瀏覽器的 Web Audio（OfflineAudioContext）。
 */
export async function renderSfx(sfx: SfxData): Promise<Float32Array<ArrayBuffer>> {
  const duration = sfxDuration(sfx);
  const buffer = await Tone.Offline(
    async () => {
      const bus = await buildMaster(sfx);
      for (const l of sfx.layers) if (l.enabled) buildLayer(l, bus);
    },
    duration,
    1,
    SAMPLE_RATE,
  );
  const samples = Float32Array.from(buffer.getChannelData(0));
  downsample(samples, sfx.downsample);
  // 調到接近滿格
  if (sfx.normalize) {
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    if (peak > 1e-4) {
      const k = PEAK / peak;
      for (let i = 0; i < samples.length; i++) samples[i] *= k;
    }
  }
  // 結尾 5ms 淡出（避免最後被截斷時爆音）
  const fade = Math.min(samples.length, Math.round(SAMPLE_RATE * 0.005));
  for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
  return samples;
}

/** 樣本的最大音量（0..1；介面顯示用） */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak;
}
