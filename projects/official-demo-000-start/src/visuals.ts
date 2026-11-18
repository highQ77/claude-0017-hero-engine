/**
 * 畫面設定：後製風格（F 鍵）、全螢幕效果（V 鍵）、雨滴玻璃、反鋸齒。
 * 選單、設定視窗、鍵盤都呼叫這裡，介面上的選項保持一致。
 */
import type { AntialiasMode } from '@engine/postfx';
import type { CustomEffect } from '@engine/shaders';
import type { UILabel, UISelect, UIToggle } from '@engine/ui2d';
import { postfx, ui } from './engine';
import { shaders } from './fx';
import { state } from './state';

export const POSTFX_PRESETS = ['標準', '電影感', '關閉'] as const;
export const SCREEN_EFFECTS = ['無', '色差', '像素化'] as const;
type Preset = (typeof POSTFX_PRESETS)[number];
type ScreenEffect = (typeof SCREEN_EFFECTS)[number];

const AA_LABELS: Record<AntialiasMode, string> = {
  auto: '自動',
  msaa: 'MSAA',
  smaa: 'SMAA',
  fxaa: 'FXAA',
  none: '關閉',
};

let preset: Preset = '標準';
let effectName: ScreenEffect = '無';
let effect: CustomEffect | null = null;
/** 雨滴玻璃（雨落窗效果）：和畫面效果分開，可以一起開 */
let rain: CustomEffect | null = null;
let rainAmount = 0.7;

/** 後製風格 */
export function applyPreset(name: Preset): void {
  preset = name;
  const s = postfx.settings;
  const off = name === '關閉';
  const film = name === '電影感';
  s.toneMapping = off ? 'none' : 'aces';
  s.exposure = film ? 0.95 : 1.05;
  Object.assign(s.bloom, { enabled: !off, strength: film ? 0.45 : 0.55, threshold: 0.8, radius: 0.5 });
  Object.assign(s.vignette, { enabled: !off, darkness: film ? 1.4 : 1.05 });
  // 標準：稍微提高對比與飽和度；電影感：偏暖、低飽和，加上景深（對焦在方塊）與底片顆粒
  Object.assign(s.color, {
    enabled: !off,
    contrast: film ? 1.12 : 1.06,
    saturation: film ? 0.85 : 1.1,
    tint: film ? 0xffeedd : 0xffffff,
  });
  s.dof.enabled = film;
  s.dof.focusOn = state.player;
  s.film.enabled = film;
  ui.get<UILabel>('postfx')?.setText(`後製：${name}`);
  ui.setRadioValue('postfx', name);
  updateAntialiasInfo();
}

export const nextPreset = () =>
  applyPreset(POSTFX_PRESETS[(POSTFX_PRESETS.indexOf(preset) + 1) % POSTFX_PRESETS.length]);

/** 全螢幕效果 */
export function applyEffect(name: ScreenEffect): void {
  effectName = name;
  if (effect) {
    postfx.removePass(effect);
    effect.dispose();
    effect = null;
  }
  if (name === '色差') effect = shaders.createEffect('chromaticAberration', { amount: 0.006 });
  if (name === '像素化') effect = shaders.createEffect('pixelate', { pixelSize: 5 });
  if (effect) postfx.addPass(effect, 'display'); // 加在雨滴之後：效果套在整片玻璃上
  ui.get<UILabel>('effect')?.setText(`畫面效果：${name}`);
  const select = ui.get<UISelect>('effectSelect');
  if (select) select.value = name;
}

export const nextEffect = () =>
  applyEffect(SCREEN_EFFECTS[(SCREEN_EFFECTS.indexOf(effectName) + 1) % SCREEN_EFFECTS.length]);

/** 雨滴玻璃 */
export function setRain(on: boolean): void {
  if (on && !rain) {
    rain = shaders.createEffect('rainOnWindow', { amount: rainAmount });
    postfx.addPass(rain, 'display');
    // 雨要在畫面效果前面：畫面效果重新加到最後
    if (effect) {
      postfx.removePass(effect);
      postfx.addPass(effect, 'display');
    }
  } else if (!on && rain) {
    postfx.removePass(rain);
    rain.dispose();
    rain = null;
  }
  const toggle = ui.get<UIToggle>('rainToggle');
  if (toggle && toggle.checked !== on) toggle.checked = on;
}

export function setRainAmount(amount: number): void {
  rainAmount = amount;
  if (rain) rain.uniforms.amount.value = amount;
}

/** 反鋸齒：選單與設定視窗的下拉選單保持一致 */
export function setAntialias(mode: AntialiasMode): void {
  postfx.settings.antialias = mode;
  for (const id of ['aaSelect', 'settingsAa']) {
    const select = ui.get<UISelect>(id);
    if (select && select.value !== mode) select.value = mode;
  }
  updateAntialiasInfo();
}

export const antialias = (): AntialiasMode => postfx.settings.antialias;

/** 顯示實際使用的反鋸齒（自動會依像素比選擇；動態解析度改變像素比時也可能換） */
export function updateAntialiasInfo(): void {
  const mode = postfx.settings.antialias;
  const used = postfx.resolvedAntialias;
  let text = `目前：${AA_LABELS[used]}`;
  if (mode === 'auto') text += used === 'fxaa' ? '（高解析度螢幕，MSAA 太耗效能）' : '（一般螢幕）';
  if (preset === '關閉' && used === 'none') text += '（後製關閉時仍有瀏覽器內建的 MSAA）';
  ui.get<UILabel>('aaInfo')?.setText(text);
}

/** 換場景後：景深要對焦在新的方塊 */
export function refocus(): void {
  postfx.settings.dof.focusOn = state.player;
}
