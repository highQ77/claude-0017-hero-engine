/**
 * 屬性面板的欄位說明：每種元件有哪些欄位、用什麼輸入方式。
 * 值一律是「場景檔裡的寫法」（角度是度、顏色是 '#rrggbb'）；預設值從元件的 create() 換算，不另外寫一份。
 * 沒有欄位說明的元件（例如其他外掛登記的）用 JSON 編輯。
 */
import { Color } from 'three';
import type { ComponentType } from '../../ecs';
import { Transform } from '../../scene';
import { Camera, CameraLayers, CameraViewport, Light, RenderLayer } from '../../render';
import { Model } from '../../assets';
import { Animator } from '../../animation';
import { Collider, RigidBody } from '../../physics/components';
import { ParticleEmitter } from '../../particles';
import { AudioSource } from '../../audio';
import { Text3D } from '../../text3d';
import { UIPanel3D } from '../../ui3d';

export type FieldKind =
  | 'number'
  | 'angle'
  | 'color'
  | 'bool'
  | 'select'
  | 'vec3'
  | 'text'
  | 'bool3'
  /** 固定值或 [最小, 最大]（粒子） */
  | 'range'
  /** 秒數或不停止（null） */
  | 'duration';

/** 文字欄位的建議清單：模型網址、音效網址、模型裡的動畫片段 */
export type SuggestKind = 'models' | 'sounds' | 'clips';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  step?: number;
  min?: number;
  max?: number;
  /** 下拉選單的 [值, 顯示文字] */
  options?: readonly (readonly [string, string])[];
  /** 只在這個條件成立時顯示（傳入目前的元件資料，已補上預設值） */
  when?: (v: Record<string, unknown>) => boolean;
  /** 滑鼠移到標籤上的說明 */
  hint?: string;
  /** 預設值（省略時從元件 create() 換算） */
  default?: unknown;
  /** range 欄位：元件裡是弧度，面板與檔案用度 */
  degrees?: boolean;
  /** 文字欄位：空字串存成 null（例如 Animator 的 play） */
  nullable?: boolean;
  /** 文字欄位的建議清單（例如模型網址、動畫片段名稱）：'models' | 'clips' */
  suggest?: SuggestKind;
  /** 文字欄位的提示 */
  placeholder?: string;
}

export interface ComponentSchema {
  /** 元件名稱（場景檔裡的鍵） */
  name: string;
  /** 顯示名稱 */
  label: string;
  // biome-ignore lint/suspicious/noExplicitAny: 各種元件的型別都不同
  type: ComponentType<any>;
  fields: FieldDef[];
}

const DEG = 180 / Math.PI;
const kindOf =
  (key: string, ...values: string[]) =>
  (v: Record<string, unknown>) =>
    values.includes(v[key] as string);
const kindIs = (...kinds: string[]) => kindOf('kind', ...kinds);

export const SCHEMAS: readonly ComponentSchema[] = [
  {
    name: 'Transform',
    label: '變換',
    type: Transform,
    fields: [
      { key: 'position', label: '位置', kind: 'vec3', step: 0.05, default: [0, 0, 0] },
      { key: 'rotation', label: '旋轉', kind: 'vec3', step: 1, default: [0, 0, 0], hint: '度，依 X、Y、Z 順序' },
      { key: 'scale', label: '縮放', kind: 'vec3', step: 0.05, default: [1, 1, 1] },
    ],
  },
  {
    name: 'Camera',
    label: '攝影機',
    type: Camera,
    fields: [
      {
        key: 'kind',
        label: '種類',
        kind: 'select',
        options: [
          ['perspective', '透視'],
          ['orthographic', '正交'],
        ],
      },
      {
        key: 'fov',
        label: '視角',
        kind: 'number',
        step: 1,
        min: 1,
        max: 179,
        when: kindIs('perspective'),
        hint: '垂直視角（度）',
      },
      { key: 'size', label: '可視半高', kind: 'number', step: 0.1, min: 0.01, when: kindIs('orthographic') },
      { key: 'near', label: '最近', kind: 'number', step: 0.01, min: 0.001 },
      { key: 'far', label: '最遠', kind: 'number', step: 1, min: 0.01 },
      { key: 'zoom', label: '縮放', kind: 'number', step: 0.05, min: 0.01 },
      { key: 'priority', label: '優先度', kind: 'number', step: 1, hint: '有多台攝影機時，最高的負責繪製' },
      { key: 'enabled', label: '啟用', kind: 'bool' },
    ],
  },
  {
    name: 'Light',
    label: '燈光',
    type: Light,
    fields: [
      {
        key: 'kind',
        label: '種類',
        kind: 'select',
        options: [
          ['ambient', '環境光'],
          ['hemisphere', '半球光'],
          ['directional', '平行光'],
          ['point', '點光源'],
          ['spot', '聚光燈'],
        ],
      },
      { key: 'color', label: '顏色', kind: 'color' },
      { key: 'groundColor', label: '地面顏色', kind: 'color', when: kindIs('hemisphere') },
      { key: 'intensity', label: '亮度', kind: 'number', step: 0.05, min: 0 },
      {
        key: 'distance',
        label: '照射距離',
        kind: 'number',
        step: 0.1,
        min: 0,
        when: kindIs('point', 'spot'),
        hint: '0 代表無限',
      },
      { key: 'decay', label: '衰減', kind: 'number', step: 0.1, min: 0, when: kindIs('point', 'spot') },
      { key: 'angle', label: '角度', kind: 'angle', step: 1, min: 0, max: 90, when: kindIs('spot') },
      { key: 'penumbra', label: '邊緣柔和', kind: 'number', step: 0.01, min: 0, max: 1, when: kindIs('spot') },
      { key: 'castShadow', label: '投射陰影', kind: 'bool', when: kindIs('directional', 'point', 'spot') },
      {
        key: 'shadowMapSize',
        label: '陰影解析度',
        kind: 'select',
        options: ['256', '512', '1024', '2048', '4096'].map((v) => [v, v] as const),
        when: (v) => kindIs('directional', 'point', 'spot')(v) && v.castShadow === true,
      },
      {
        key: 'shadowArea',
        label: '陰影範圍',
        kind: 'number',
        step: 1,
        min: 1,
        when: (v) => v.kind === 'directional' && v.castShadow === true,
      },
    ],
  },
  {
    name: 'Model',
    label: '模型',
    type: Model,
    fields: [
      {
        key: 'url',
        label: '網址',
        kind: 'text',
        suggest: 'models',
        placeholder: 'models/tree.glb',
        hint: '相對於專案的 public/',
      },
      { key: 'castShadow', label: '投射陰影', kind: 'bool' },
      { key: 'receiveShadow', label: '接收陰影', kind: 'bool' },
    ],
  },
  {
    name: 'Animator',
    label: '動畫',
    type: Animator,
    fields: [
      {
        key: 'play',
        label: '播放',
        kind: 'text',
        nullable: true,
        suggest: 'clips',
        placeholder: '（不播放）',
        hint: '模型裡的動畫片段名稱',
      },
      { key: 'loop', label: '重複', kind: 'bool' },
      { key: 'speed', label: '速度', kind: 'number', step: 0.05 },
      { key: 'fade', label: '淡入淡出', kind: 'number', step: 0.05, min: 0, hint: '切換片段時的秒數' },
      { key: 'paused', label: '暫停', kind: 'bool' },
    ],
  },
  {
    name: 'RigidBody',
    label: '剛體',
    type: RigidBody,
    fields: [
      {
        key: 'type',
        label: '種類',
        kind: 'select',
        options: [
          ['dynamic', '動態（受重力）'],
          ['fixed', '固定'],
          ['kinematic', '由程式移動'],
        ],
      },
      { key: 'gravityScale', label: '重力倍率', kind: 'number', step: 0.1, when: kindOf('type', 'dynamic') },
      { key: 'linearDamping', label: '移動阻力', kind: 'number', step: 0.01, min: 0, when: kindOf('type', 'dynamic') },
      { key: 'angularDamping', label: '旋轉阻力', kind: 'number', step: 0.01, min: 0, when: kindOf('type', 'dynamic') },
      { key: 'rotations', label: '可旋轉的軸', kind: 'bool3', when: kindOf('type', 'dynamic') },
      {
        key: 'ccd',
        label: '高速偵測',
        kind: 'bool',
        hint: '連續碰撞偵測：高速物體（子彈）避免穿牆',
        when: kindOf('type', 'dynamic'),
      },
      { key: 'canSleep', label: '可以休眠', kind: 'bool' },
    ],
  },
  {
    name: 'Collider',
    label: '碰撞體',
    type: Collider,
    fields: [
      {
        key: 'shape',
        label: '形狀',
        kind: 'select',
        options: [
          ['box', '方塊'],
          ['sphere', '球'],
          ['capsule', '膠囊'],
          ['cylinder', '圓柱'],
          ['cone', '圓錐'],
          ['convexHull', '凸包（用網格）'],
          ['trimesh', '三角網格（用網格，只能固定）'],
        ],
      },
      { key: 'halfExtents', label: '半邊長', kind: 'vec3', step: 0.05, when: kindOf('shape', 'box') },
      {
        key: 'radius',
        label: '半徑',
        kind: 'number',
        step: 0.05,
        min: 0.001,
        when: kindOf('shape', 'sphere', 'capsule', 'cylinder', 'cone'),
      },
      {
        key: 'halfHeight',
        label: '半高',
        kind: 'number',
        step: 0.05,
        min: 0.001,
        when: kindOf('shape', 'capsule', 'cylinder', 'cone'),
      },
      { key: 'offset', label: '位移', kind: 'vec3', step: 0.05 },
      { key: 'friction', label: '摩擦力', kind: 'number', step: 0.05, min: 0 },
      { key: 'restitution', label: '彈性', kind: 'number', step: 0.05, min: 0, max: 1 },
      { key: 'density', label: '密度', kind: 'number', step: 0.1, min: 0 },
      { key: 'sensor', label: '感應器', kind: 'bool', hint: '只偵測重疊、不產生碰撞（觸發區域）' },
    ],
  },
  {
    name: 'ParticleEmitter',
    label: '粒子',
    type: ParticleEmitter,
    fields: [
      { key: 'playing', label: '發射中', kind: 'bool' },
      { key: 'loop', label: '重複', kind: 'bool', hint: 'duration 結束後重新開始' },
      { key: 'rate', label: '每秒數量', kind: 'number', step: 1, min: 0 },
      { key: 'duration', label: '持續秒數', kind: 'duration', hint: '空白或 ∞ 代表不停止' },
      { key: 'maxParticles', label: '數量上限', kind: 'number', step: 10, min: 1 },
      { key: 'lifetime', label: '壽命', kind: 'range', step: 0.05, min: 0, hint: '秒；兩個數字不同時在中間隨機' },
      { key: 'speed', label: '初速', kind: 'range', step: 0.05 },
      { key: 'direction', label: '方向', kind: 'vec3', step: 0.1 },
      { key: 'spread', label: '擴散角', kind: 'angle', step: 1, min: 0, max: 180, hint: '0 為直線，180 為四面八方' },
      {
        key: 'shape',
        label: '發射範圍',
        kind: 'select',
        options: [
          ['point', '一個點'],
          ['sphere', '球'],
          ['box', '方塊'],
          ['circle', '圓'],
        ],
      },
      { key: 'radius', label: '半徑', kind: 'number', step: 0.05, min: 0, when: kindOf('shape', 'sphere', 'circle') },
      { key: 'halfExtents', label: '半邊長', kind: 'vec3', step: 0.05, when: kindOf('shape', 'box') },
      { key: 'acceleration', label: '加速度', kind: 'vec3', step: 0.1, hint: '重力是 [0, -9.8, 0]' },
      { key: 'drag', label: '空氣阻力', kind: 'number', step: 0.05, min: 0 },
      { key: 'size', label: '大小', kind: 'range', step: 0.01, min: 0 },
      { key: 'sizeEnd', label: '結束大小倍率', kind: 'number', step: 0.05, min: 0 },
      { key: 'rotation', label: '起始旋轉', kind: 'range', step: 1, degrees: true },
      { key: 'angularVelocity', label: '旋轉速度', kind: 'range', step: 1, degrees: true, hint: '度／秒' },
      { key: 'stretch', label: '拉長', kind: 'number', step: 0.01, min: 0, hint: '沿速度方向拉長（火花、雨滴）' },
      { key: 'color', label: '起始顏色', kind: 'color' },
      { key: 'colorEnd', label: '結束顏色', kind: 'color' },
      { key: 'opacity', label: '起始不透明', kind: 'number', step: 0.05, min: 0, max: 1 },
      { key: 'opacityEnd', label: '結束不透明', kind: 'number', step: 0.05, min: 0, max: 1 },
      { key: 'fadeIn', label: '淡入比例', kind: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'intensity', label: '亮度', kind: 'number', step: 0.1, min: 0 },
      {
        key: 'blending',
        label: '重疊方式',
        kind: 'select',
        options: [
          ['additive', '疊加發光（火、火花）'],
          ['normal', '一般透明（煙）'],
        ],
      },
      {
        key: 'space',
        label: '座標',
        kind: 'select',
        options: [
          ['world', '世界（拖出軌跡）'],
          ['local', '跟著發射器'],
        ],
      },
      {
        key: 'autoDestroy',
        label: '播完刪除',
        kind: 'bool',
        hint: '不重複且粒子全部消失後，自動刪除實體（一次性特效）',
      },
    ],
  },
  {
    name: 'AudioSource',
    label: '音效',
    type: AudioSource,
    fields: [
      {
        key: 'url',
        label: '網址',
        kind: 'text',
        suggest: 'sounds',
        placeholder: 'sounds/fire.mp3',
        hint: '相對於專案的 public/',
      },
      { key: 'playing', label: '開始時播放', kind: 'bool', hint: '載入場景後自動播放（編輯器裡要試玩才會出聲）' },
      { key: 'loop', label: '重複', kind: 'bool' },
      { key: 'volume', label: '音量', kind: 'number', step: 0.05, min: 0, max: 1 },
      { key: 'pitch', label: '速度', kind: 'number', step: 0.05, min: 0.05, hint: '也會改變音高' },
      { key: 'group', label: '音量群組', kind: 'text', placeholder: 'sfx' },
      { key: 'fadeOut', label: '淡出秒數', kind: 'number', step: 0.05, min: 0 },
      { key: 'spatial', label: '3D 音效', kind: 'bool', hint: '聲音位置跟著物件，離攝影機越遠越小聲' },
      { key: 'refDistance', label: '原音量距離', kind: 'number', step: 0.5, min: 0, when: (v) => v.spatial === true },
      { key: 'maxDistance', label: '最遠距離', kind: 'number', step: 1, min: 0, when: (v) => v.spatial === true },
      { key: 'rolloff', label: '衰減速度', kind: 'number', step: 0.1, min: 0, when: (v) => v.spatial === true },
    ],
  },
  {
    name: 'Text3D',
    label: '3D 文字',
    type: Text3D,
    fields: [
      { key: 'text', label: '文字', kind: 'text', hint: '\\n 換行' },
      {
        key: 'mode',
        label: '種類',
        kind: 'select',
        options: [
          ['extrude', '立體（有厚度）'],
          ['flat', '平面（任何字型）'],
        ],
        hint: '立體文字沒有指定字型時只有英文字母、數字；中文請用平面或指定字型檔',
      },
      { key: 'size', label: '大小', kind: 'number', step: 0.05, min: 0.01 },
      { key: 'color', label: '顏色', kind: 'color' },
      { key: 'emissive', label: '自發光', kind: 'number', step: 0.05, min: 0 },
      {
        key: 'align',
        label: '水平對齊',
        kind: 'select',
        options: [
          ['left', '靠左'],
          ['center', '置中'],
          ['right', '靠右'],
        ],
      },
      {
        key: 'anchorY',
        label: '垂直對齊',
        kind: 'select',
        options: [
          ['top', '上緣'],
          ['middle', '中間'],
          ['bottom', '下緣'],
        ],
      },
      { key: 'castShadow', label: '投射陰影', kind: 'bool' },
      { key: 'receiveShadow', label: '接收陰影', kind: 'bool' },
      {
        key: 'font',
        label: '字型檔',
        kind: 'text',
        placeholder: '（內建字型）',
        when: kindOf('mode', 'extrude'),
        hint: '.typeface.json、.ttf、.otf；空白是內建字型',
      },
      { key: 'depth', label: '厚度', kind: 'number', step: 0.01, min: 0, when: kindOf('mode', 'extrude') },
      { key: 'bevel', label: '斜角', kind: 'bool', when: kindOf('mode', 'extrude') },
      { key: 'bevelSize', label: '斜角大小', kind: 'number', step: 0.005, min: 0, when: (v) => v.bevel === true },
      { key: 'bevelThickness', label: '斜角厚度', kind: 'number', step: 0.005, min: 0, when: (v) => v.bevel === true },
      { key: 'fontFamily', label: '字體', kind: 'text', when: kindOf('mode', 'flat') },
      { key: 'fontWeight', label: '粗細', kind: 'text', when: kindOf('mode', 'flat') },
      {
        key: 'background',
        label: '背景',
        kind: 'text',
        nullable: true,
        placeholder: '（透明）',
        when: kindOf('mode', 'flat'),
        hint: 'CSS 顏色，例如 rgba(0,0,0,0.5)；空白是透明',
      },
      { key: 'billboard', label: '面向攝影機', kind: 'bool', when: kindOf('mode', 'flat') },
    ],
  },
  {
    name: 'RenderLayer',
    label: '繪製圖層',
    type: RenderLayer,
    fields: [
      {
        key: 'layers',
        label: '圖層',
        kind: 'text',
        default: 'default',
        placeholder: 'default minimap',
        hint: '這個物件在哪些圖層，用空白隔開（沒有這個元件時是 default）',
      },
    ],
  },
  {
    name: 'CameraLayers',
    label: '攝影機圖層',
    type: CameraLayers,
    fields: [
      {
        key: 'layers',
        label: '畫哪些圖層',
        kind: 'text',
        default: 'default',
        placeholder: 'default minimap',
        hint: '這台攝影機畫哪些圖層，用空白隔開（沒有這個元件時只畫 default）',
      },
    ],
  },
  {
    name: 'CameraViewport',
    label: '子畫面',
    type: CameraViewport,
    fields: [
      { key: 'x', label: '左', kind: 'number', step: 0.01, min: 0, max: 1, hint: '畫面的比例 0~1，從左上角算起' },
      { key: 'y', label: '上', kind: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'width', label: '寬', kind: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'height', label: '高', kind: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'order', label: '順序', kind: 'number', step: 1, hint: '有好幾個子畫面時，小的先畫' },
      {
        key: 'background',
        label: '背景',
        kind: 'text',
        nullable: true,
        placeholder: '（透明）',
        hint: "'#rrggbb'；空白是透明",
      },
      { key: 'enabled', label: '顯示', kind: 'bool' },
    ],
  },
  {
    name: 'UIPanel3D',
    label: '3D 介面面板',
    type: UIPanel3D,
    fields: [
      { key: 'src', label: '介面檔', kind: 'text', placeholder: 'ui/kiosk.xml', hint: '相對於專案的 public/' },
      { key: 'worldWidth', label: '世界寬度', kind: 'number', step: 0.1, min: 0.01, hint: '高度依介面比例' },
      { key: 'width', label: '像素寬', kind: 'number', step: 1, min: 0, hint: '0：用介面檔 <UI width>' },
      { key: 'height', label: '像素高', kind: 'number', step: 1, min: 0, hint: '0：用介面檔 <UI height>' },
      { key: 'resolution', label: '清晰度', kind: 'number', step: 0.5, min: 0.5 },
      { key: 'billboard', label: '面向攝影機', kind: 'bool' },
      { key: 'doubleSided', label: '背面可見', kind: 'bool' },
      { key: 'lit', label: '受光照', kind: 'bool' },
      { key: 'emissive', label: '亮度', kind: 'number', step: 0.05, min: 0 },
      { key: 'opacity', label: '不透明度', kind: 'number', step: 0.05, min: 0, max: 1 },
      { key: 'depthTest', label: '會被遮住', kind: 'bool' },
      { key: 'interactive', label: '可以操作', kind: 'bool', hint: '遊戲裡可以點擊（編輯器裡不能點）' },
    ],
  },
];

export const schemaOf = (name: string) => SCHEMAS.find((s) => s.name === name);

/** 欄位的預設值（場景檔寫法） */
export function defaultOf(schema: ComponentSchema, field: FieldDef): unknown {
  if (field.default !== undefined) return field.default;
  const raw = (schema.type.create() as Record<string, unknown>)[field.key];
  if (field.kind === 'color') return `#${new Color(raw as string).getHexString()}`;
  if (field.kind === 'vec3' || field.kind === 'bool3') {
    const t = raw as { x: unknown; y: unknown; z: unknown };
    return [t.x, t.y, t.z];
  }
  if (field.kind === 'text') return raw ?? '';
  if (field.kind === 'duration') return Number.isFinite(raw) ? raw : null;
  if (field.kind === 'range') {
    const conv = (n: number) => Math.round((field.degrees ? n * DEG : n) * 1e6) / 1e6;
    return typeof raw === 'number' ? conv(raw) : (raw as number[]).map(conv);
  }
  if (field.kind === 'angle') return Math.round((raw as number) * DEG * 1e6) / 1e6;
  if (field.kind === 'select' && typeof raw === 'number') return String(raw);
  return raw;
}

/** 補上預設值後的元件資料（給欄位顯示） */
export function withDefaults(schema: ComponentSchema, data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const given = (data ?? {}) as Record<string, unknown>;
  for (const f of schema.fields) {
    const v = given[f.key] === null && f.nullable ? '' : (given[f.key] ?? defaultOf(schema, f));
    out[f.key] = f.kind === 'select' && typeof v === 'number' ? String(v) : v;
  }
  return out;
}

/** 欄位值轉回場景檔寫法（選單裡的數字轉回數字） */
export function toFileValue(schema: ComponentSchema, field: FieldDef, value: unknown): unknown {
  if (field.nullable && value === '') return null;
  // 範圍的最小、最大一樣時寫成一個數字
  if (field.kind === 'range' && Array.isArray(value) && value[0] === value[1]) return value[0];
  if (field.kind === 'select' && typeof (schema.type.create() as Record<string, unknown>)[field.key] === 'number')
    return Number(value);
  return value;
}

/** 新加入元件時的初始資料 */
export const NEW_COMPONENT: Record<string, unknown> = {
  Transform: {},
  Camera: {},
  Light: { kind: 'point' },
  MeshRenderer: { geometry: { box: 1 }, material: '#cccccc' },
  Model: { castShadow: true },
  RigidBody: {},
  Collider: {},
  Animator: {},
  ParticleEmitter: {},
  AudioSource: { loop: true, playing: true },
  Text3D: { text: 'Hello' },
  ScriptList: {},
  RenderLayer: { layers: 'default minimap' },
  CameraLayers: { layers: 'default minimap' },
  CameraViewport: { x: 0.72, y: 0.05, width: 0.25, height: 0.3 },
  UIPanel3D: {},
};

/** 元件的顯示名稱 */
export const componentLabel = (name: string) =>
  name === 'MeshRenderer' ? '網格' : name === 'ScriptList' ? '腳本' : (schemaOf(name)?.label ?? name);
