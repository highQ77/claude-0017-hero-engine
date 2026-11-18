/**
 * 遊戲動作的總表，以及 HUD（ui/scene.xml）、暫停選單、設定視窗的事件處理函式。
 * 快捷列、選單、鍵盤都用同一份動作表，行為保持一致。
 */
import type { AntialiasMode } from '@engine/postfx';
import type { UICooldown, UIHandler, UIWindow } from '@engine/ui2d';
import { audio, engine, ui } from './engine';
import { explodePlayer, jumpAll, toggleCamera, toggleDebug, toggleMusic } from './gameplay';
import { introChoice, toggleFps } from './hud';
import { nextLevel } from './levels';
import { screens } from './screens';
import {
  type POSTFX_PRESETS,
  type SCREEN_EFFECTS,
  applyEffect,
  applyPreset,
  nextEffect,
  nextPreset,
  setAntialias,
  setRain,
  setRainAmount,
  updateAntialiasInfo,
} from './visuals';

/** 所有遊戲動作：快捷列、選單、鍵盤（controls.ts）共用 */
export const actions = {
  jump: jumpAll,
  /** 切換場景（快捷列的冷卻避免連續切換） */
  scene: () => {
    const cd = ui.get<UICooldown>('sceneCd');
    if (cd && !cd.ready) return;
    cd?.start(1.5);
    nextLevel();
  },
  explode: () => {
    if (!explodePlayer()) ui.toast('這個場景沒有方塊（按 N 回到環繞軌道）', { icon: 'info', duration: 1.6 });
  },
  effect: nextEffect,
  postfx: nextPreset,
  debug: toggleDebug,
  camera: toggleCamera,
  music: toggleMusic,
  // XML 管理器：打開其他介面檔
  title: () => void screens.open('title'),
  inventory: () => void screens.open('inventory'),
  leaderboard: () => void screens.open('leaderboard'),
  dialogue: () => void screens.open('dialogue'),
  mobile: () => void screens.open('mobile'),
  settings: () => void screens.open('settings'),
} satisfies Record<string, () => void>;

export type ActionName = keyof typeof actions;

/** 選單「遊戲」分頁的快速動作（由 scene.xml 裡 UIList 的樣板產生按鈕） */
const MENU_ITEMS: { label: string; action: ActionName }[] = [
  { label: '切換場景', action: 'scene' },
  { label: '炸掉方塊', action: 'explode' },
  { label: '碰撞形狀', action: 'debug' },
  { label: '標題畫面', action: 'title' },
  { label: '背包', action: 'inventory' },
  { label: '排行榜', action: 'leaderboard' },
  { label: '劇情對話', action: 'dialogue' },
  { label: '手機版面', action: 'mobile' },
  { label: '設定視窗', action: 'settings' },
];

/** 快捷列：物品格的 id → 動作 */
const HOTBAR: Record<string, ActionName> = {
  slotJump: 'jump',
  slotScene: 'scene',
  slotExplode: 'explode',
  slotDebug: 'debug',
  slotMusic: 'music',
};

// ───────── 暫停選單 ─────────

let menuOpen = false;

export function setMenuOpen(open: boolean): void {
  menuOpen = open;
  ui.require('menu').visible = open;
  if (open) {
    ui.get<UIWindow>('menuWindow')?.open(); // 視窗按 ✕ 關閉後會隱藏自己：打開選單時再顯示
    updateAntialiasInfo(); // 自動模式可能因動態解析度換了方式
    engine.pause();
  } else engine.resume();
}

export const isMenuOpen = () => menuOpen;

export function installMenu(): void {
  ui.setItems('menuList', MENU_ITEMS);
  const handlers: Record<string, UIHandler> = {
    toggleMenu: () => setMenuOpen(!menuOpen),
    closeMenu: () => setMenuOpen(false),
    toggleFps,
    introChoice: (e) => introChoice(e.value),
    hotbar: (e) => {
      const action = HOTBAR[e.target.id ?? ''];
      if (action) actions[action]();
    },
    // 選單項目：先關閉選單（恢復遊戲），再執行動作
    menuAction: (e) => {
      setMenuOpen(false);
      actions[(e.item as (typeof MENU_ITEMS)[number]).action]();
    },
    // 聲音
    setMusic: (e) => audio.setMuted('music', !e.checked),
    setMusicVolume: (e) => audio.setVolume('music', (e.value as number) / 100),
    // 畫面（選單和設定視窗共用）
    setPostfx: (e) => applyPreset(e.value as (typeof POSTFX_PRESETS)[number]),
    setEffect: (e) => applyEffect(e.value as (typeof SCREEN_EFFECTS)[number]),
    setRain: (e) => setRain(!!e.checked),
    setRainAmount: (e) => setRainAmount(e.value as number),
    setAntialias: (e) => setAntialias(e.value as AntialiasMode),
    // 遊戲速度（暫停時改：恢復後才看得出差別）
    setSpeed: (e) => (engine.time.timeScale = e.value as number),
  };
  ui.setHandlers(handlers);
}
