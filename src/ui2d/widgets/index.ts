/**
 * 進階介面元件：進度條、開關、圖示、提示訊息、視窗、
 * 物品格、冷卻、角標、對話框、虛擬搖桿、小地圖、畫布。
 * （捲動區 UIScrollView 是基礎元件，在 elements.ts；分頁在 widgets2.ts）
 * 浮動說明不是元件，而是任何元件都能用的 tooltip 屬性（由 UI2D 處理）。
 */
import { UIIcon, UIProgressBar, UIToggle } from './basic';
import { UIDialog, UIDialogue } from './dialogue';
import { UIBadge, UICooldown, UISlot } from './game';
import { UIJoystick } from './joystick';
import { UIMinimap } from './minimap';
import { UICanvas } from './canvas';
import { UIToast } from './toast';
import { UIWindow } from './window';

export * from './basic';
export * from './dialogue';
export * from './game';
export * from './joystick';
export * from './minimap';
export * from './canvas';
export * from './toast';
export * from './window';

/** 進階元件（UI2D 會自動註冊） */
export const WIDGET_COMPONENTS = {
  /** 進度條：血條、魔力、經驗值、載入進度 */
  UIProgressBar,
  /** 開關：遊戲設定的切換開關 */
  UIToggle,
  /** 內建向量圖示（名稱見 ICON_NAMES） */
  UIIcon,
  /** 提示訊息：自動淡入淡出（ui.toast('文字')） */
  UIToast,
  /** 視窗：有標題列與關閉鈕，可以拖曳 */
  UIWindow,
  /** 物品格：背包、快捷列，可以拖曳交換 */
  UISlot,
  /** 冷卻遮罩：扇形遮罩與倒數 */
  UICooldown,
  /** 角標：紅點或數字通知 */
  UIBadge,
  /** RPG 對話框：頭像、名字、逐字打字、選項 */
  UIDialogue,
  /**
   * 舊名稱（和 UIDialogue 一樣）
   * @deprecated 請改用 UIDialogue
   */
  UIDialog,
  /** 虛擬搖桿（手機操作） */
  UIJoystick,
  /** 小地圖 */
  UIMinimap,
  /** 畫布：用 Canvas 2D 的 API 自由繪圖 */
  UICanvas,
} as const;
