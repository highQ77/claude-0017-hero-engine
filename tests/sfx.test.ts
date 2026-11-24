import { describe, expect, test } from 'vitest';
import {
  LAYER_PARAMS,
  MASTER_PARAMS,
  MAX_DURATION,
  PRESETS,
  defaultSfx,
  downsample,
  fromPreset,
  mutateSfx,
  parseSfx,
  randomSfx,
  seededRng,
  sfxDuration,
  stringifySfx,
} from '../src/editors/se-editor/sfx';
import { encodeWav, wavInfo } from '../src/editors/se-editor/wav';

/** 每個數字參數都在範圍內 */
function inRange(sfx: ReturnType<typeof defaultSfx>): boolean {
  for (const l of sfx.layers) for (const p of LAYER_PARAMS) if (l[p.key] < p.min || l[p.key] > p.max) return false;
  for (const p of MASTER_PARAMS) if (sfx[p.key] < p.min || sfx[p.key] > p.max) return false;
  return true;
}

describe('音效檔（se-editor）', () => {
  test('存讀：補上預設值、限制範圍、最多 4 層；格式不對時丟出錯誤', () => {
    const s = defaultSfx();
    expect(parseSfx(stringifySfx(s))).toEqual(s);
    const messy = parseSfx({
      layers: [{ freq: 999999, source: '不認識', attack: -1 }, {}, {}, {}, {}, {}],
      volume: 'x',
      normalize: false,
    });
    expect(messy.layers).toHaveLength(4);
    expect(messy.layers[0].freq).toBe(8000);
    expect(messy.layers[0].source).toBe('osc');
    expect(messy.layers[0].attack).toBe(0.001);
    expect(messy.volume).toBe(defaultSfx().volume);
    expect(messy.normalize).toBe(false);
    expect(() => parseSfx('[]')).toThrow(/JSON 物件/);
    expect(() => parseSfx({ layers: [] })).toThrow(/至少一層/);
    expect(() => parseSfx({ format: 'hero-scene', layers: [{}] })).toThrow(/不是音效檔/);
  });

  test('範本、隨機、微調變化：參數都在範圍內；給種子時結果一樣', () => {
    for (const p of PRESETS) {
      const s = fromPreset(p.id, seededRng(1));
      expect(inRange(s), p.id).toBe(true);
      expect(fromPreset(p.id, seededRng(1))).toEqual(s);
    }
    for (let i = 0; i < 30; i++) {
      const r = randomSfx(seededRng(i));
      expect(inRange(r)).toBe(true);
      expect(inRange(mutateSfx(r, 0.5, seededRng(i + 100)))).toBe(true);
    }
  });

  test('微調變化：關著的效果保持關著、音量不變；長度包含回音與殘響、最多 6 秒', () => {
    const s = fromPreset('coin', seededRng(3));
    const m = mutateSfx(s, 0.3, seededRng(4));
    expect(m.echoWet).toBe(0);
    expect(m.reverbWet).toBe(0);
    expect(m.layers[0].volume).toBe(s.layers[0].volume);
    expect(m.layers[1].freq).not.toBe(s.layers[1].freq);
    const base = sfxDuration(s);
    expect(sfxDuration({ ...s, reverbWet: 0.3, reverbDecay: 2 })).toBeCloseTo(base + 2);
    expect(sfxDuration({ ...s, reverbWet: 1, reverbDecay: 5, echoWet: 1, echoFeedback: 0.9, echoTime: 1 })).toBe(
      MAX_DURATION,
    );
  });

  test('後製處理器：預設全部關著；舊的音效檔讀進來也是關著（聲音不變）', () => {
    const d = defaultSfx();
    for (const p of MASTER_PARAMS) if (p.off !== undefined) expect(d[p.key], p.key).toBe(p.off);
    expect([d.reverbType, d.compressor]).toEqual(['convolution', 'off']);
    // 舊格式：只有原本的欄位
    const old = parseSfx({ layers: [{}], distortion: 0.2, echoWet: 0.3, reverbWet: 0.4 });
    for (const p of MASTER_PARAMS)
      if (p.off !== undefined && !['distortion', 'echoWet', 'reverbWet'].includes(p.key))
        expect(old[p.key], p.key).toBe(p.off);
    expect(old.compressor).toBe('off');
    // 選單的值：不認識的用預設值
    const s = parseSfx({ layers: [{}], reverbType: 'jc', compressor: 'multiband' });
    expect([s.reverbType, s.compressor]).toEqual(['jc', 'multiband']);
    const bad = parseSfx({ layers: [{}], reverbType: 'hall', compressor: 'max' });
    expect([bad.reverbType, bad.compressor]).toEqual(['convolution', 'off']);
    // 存讀一樣
    expect(parseSfx(stringifySfx(s))).toEqual(s);
  });

  test('後製處理器：微調變化時關著的保持關著，開著的會變；梳狀濾波的尾巴算進長度', () => {
    for (let i = 0; i < 20; i++) {
      const m = mutateSfx(defaultSfx(), 0.5, seededRng(i));
      for (const p of MASTER_PARAMS) if (p.off !== undefined) expect(m[p.key], p.key).toBe(p.off);
    }
    const on = { ...defaultSfx(), tremoloDepth: 0.5, phaserWet: 0.5 };
    const m = mutateSfx(on, 0.3, seededRng(7));
    expect(m.tremoloDepth).not.toBe(0.5);
    expect(m.phaserWet).not.toBe(0.5);
    const base = defaultSfx();
    expect(sfxDuration({ ...base, combWet: 1, combFreq: 100, combFeedback: 0.9 })).toBeGreaterThan(sfxDuration(base));
  });

  test('降低取樣率：每 N 個樣本只留第一個；1 不變', () => {
    const a = Float32Array.from([1, 2, 3, 4, 5, 6, 7]);
    downsample(a, 3);
    expect([...a]).toEqual([1, 1, 1, 4, 4, 4, 7]);
    const b = Float32Array.from([1, 2, 3]);
    downsample(b, 1);
    expect([...b]).toEqual([1, 2, 3]);
  });

  test('.wav：16 位元單聲道，樣本數、取樣率正確，超過範圍的被截掉', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 2, -2]);
    const wav = encodeWav(samples, 44100);
    expect(wav.length).toBe(44 + 10);
    expect(wavInfo(wav)).toEqual({ sampleRate: 44100, channels: 1, samples: 5 });
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
    expect(() => wavInfo(new Uint8Array(10))).toThrow(/不是 .wav/);
  });
});

test('範本產生的數值都依間隔取整（不會出現 338.1234）', () => {
  for (const p of PRESETS) {
    const s = fromPreset(p.id, seededRng(7));
    for (const l of s.layers)
      for (const q of LAYER_PARAMS)
        expect(Math.abs(l[q.key] / q.step - Math.round(l[q.key] / q.step)), `${p.id}.${q.key}`).toBeLessThan(1e-6);
  }
});
