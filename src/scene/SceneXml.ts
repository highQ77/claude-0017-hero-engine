/**
 * 場景檔的 XML 格式（和 JSON 格式內容相同，只是寫法不同；3D 場景編輯器預設存成 XML）：
 *
 *   <Scene format="hero-scene" version="1">
 *     <SceneUI src="ui/scene.xml"/>                      這個場景搭配的介面檔（編輯器疊在畫面上預覽）
 *     <Settings background="#15181f">                     場景設定（settings）
 *       <fog color="#15181f" near="10" far="40"/>
 *     </Settings>
 *     <Entity id="cam" name="攝影機">
 *       <Transform position="0 2 6" rotation="-15 0 0"/>   元件：標籤是元件名稱，欄位寫成屬性
 *       <Camera fov="50"/>
 *       <Entity id="child">…</Entity>                      子實體直接寫在父實體裡面（不用 parent）
 *     </Entity>
 *     <Entity id="tree1" prefab="prefabs/tree.xml">       預製物件的實例
 *       <Transform position="3 0 0"/>
 *       <Override target="leaf" name="紅葉">               覆蓋預製物件裡的實體（overrides）
 *         <MeshRenderer material="#cc3322"/>
 *         <Collider is="null"/>                            null：移除那個元件
 *       </Override>
 *     </Entity>
 *   </Scene>
 *
 * 元件資料（JSON 的值）轉成 XML 的規則（讀寫都用同一套，存了再讀會得到一樣的資料）：
 * - 物件 → 元素；數字、true/false、文字、兩個以上數字的陣列寫成屬性：position="0 2 6"
 * - 屬性值的判斷：true／false 是布林，像數字的是數字，用空白隔開的多個數字是陣列，其他是文字
 * - 其他值寫成子元素：物件 <geometry box="1"/>；陣列 <points is="array"><item …/></points>；
 *   null <play is="null"/>；會被誤認的文字（例如 "12"、"true"）<text is="string" value="12"/>；
 *   陣列裡的數字、布林 <item is="number" value="1"/>
 * - 不能當 XML 名稱的鍵（中文、有 / 的…）寫成 <_ key="鍵">
 */
import { parseXml, type XmlNode } from '../core/xml';
import type { PrefabOverride, SceneFileData, SceneFileEntity } from './SceneFile';
import { isObject } from './json';

/** 實體元素裡保留的標籤（不能當元件名稱） */
const ENTITY_TAG = 'Entity';
const OVERRIDE_TAG = 'Override';
const RESERVED_TAGS = new Set([ENTITY_TAG, OVERRIDE_TAG]);
/** 不能當 XML 名稱的鍵用的標籤 */
const KEYED_TAG = '_';
/** 陣列項目的標籤 */
const ITEM_TAG = 'item';

/** 可以當 XML 標籤、屬性名稱的鍵 */
const VALID_NAME = /^[A-Za-z_][\w.-]*$/;
/** 一個數字（String(n) 的各種寫法） */
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ───────── 值 ↔ 屬性文字 ─────────

/** 屬性文字 → 值（布林、數字、數字陣列、文字） */
function decodeAttr(text: string): boolean | number | number[] | string {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (NUMBER.test(text)) return Number(text);
  const parts = text.split(' ');
  if (parts.length >= 2 && parts.every((p) => NUMBER.test(p))) return parts.map(Number);
  return text;
}

/** 可以寫成屬性的值（讀回來會得到一樣的值） */
function attrText(v: unknown): string | null {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'string') return decodeAttr(v) === v ? v : null;
  if (Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))
    return v.join(' ');
  return null;
}

// ───────── 寫出 ─────────

interface El {
  tag: string;
  attrs: [string, string][];
  children: El[];
}

const el = (tag: string, attrs: [string, string][] = [], children: El[] = []): El => ({ tag, attrs, children });

/** 物件的欄位放進元素：能寫成屬性的寫成屬性，其他寫成子元素 */
function fillObject(target: El, obj: Record<string, unknown>, where: string): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const reserved = k === 'is' || (target.tag === KEYED_TAG && k === 'key');
    const text = VALID_NAME.test(k) && !reserved ? attrText(v) : null;
    if (text !== null) target.attrs.push([k, text]);
    else target.children.push(valueElement(k, v, `${where}.${k}`));
  }
}

/** 一個值寫成元素（鍵不能當標籤時用 <_ key="…">） */
function valueElement(key: string | null, v: unknown, where: string): El {
  const out =
    key === null ? el(ITEM_TAG) : VALID_NAME.test(key) ? el(key) : el(KEYED_TAG, [['key', key]] as [string, string][]);
  if (v === null) out.attrs.push(['is', 'null']);
  else if (typeof v === 'string') out.attrs.push(['is', 'string'], ['value', v]);
  else if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`${where} 不是有限的數字，不能存檔`);
    out.attrs.push(['is', 'number'], ['value', String(v)]);
  } else if (typeof v === 'boolean') out.attrs.push(['is', 'boolean'], ['value', String(v)]);
  else if (Array.isArray(v)) {
    out.attrs.push(['is', 'array']);
    v.forEach((x, i) => {
      out.children.push(valueElement(null, x, `${where}[${i}]`));
    });
  } else if (isObject(v)) fillObject(out, v, where);
  else throw new Error(`${where} 不能存成場景檔（${typeof v}）`);
  return out;
}

/** 元件 → 元素（資料不是物件時也可以，例如 null） */
function componentElement(name: string, value: unknown, where: string): El {
  if (RESERVED_TAGS.has(name)) throw new Error(`${where}：元件不能叫做 ${name}（XML 場景檔保留的標籤）`);
  if (value === undefined) return el(name);
  return valueElement(name, value, `${where} 的 ${name}`);
}

const escapeAttr = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');

/** 一行最多幾個字：超過時屬性一個一行 */
const MAX_LINE = 110;

function serialize(node: El, indent: string, out: string[]): void {
  const attrs = node.attrs.map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  const close = node.children.length ? '>' : '/>';
  const oneLine = `${indent}<${node.tag}${attrs.map((a) => ` ${a}`).join('')}${close}`;
  if (oneLine.length <= MAX_LINE || attrs.length <= 1) out.push(oneLine);
  else {
    out.push(`${indent}<${node.tag}`);
    for (const a of attrs) out.push(`${indent}  ${a}`);
    out.push(`${indent}${close}`);
  }
  if (!node.children.length) return;
  for (const c of node.children) serialize(c, `${indent}  `, out);
  out.push(`${indent}</${node.tag}>`);
}

/**
 * 場景檔轉成 XML 文字（兩格縮排，結尾換行；prefabs 不會寫出）。
 * 子實體寫在父實體裡面；同一層依檔案裡的順序。
 */
export function stringifySceneXml(data: SceneFileData): string {
  const root = el('Scene', [
    ['format', data.format],
    ['version', String(data.version)],
  ]);
  for (const src of data.ui ?? []) root.children.push(el('SceneUI', [['src', src]]));
  if (data.settings && Object.keys(data.settings).length) {
    const settings = el('Settings');
    fillObject(settings, data.settings, 'settings');
    root.children.push(settings);
  }
  const ids = new Set(data.entities.map((e) => e.id));
  const childrenOf = new Map<string | null, SceneFileEntity[]>();
  for (const e of data.entities) {
    const parent = e.parent !== undefined && ids.has(e.parent) ? e.parent : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(e);
    childrenOf.set(parent, list);
  }
  const entityElement = (e: SceneFileEntity, chain: Set<string>): El => {
    const where = `實體「${e.id}」`;
    const node = el(ENTITY_TAG, [['id', e.id]]);
    if (e.name !== undefined) node.attrs.push(['name', e.name]);
    if (e.prefab !== undefined) node.attrs.push(['prefab', e.prefab]);
    for (const [name, value] of Object.entries(e.components ?? {}))
      node.children.push(componentElement(name, value, where));
    for (const [target, ov] of Object.entries(e.overrides ?? {})) {
      const o = el(OVERRIDE_TAG, [['target', target]]);
      if (ov.name !== undefined) o.attrs.push(['name', ov.name]);
      for (const [name, value] of Object.entries(ov.components ?? {}))
        o.children.push(componentElement(name, value, `${where} 的覆蓋「${target}」`));
      node.children.push(o);
    }
    for (const child of childrenOf.get(e.id) ?? []) {
      if (chain.has(child.id)) throw new Error(`實體「${child.id}」的父子關係形成循環`);
      node.children.push(entityElement(child, new Set([...chain, child.id])));
    }
    return node;
  };
  for (const e of childrenOf.get(null) ?? []) root.children.push(entityElement(e, new Set([e.id])));
  const out: string[] = [];
  serialize(root, '', out);
  return `${out.join('\n')}\n`;
}

// ───────── 讀取 ─────────

const at = (node: XmlNode) => `第 ${node.line} 行 <${node.tag}>`;

function checkAttrs(node: XmlNode, allowed: readonly string[]): void {
  for (const k of Object.keys(node.attrs))
    if (!allowed.includes(k)) throw new Error(`${at(node)}：不認識的屬性「${k}」（可用：${allowed.join('、')}）`);
}

/** 子元素對應的鍵（<_ key="…"> 用 key） */
function keyOf(node: XmlNode): string {
  if (node.tag !== KEYED_TAG) return node.tag;
  const key = node.attrs.key;
  if (key === undefined) throw new Error(`${at(node)}：<_> 要有 key 屬性`);
  return key;
}

/** 元素 → 值 */
function decodeElement(node: XmlNode): Json {
  const kind = node.attrs.is;
  const ownAttrs = Object.entries(node.attrs).filter(([k]) => k !== 'is' && !(node.tag === KEYED_TAG && k === 'key'));
  if (kind !== undefined) {
    const value = node.attrs.value;
    const needValue = () => {
      if (value === undefined) throw new Error(`${at(node)}：is="${kind}" 要有 value 屬性`);
      return value;
    };
    const extra = ownAttrs.filter(([k]) => k !== 'value');
    if (extra.length)
      throw new Error(`${at(node)}：is="${kind}" 不能有其他屬性（${extra.map(([k]) => k).join('、')}）`);
    if (kind !== 'array' && node.children.length) throw new Error(`${at(node)}：is="${kind}" 不能有子元素`);
    switch (kind) {
      case 'null':
        return null;
      case 'string':
        return needValue();
      case 'number': {
        const v = needValue();
        if (!NUMBER.test(v)) throw new Error(`${at(node)}：value 要是數字，收到 "${v}"`);
        return Number(v);
      }
      case 'boolean': {
        const v = needValue();
        if (v !== 'true' && v !== 'false') throw new Error(`${at(node)}：value 要是 true 或 false，收到 "${v}"`);
        return v === 'true';
      }
      case 'array':
        if (value !== undefined) throw new Error(`${at(node)}：is="array" 的項目要寫成子元素 <item …/>`);
        return node.children.map(decodeElement);
      default:
        throw new Error(`${at(node)}：不認識的 is="${kind}"（可用：null、string、number、boolean、array）`);
    }
  }
  if (node.text) throw new Error(`${at(node)}：不能直接寫文字（文字請寫成屬性，例如 text="…"）`);
  const out: { [key: string]: Json } = {};
  for (const [k, v] of ownAttrs) out[k] = decodeAttr(v);
  for (const child of node.children) {
    const key = keyOf(child);
    if (key in out) throw new Error(`${at(child)}：「${key}」重複`);
    out[key] = decodeElement(child);
  }
  return out;
}

/** 元件元素 → 元件名稱與資料 */
function decodeComponent(node: XmlNode): [string, Json] {
  return [keyOf(node), decodeElement(node)];
}

/**
 * XML 文字 → 場景檔資料（還沒檢查內容；parseSceneFile 讀 XML 時會呼叫這裡，再做一樣的檢查）。
 * XML 語法錯誤或結構不對時拋出錯誤（附行號）。
 */
export function sceneXmlToData(xml: string): Record<string, unknown> {
  const root = parseXml(xml);
  if (root.tag !== 'Scene') throw new Error(`${at(root)}：最外層要是 <Scene>`);
  checkAttrs(root, ['format', 'version']);
  const version = root.attrs.version;
  const out: Record<string, unknown> = {
    format: root.attrs.format ?? 'hero-scene',
    version: version !== undefined && NUMBER.test(version) ? Number(version) : version,
  };
  const entities: SceneFileEntity[] = [];
  const ui: string[] = [];

  const readEntity = (node: XmlNode, parent: string | undefined) => {
    checkAttrs(node, ['id', 'name', 'prefab']);
    const { id, name, prefab } = node.attrs;
    if (id === undefined) throw new Error(`${at(node)}：缺少 id`);
    const entity: SceneFileEntity = { id };
    if (name !== undefined) entity.name = name;
    if (parent !== undefined) entity.parent = parent;
    if (prefab !== undefined) entity.prefab = prefab;
    entities.push(entity);
    const components: Record<string, unknown> = {};
    const overrides: Record<string, PrefabOverride> = {};
    const children: XmlNode[] = [];
    for (const child of node.children) {
      if (child.tag === ENTITY_TAG) children.push(child);
      else if (child.tag === OVERRIDE_TAG) {
        checkAttrs(child, ['target', 'name']);
        const target = child.attrs.target;
        if (!target) throw new Error(`${at(child)}：缺少 target（預製物件裡的 id）`);
        if (target in overrides) throw new Error(`${at(child)}：重複覆蓋「${target}」`);
        const ov: PrefabOverride = {};
        if (child.attrs.name !== undefined) ov.name = child.attrs.name;
        const oc: Record<string, unknown> = {};
        for (const c of child.children) {
          const [k, v] = decodeComponent(c);
          if (k in oc) throw new Error(`${at(c)}：元件「${k}」重複`);
          oc[k] = v;
        }
        if (Object.keys(oc).length) ov.components = oc;
        overrides[target] = ov;
      } else {
        const [k, v] = decodeComponent(child);
        if (k in components) throw new Error(`${at(child)}：元件「${k}」重複`);
        components[k] = v;
      }
    }
    if (Object.keys(components).length) entity.components = components;
    if (Object.keys(overrides).length) entity.overrides = overrides;
    // 子實體放在父實體後面
    for (const child of children) readEntity(child, id);
  };

  for (const node of root.children) {
    if (node.tag === ENTITY_TAG) readEntity(node, undefined);
    else if (node.tag === 'Settings') {
      if (out.settings !== undefined) throw new Error(`${at(node)}：只能有一個 <Settings>`);
      out.settings = decodeElement(node);
    } else if (node.tag === 'SceneUI') {
      checkAttrs(node, ['src']);
      if (!node.attrs.src) throw new Error(`${at(node)}：缺少 src（介面檔，例如 ui/scene.xml）`);
      ui.push(node.attrs.src);
    } else throw new Error(`${at(node)}：<Scene> 裡只能放 <Entity>、<Settings>、<SceneUI>`);
  }
  out.entities = entities;
  if (ui.length) out.ui = ui;
  return out;
}

/** 文字看起來是 XML（第一個非空白字元是 <） */
export function looksLikeXml(text: string): boolean {
  return text.trimStart().startsWith('<');
}
