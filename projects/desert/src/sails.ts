/**
 * 船帆被風吹動：在頂點著色器裡把船帆往船頭方向鼓起來，再加上一陣一陣的飄動（TSL 節點）。
 *
 * - 船帆的網格（Ship_Sails）裡有好幾片帆，每片各自是相連的一塊；載入時把它們分開，
 *   算出每個頂點在「自己那片帆」上的位置：上緣綁在帆桁上不動，越往下、越靠中間動得越多
 * - 光影是烘焙好的貼圖，不會跟著動（幅度不大，看不出來）
 * - 幽靈影子用的地表射線是載入時的形狀，也不受影響
 *
 * 在套用烘焙材質之後呼叫 animateSails(船帆網格)：換成同樣的基本材質，再加上頂點的擺動。
 * sailSettings 可以在執行中調整。
 */
import { Box3, Vector3 } from '@engine/math';
import { create, type BufferGeometry, type Mesh, type MeshBasicMaterial } from '@engine/render';
import { type CustomMaterial, ShaderLibrary, tsl } from '@engine/shaders';
import { ecs } from './engine';

const { attribute, sin, vec3 } = tsl;

/** 船帆的動態設定（修改後下一幀生效） */
export const sailSettings = {
  /** 鼓起的深度（公尺）：被風吹得往船頭方向凸出去多少 */
  billow: 0.5,
  /** 飄動的幅度（公尺） */
  flutter: 0.3,
  /** 飄動的速度（倍率） */
  speed: 1,
};

/** 鼓起的方向（船帆網格自己的座標）：船頭是 +X，風從船尾吹向船頭 */
const WIND_AXIS = 'x';

/** 船帆的著色器：基本材質（烘焙的光影貼圖照常），頂點依 aFlutter 往船頭方向擺動 */
const library = new ShaderLibrary().define({
  name: 'sails',
  base: 'basic',
  uniforms: { uTime: 0, uBillow: sailSettings.billow, uFlutter: sailSettings.flutter },
  position: (c) => {
    const u = c.uniforms;
    const p = c.position;
    const f = attribute('aFlutter', 'vec2'); // x = 擺動的權重（0 = 不動），y = 相位
    const w = f.x;
    const ph = f.y;
    // 陣風：慢慢地一陣強、一陣弱
    const gust = sin(u.uTime.mul(0.45).add(ph.mul(0.3)))
      .mul(0.25)
      .add(0.75);
    // 兩層波：大的起伏沿著帆面慢慢傳過去，小的抖動比較快
    const wave = sin(u.uTime.mul(2.1).add(p.z.mul(0.55)).add(p.y.mul(0.8)).add(ph))
      .mul(0.7)
      .add(sin(u.uTime.mul(4.7).sub(p.z.mul(1.4)).add(p.y.mul(1.9)).add(ph.mul(1.7))).mul(0.3));
    const push = w.mul(gust).mul(u.uBillow.add(u.uFlutter.mul(wave)));
    return WIND_AXIS === 'x' ? vec3(p.x.add(push), p.y, p.z) : vec3(p.x, p.y, p.z.add(push));
  },
});
/** 船帆的材質（場景裡的船是模型的複本，材質是同一份） */
let sailMaterial: CustomMaterial | null = null;

/** 把網格的頂點分成相連的幾塊（位置相同的頂點也算相連），回傳每個頂點屬於哪一塊 */
function pieces(geometry: BufferGeometry): Int32Array {
  const pos = geometry.getAttribute('position');
  const n = pos.count;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const index = geometry.getIndex();
  const tri = (i: number) => (index ? index.getX(i) : i);
  const count = index ? index.count : n;
  for (let i = 0; i < count; i += 3) {
    union(tri(i), tri(i + 1));
    union(tri(i + 1), tri(i + 2));
  }
  const same = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const j = same.get(key);
    if (j === undefined) same.set(key, i);
    else union(i, j);
  }
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = find(i);
  return out;
}

/** 讓船帆隨風擺動 */
export function animateSails(mesh: Mesh): void {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute('position');
  const owner = pieces(geometry);

  // 每片帆的範圍
  const box = new Map<number, Box3>();
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    let b = box.get(owner[i]);
    if (!b) box.set(owner[i], (b = new Box3()));
    b.expandByPoint(p.fromBufferAttribute(pos, i));
  }
  // 每片帆一個不同的相位，才不會整齊劃一地一起擺
  const phase = new Map<number, number>();
  let k = 0;
  for (const id of box.keys()) phase.set(id, (k++ * 2.39996) % (Math.PI * 2));

  // 每個頂點：x = 擺動的權重（0 = 不動），y = 相位
  const flutter = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const b = box.get(owner[i])!;
    p.fromBufferAttribute(pos, i);
    const height = Math.max(1e-3, b.max.y - b.min.y);
    const halfWidth = Math.max(1e-3, (b.max.z - b.min.z) / 2);
    const fromTop = (b.max.y - p.y) / height; // 0 = 上緣（綁在帆桁上），1 = 下緣
    const across = (p.z - (b.max.z + b.min.z) / 2) / halfWidth; // -1～1
    // 上緣不動、中段最鼓、下緣還會飄；左右兩側稍微少一點
    const vertical = Math.sin(Math.PI * 0.75 * fromTop);
    const horizontal = 1 - 0.5 * across * across;
    flutter[i * 2] = vertical * horizontal;
    flutter[i * 2 + 1] = phase.get(owner[i])!;
  }
  geometry.setAttribute('aFlutter', create.attribute(flutter, 2));

  // 換成同樣設定的船帆材質（烘焙的底色、光照貼圖、AO）
  const old = mesh.material as MeshBasicMaterial;
  sailMaterial = library.createMaterial(
    'sails',
    {},
    {
      name: old.name,
      map: old.map,
      lightMap: old.lightMap,
      lightMapIntensity: old.lightMapIntensity,
      aoMap: old.aoMap,
      aoMapIntensity: old.aoMapIntensity,
      side: old.side,
    },
  );
  mesh.material = sailMaterial;
  old.dispose();
  // 船帆動起來後會超出原本的範圍：放寬一點，避免在畫面邊緣被提早裁掉
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += sailSettings.billow + sailSettings.flutter + 1;
}

// 每幀更新時間與設定（時間用累加的：改速度時不會突然跳一下）
ecs.addSystem({
  name: 'sails',
  run: (_world, time) => {
    if (!sailMaterial) return;
    const u = sailMaterial.uniforms;
    (u.uTime.value as number) += time.delta * sailSettings.speed;
    u.uBillow.value = sailSettings.billow;
    u.uFlutter.value = sailSettings.flutter;
  },
});
