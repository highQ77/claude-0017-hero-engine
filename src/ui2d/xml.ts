/**
 * 介面 XML 的解析器：實作在 core/xml.ts（場景檔的 XML 格式也用同一個），這裡轉出給介面模組使用。
 */
export { COMMENT_TAG, XmlError, parseXml } from '../core/xml';
export type { ParseOptions, XmlNode } from '../core/xml';
