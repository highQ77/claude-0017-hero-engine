/**
 * 引擎內部用的 TSL（three.js 的節點著色器語言）：和 three/tsl 一樣的函式，但用寬鬆的型別（ShaderNode）。
 * @types/three 的 TSL 型別依向量維度區分（Node<'float'> 沒有 .z…），寫共用函式、節點圖編譯時太繁瑣；
 * 錯誤由 three.js 在建立著色器時回報。
 */
import * as tslModule from 'three/tsl';

/**
 * 著色器節點（three.js 的 TSL 節點：有 .mul、.add、.x、.xyz、.assign 等方法）。
 * 遊戲寫自訂著色器時，參數、回傳值都用這個型別。
 */
// biome-ignore lint/suspicious/noExplicitAny: TSL 節點的型別太嚴格（見上面的說明）
export type ShaderNode = any;

/** three/tsl 的所有函式與節點（回傳 ShaderNode） */
export const tsl = tslModule as unknown as Record<string, ShaderNode>;
