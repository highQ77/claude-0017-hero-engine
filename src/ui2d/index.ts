import { cachedUIXml, clearUIXmlCache, fetchUIXml, hasBundledUIXml, loadUIXml, registerUIXml } from './xmlSources';
import { parseXml } from './xml';
import { loadLayoutEngine, normalizePath } from './UI2D';
import { parseDim, parseEdges } from './elements';
import { drawNineSlice, parseShadow } from './UIPainter';
import { parseRichText } from './richtext';
import { drawIcon } from './icons';
import { roundRectPath } from './draw';
import { createCanvasMeasurer, createFixedMeasurer, fontString, tokenize, wrapText } from './text';
import { isWebKit } from './UITexture';
export { UI2D, DEFAULT_BREAKPOINTS } from './UI2D';
export type { UI2DOptions } from './UI2D';
export {
  UIElement,
  UIRoot,
  UILayout,
  UIComponent,
  UILabel,
  UIImage,
  UIButton,
  UIList,
  UIScrollView,
  UICheckBox,
  UIRadioButton,
  UISelect,
  UISlider,
  UICheckIndicator,
  BUILTIN_COMPONENTS,
} from './elements';
export type {
  Attrs,
  UIEvent,
  UIHandler,
  UIContext,
  Rect,
  ImageLoader,
  ImageSize,
  ListType,
  ScrollAxis,
  ComponentConstructor,
  SelectOption,
} from './elements';
export { XmlError, COMMENT_TAG } from './xml';
export type { XmlNode, ParseOptions } from './xml';

export type { FontSpec, TextMetrics, MeasureTextWidth } from './text';
export { UIPainter } from './UIPainter';
export type { PaintState, Context2D, ImageSourceLookup } from './UIPainter';
export { CanvasUIRenderer } from './CanvasRenderer';
export type { UIRenderer, ScreenFader } from './CanvasRenderer';
export { UITextureRenderer, type UITextureCopier } from './UITexture';
export type { UICanvasMode, UIRenderStats } from './UITexture';
export { UIPlugin, UIKey, UI_OVERLAY_ORDER } from './UIPlugin';
export type { UIPluginOptions } from './UIPlugin';
export {
  UIProgressBar,
  UIToggle,
  UIIcon,
  UIToast,
  UIWindow,
  UISlot,
  UICooldown,
  UIBadge,
  UIDialogue,
  UIDialog,
  UIJoystick,
  UIMinimap,
  UICanvas,
  UIWeb,
  WIDGET_COMPONENTS,
  RARITY_COLORS,
} from './widgets';
export type { ToastOptions, DialogChoice, MinimapMarker as MinimapPoint } from './widgets';
export type { WebGL2DRenderingContext, WebGL2DOptions, WebGL2DHiDPIOptions, ShaderFilter } from './widgets';
export { ICONS, ICON_NAMES } from './icons';

export type { OverlayPainter, PointerCapture } from './elements';
export { MinimapPlugin, MinimapMarkerComponent as MinimapMarker } from './MinimapPlugin';
export type { MinimapMarkerData, MinimapPluginOptions } from './MinimapPlugin';
export {
  UIStackView,
  UITabs,
  UITab,
  UITable,
  UIRichText,
  UIFpsMeter,
  WIDGET2_COMPONENTS,
} from './widgets2';
export type { TableColumn, TableRow } from './widgets2';
export { UIScreenManager } from './UIScreens';
export { SceneTransition, DEFAULT_LOADING_XML } from './SceneTransition';
export type {
  GoOptions,
  SceneDefinition,
  SceneTransitionOptions,
  SceneTransitionProgress,
  SceneTransitionChange,
} from './SceneTransition';
export type { ScreenSource, ScreenOptions, ScreenChange } from './UIScreens';

// ───────── 小工具函式（依用途分類）─────────

/** 介面檔（XML）：讀取、快取、提供內容、解析 */
export const uiXml = {
  /** 讀取介面 XML（有快取；打包時會內嵌） */
  load: loadUIXml,
  /** 從網路讀取介面 XML（不經過快取） */
  fetch: fetchUIXml,
  /** 已經讀過的介面 XML（沒有時是 undefined） */
  cached: cachedUIXml,
  /** 清除介面 XML 的快取 */
  clearCache: clearUIXmlCache,
  /** 提供介面 XML 的內容（例如打包時內嵌、測試用） */
  register: registerUIXml,
  /** 是否有內嵌的介面 XML */
  hasBundled: hasBundledUIXml,
  /** 把 XML 文字解析成節點 */
  parse: parseXml,
  /** 整理路徑裡的 ./ 與 ../ */
  normalizePath: normalizePath,
} as const;

/** 解析介面屬性：尺寸、上右下左、陰影、多樣式文字 */
export const parse = {
  /** 解析尺寸（數字、百分比、auto、fit） */
  dim: parseDim,
  /** 解析上右下左（例如 padding="8 16"） */
  edges: parseEdges,
  /** 解析陰影（shadow 屬性） */
  shadow: parseShadow,
  /** 解析多樣式文字標記（[b]、[color=…]） */
  richText: parseRichText,
} as const;

/** 2D 繪圖：圖示、九宮格、圓角矩形、文字換行 */
export const draw = {
  /** 在 2D 畫布上畫內建圖示 */
  icon: drawIcon,
  /** 九宮格縮放圖片 */
  nineSlice: drawNineSlice,
  /** 圓角矩形路徑 */
  roundRect: roundRectPath,
  /** CSS 字型字串 */
  font: fontString,
  /** 文字自動換行 */
  wrapText: wrapText,
  /** 把文字切成可以換行的單位 */
  tokenize: tokenize,
} as const;

/** 文字量測：用畫布量（瀏覽器）或固定字寬（測試） */
export const measure = {
  /** 用 2D 畫布量文字寬度（瀏覽器） */
  canvas: createCanvasMeasurer,
  /** 固定字寬的量測（測試、沒有畫布時） */
  fixed: createFixedMeasurer,
} as const;

/** 載入：物理引擎、排版引擎、內建字型（外掛建立時會自動載入）（ui2d 模組的部分；總入口 hero.load 有全部） */
export const load = {
  /** 載入排版引擎 Yoga（UI2D.create() 會自動載入） */
  layoutEngine: loadLayoutEngine,
} as const;

/** 執行環境：瀏覽器種類 */
export const env = {
  /** 是不是 Safari（WebKit） */
  isWebKit: isWebKit,
} as const;
