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
  UIProgressBar,
  UIToggle,
  UIIcon,
  UIToast,
  UIWindow,
  UISlot,
  UICooldown,
  UIBadge,
  UIDialogue,
  /** @deprecated 舊名稱，請改用 UIDialogue */
  UIDialog,
  UIJoystick,
  UIMinimap,
  UICanvas,
} as const;
