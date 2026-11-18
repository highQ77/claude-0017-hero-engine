/**
 * 後製調控面板：介面在 public/ui/scene.xml 的 fxPanel，這裡把控制項接到 postfx.settings。
 *
 * - 場景載入後呼叫 syncFxPanel()：記下場景檔的設定（給「還原」用），並把目前的值顯示在控制項上
 * - 控制項改動時寫回 postfx.settings，下一幀生效
 * - 要加新的滑桿：在介面檔加一個 UISlider（onInput="fx"），再在下面的 SLIDERS 加一行對應
 */
import { Color } from '@engine/math';
import type { PostFxSettings } from '@engine/postfx';
import type { UICheckBox, UILabel, UISelect, UISlider } from '@engine/ui2d';
import { DUST_DEFAULTS, dustSettings } from './dust';
import { engine, postfx, ui } from './engine';

type S = PostFxSettings;

/** 滑桿 id → 讀取、寫入 postfx.settings 的哪個欄位 */
const SLIDERS: Record<string, [get: (s: S) => number, set: (s: S, v: number) => void]> = {
  exposure: [(s) => s.exposure, (s, v) => (s.exposure = v)],
  bloomStrength: [(s) => s.bloom.strength, (s, v) => (s.bloom.strength = v)],
  bloomRadius: [(s) => s.bloom.radius, (s, v) => (s.bloom.radius = v)],
  bloomThreshold: [(s) => s.bloom.threshold, (s, v) => (s.bloom.threshold = v)],
  brightness: [(s) => s.color.brightness, (s, v) => (s.color.brightness = v)],
  contrast: [(s) => s.color.contrast, (s, v) => (s.color.contrast = v)],
  saturation: [(s) => s.color.saturation, (s, v) => (s.color.saturation = v)],
  vignetteOffset: [(s) => s.vignette.offset, (s, v) => (s.vignette.offset = v)],
  vignetteDarkness: [(s) => s.vignette.darkness, (s, v) => (s.vignette.darkness = v)],
  filmIntensity: [(s) => s.film.intensity, (s, v) => (s.film.intensity = v)],
  dofFocus: [(s) => s.dof.focus, (s, v) => (s.dof.focus = v)],
  dofAperture: [(s) => s.dof.aperture, (s, v) => (s.dof.aperture = v)],
  dofMaxBlur: [(s) => s.dof.maxBlur, (s, v) => (s.dof.maxBlur = v)],
  aoRadius: [(s) => s.ao.radius, (s, v) => (s.ao.radius = v)],
  aoIntensity: [(s) => s.ao.intensity, (s, v) => (s.ao.intensity = v)],
};

/** 開關 id → 哪個效果的 enabled（黑白是勾選框，另外處理） */
const TOGGLES = ['bloom', 'color', 'vignette', 'film', 'dof', 'ao'] as const;

/** 場景檔的設定（「還原」用）；場景載入時記下 */
let snapshot: S | null = null;

const copySettings = (s: S): S => ({
  ...s,
  bloom: { ...s.bloom },
  ao: { ...s.ao },
  dof: { ...s.dof },
  film: { ...s.film },
  vignette: { ...s.vignette },
  color: { ...s.color },
});

// ───────── 色偏：顏色 ↔ 色相＋濃度 ─────────
// 色偏 = 白色往純色（該色相、最飽和）靠近「濃度」那麼多；濃度 0 = 白色 = 不偏色

const tintColor = new Color();

function tintFromSliders(hue: number, amount: number): Color {
  const pure = new Color().setHSL(hue / 360, 1, 0.5);
  return tintColor.set(0xffffff).lerp(pure, amount);
}

function slidersFromTint(tint: S['color']['tint']): { hue: number; amount: number } {
  const c = new Color(tint);
  const max = Math.max(c.r, c.g, c.b) || 1;
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return { hue: Math.round(hsl.h * 360), amount: 1 - Math.min(c.r, c.g, c.b) / max };
}

function showTint(): void {
  ui.get<UILabel>('tintHex')?.setText(`色偏顏色：#${new Color(postfx.settings.color.tint).getHexString()}`);
}

// ───────── 控制項 ↔ 設定 ─────────

/** postfx.settings → 控制項 */
function syncControls(): void {
  const s = postfx.settings;
  ui.require<UISelect>('toneMapping').value = s.toneMapping;
  ui.require<UISelect>('antialias').value = s.antialias;
  for (const [id, [get]] of Object.entries(SLIDERS)) ui.require<UISlider>(id).value = get(s);
  for (const id of TOGGLES) ui.require<UICheckBox>(id).checked = s[id].enabled;
  ui.require<UICheckBox>('grayscale').checked = s.film.grayscale;
  const { hue, amount } = slidersFromTint(s.color.tint);
  ui.require<UISlider>('tintHue').value = hue;
  ui.require<UISlider>('tintAmount').value = amount;
  showTint();
  syncDust();
}

// ───────── 沙塵（粒子，不是後製；dust.ts 的 dustSettings） ─────────

function syncDust(): void {
  ui.require<UICheckBox>('dust').checked = dustSettings.enabled;
  ui.require<UISlider>('dustDensity').value = dustSettings.density;
  ui.require<UISlider>('dustSize').value = dustSettings.size;
  ui.require<UISlider>('dustWind').value = dustSettings.wind;
}

function applyDust(): void {
  dustSettings.enabled = ui.require<UICheckBox>('dust').checked;
  dustSettings.density = ui.require<UISlider>('dustDensity').value;
  dustSettings.size = ui.require<UISlider>('dustSize').value;
  dustSettings.wind = ui.require<UISlider>('dustWind').value;
}

/** 控制項 → postfx.settings（色偏只在動到色偏滑桿時才改，避免換算誤差改掉場景檔原本的顏色） */
function applyControls(tintChanged: boolean): void {
  const s = postfx.settings;
  s.toneMapping = ui.require<UISelect>('toneMapping').value as S['toneMapping'];
  s.antialias = ui.require<UISelect>('antialias').value as S['antialias'];
  for (const [id, [, set]] of Object.entries(SLIDERS)) set(s, ui.require<UISlider>(id).value);
  for (const id of TOGGLES) s[id].enabled = ui.require<UICheckBox>(id).checked;
  s.film.grayscale = ui.require<UICheckBox>('grayscale').checked;
  if (tintChanged) {
    s.color.tint = `#${tintFromSliders(
      ui.require<UISlider>('tintHue').value,
      ui.require<UISlider>('tintAmount').value,
    ).getHexString()}`;
    showTint();
  }
}

/** 場景載入後呼叫：記下場景檔的設定，並更新控制項 */
export function syncFxPanel(): void {
  snapshot = copySettings(postfx.settings);
  syncControls();
}

function setPanelOpen(open: boolean): void {
  ui.require('fxPanel').visible = open;
  ui.require('fxShow').visible = !open;
}

ui.setHandlers({
  fx: (e) => {
    const id = (e.target as { id?: string | null }).id ?? '';
    applyControls(id === 'tintHue' || id === 'tintAmount');
  },
  fxReset: () => {
    if (!snapshot) return;
    // 寫進原本的物件（不換掉 bloom、color… 這些物件本身：場景卸載時要恢復到同一個物件上）
    const target = postfx.settings as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(snapshot)) {
      if (v !== null && typeof v === 'object') Object.assign(target[k] as object, v);
      else target[k] = v;
    }
    Object.assign(dustSettings, DUST_DEFAULTS);
    syncControls();
  },
  dust: () => applyDust(),
  fxHide: () => setPanelOpen(false),
  fxShow: () => setPanelOpen(true),
});

// 目前實際執行的處理步驟（開關效果時會變）
engine.timers.every(0.5, () => {
  ui.get<UILabel>('fxPasses')?.setText(`處理步驟：${postfx.passNames.join(' → ')}`);
});
