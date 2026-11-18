/**
 * 幽靈：在幽靈船周圍飄來飄去。
 * 每隻幽靈沿著繞船的橢圓軌道飛，半徑、高度會慢慢起伏，身體上下浮動、微微伸縮，臉朝前進的方向。
 * 影子：沿著場景燈光的方向，找到打在地面或船身上的位置，畫一塊柔和的暗影
 * （沙漠和船是烘焙光影的材質，不會接收即時陰影，所以影子是自己畫上去的）。
 * 在場景的 setup 裡呼叫 spawnGhosts(world, { castRay, lightDir })；換場景時會和場景一起移除。
 */
import { type Entity, type World, define } from '@engine/ecs';
import { Color, MathUtils, Matrix4, Vector3 } from '@engine/math';
import { type GeometryDesc, type MeshBasicMaterial, MeshRenderer, create, spawn } from '@engine/render';
import { Transform, math } from '@engine/scene';
import { ecs, world as gameWorld } from './engine';
import type { CastRay, SurfaceHit } from './ground';

/** 幽靈的數量 */
export const GHOST_COUNT = 5;
/** 繞行的中心（船身中央的地面位置） */
const CENTER = new Vector3(3, 0, 0);
/** 軌道橢圓的旋轉角度：和船身的方向一致（船頭朝 +X，模型轉了約 28°） */
const ORBIT_YAW = MathUtils.degToRad(28);
/** 幽靈的亮度：超過光暈門檻（場景檔 bloom 的 threshold = 2.5）一點點，身體會帶一圈淡淡的光 */
const GHOST_BRIGHTNESS = 3;
/** 影子的大小（公尺，半徑；邊緣是漸層，看起來會小一點） */
const SHADOW_SIZE = 2.8;
/** 影子最深的不透明度（幽靈是半透明的，影子也淡一點） */
const SHADOW_OPACITY = 0.5;

/** 幽靈的移動資料 */
interface GhostData {
  /** 目前在軌道上的角度（弧度） */
  angle: number;
  /** 繞行速度（弧度／秒，負數 = 反方向繞） */
  speed: number;
  /** 軌道沿船身方向的半徑（公尺） */
  radiusX: number;
  /** 軌道橫向的半徑（公尺） */
  radiusZ: number;
  /** 飛行的平均高度（公尺） */
  height: number;
  /** 讓每隻的起伏錯開 */
  phase: number;
  /** 經過的時間（秒） */
  time: number;
  /** 影子的實體 */
  shadow: Entity | null;
  /** 影子的材質（每隻各一份：依距離調整深淺） */
  shadowMaterial: MeshBasicMaterial | null;
}

const Ghost = define.component<GhostData>('Ghost', () => ({
  angle: 0,
  speed: 0.2,
  radiusX: 30,
  radiusZ: 20,
  height: 14,
  phase: 0,
  time: 0,
  shadow: null,
  shadowMaterial: null,
}));

// ───────── 外觀：半透明發光的身體（下襬是波浪）＋兩個黑眼睛＋張開的嘴 ─────────

/** 身體：圓頭往下展開成裙襬（剖面繞 Y 軸轉一圈）；下緣再用正弦波做出飄動的波浪 */
function bodyGeometry(): GeometryDesc {
  const profile: [r: number, y: number][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2); // 頭頂到頭的側面（四分之一圓）
    profile.push([Math.sin(a), 1 + Math.cos(a)]);
  }
  profile.push([1.05, 0.4], [1.2, -0.4], [1.35, -1]);
  const SEGMENTS = 32;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    const a = (j / SEGMENTS) * Math.PI * 2;
    for (const [r, y] of profile) {
      // 下襬波浪：越靠下緣，上下起伏越大
      const wave = y < 0.4 ? Math.sin(a * 6) * 0.35 * ((0.4 - y) / 1.4) : 0;
      vertices.push(Math.cos(a) * r, y + wave, Math.sin(a) * r);
    }
  }
  const n = profile.length;
  for (let j = 0; j < SEGMENTS; j++) {
    const a = j * n;
    const b = ((j + 1) % SEGMENTS) * n;
    for (let i = 0; i < n - 1; i++) indices.push(a + i, a + i + 1, b + i, b + i, a + i + 1, b + i + 1);
  }
  return { vertices, indices };
}

const geometries = {
  body: create.geometry(bodyGeometry()),
  eye: create.geometry({ sphere: [0.18, 12, 8] }),
  mouth: create.geometry({ sphere: [0.22, 12, 8] }),
};

const bodyMaterial = create.material({
  basic: {
    color: new Color('#bfe8ff').multiplyScalar(GHOST_BRIGHTNESS),
    transparent: true,
    opacity: 0.5,
    blending: 'additive', // 疊加：看起來是透光的靈體
    depthWrite: false,
    side: 'double',
  },
});
const faceMaterial = create.material({ basic: { color: '#05070c', fog: false } });

/** 影子的貼圖：中間黑、往外漸漸透明的圓 */
function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return create.texture(canvas);
}
const shadowMap = shadowTexture();
const shadowGeometry = create.geometry({ circle: [1, 32] });

/** 建立一隻幽靈（臉朝 -Z，也就是前進的方向） */
function spawnGhost(world: World, data: Partial<GhostData>): void {
  const ghost = spawn.mesh(world, {
    name: '幽靈',
    geometry: geometries.body,
    material: bodyMaterial,
    renderOrder: 10, // 半透明的身體在船之後畫
  });
  // 影子：獨立的實體（不跟著幽靈的變換），每幀擺到表面上
  const shadowMaterial = create.material({
    basic: {
      color: '#000000',
      map: shadowMap,
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
      polygonOffset: true, // 貼在表面上不閃爍
      polygonOffsetFactor: -4,
    },
  });
  const shadow = spawn.mesh(world, {
    name: '幽靈的影子',
    geometry: shadowGeometry,
    material: shadowMaterial,
    renderOrder: 5, // 在船之後、幽靈之前畫
    visible: false,
  });
  world.add(ghost, Ghost, { ...data, shadow, shadowMaterial });
  for (const x of [-0.38, 0.38]) {
    spawn.mesh(world, {
      geometry: geometries.eye,
      material: faceMaterial,
      position: [x, 1.25, -0.88],
      scale: [1, 1.4, 0.6],
      parent: ghost,
    });
  }
  spawn.mesh(world, {
    geometry: geometries.mouth,
    material: faceMaterial,
    position: [0, 0.7, -0.92],
    scale: [1, 1.3, 0.5],
    parent: ghost,
  });
}

/** 影子的設定：castRay 找表面（ground.ts 的 createSurface），lightDir 是燈光照射的方向（單位向量） */
export interface GhostShadowOptions {
  castRay: CastRay;
  lightDir: Vector3;
}
let shadowOptions: GhostShadowOptions | null = null;

/** 在船的周圍放 GHOST_COUNT 隻幽靈：平均分散在軌道上，速度、高度、方向各不相同 */
export function spawnGhosts(world: World, shadows?: GhostShadowOptions): void {
  shadowOptions = shadows ?? null;
  for (let i = 0; i < GHOST_COUNT; i++) {
    spawnGhost(world, {
      angle: (i / GHOST_COUNT) * Math.PI * 2,
      speed: (0.12 + Math.random() * 0.1) * (i % 2 === 0 ? 1 : -1),
      radiusX: 26 + Math.random() * 8,
      radiusZ: 16 + Math.random() * 6,
      height: 11 + Math.random() * 9,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

// ───────── 每幀移動 ─────────

const cosYaw = Math.cos(ORBIT_YAW);
const sinYaw = Math.sin(ORBIT_YAW);
const ahead = new Vector3();

/** 軌道上某個角度的位置（寫進 out） */
function orbitPoint(g: GhostData, angle: number, out: Vector3): Vector3 {
  const wobble = Math.sin(g.time * 0.35 + g.phase) * 4; // 半徑慢慢一進一出
  const x = Math.cos(angle) * (g.radiusX + wobble);
  const z = Math.sin(angle) * (g.radiusZ + wobble);
  return out.set(
    CENTER.x + x * cosYaw + z * sinYaw,
    CENTER.y + g.height + Math.sin(g.time * 1.2 + g.phase) * 1.2 + Math.sin(g.time * 0.27 + g.phase) * 3,
    CENTER.z - x * sinYaw + z * cosYaw,
  );
}

ecs.each('ghost-wander', [Transform, Ghost], (_e, t, g, time) => {
  g.time += time.delta;
  g.angle += g.speed * time.delta;
  orbitPoint(g, g.angle, t.position);
  // 臉朝前進的方向：看向軌道上稍微前面一點的位置
  math.lookAt(t, orbitPoint(g, g.angle + Math.sign(g.speed) * 0.05, ahead));
  // 身體微微伸縮，像在呼吸
  const s = 1 + Math.sin(g.time * 2.4 + g.phase) * 0.06;
  t.scale.set(1.6 / s, 1.6 * s, 1.6 / s);
  placeShadow(g, t.position);
});

// ───────── 影子 ─────────

const hit: SurfaceHit = { point: new Vector3(), normal: new Vector3() };
const axisX = new Vector3();
const axisY = new Vector3();
const basis = new Matrix4();

/** 從幽靈沿燈光方向找到表面，把影子貼上去：斜照時沿光線方向拉長，離越遠越大越淡 */
function placeShadow(g: GhostData, from: Vector3): void {
  if (g.shadow === null || !g.shadowMaterial) return;
  const renderer = gameWorld.get(g.shadow, MeshRenderer);
  const st = gameWorld.get(g.shadow, Transform);
  if (!renderer || !st) return;
  const ok = shadowOptions?.castRay(from, shadowOptions.lightDir, hit) ?? false;
  renderer.visible = ok;
  if (!ok || !shadowOptions) return;
  const light = shadowOptions.lightDir;
  const n = hit.normal;
  st.position.copy(hit.point).addScaledVector(n, 0.05);
  // 影子平面：法線當 Z 軸，光線投影在表面上的方向當 X 軸（拉長的方向）
  axisX.copy(light).addScaledVector(n, -light.dot(n));
  if (axisX.lengthSq() < 1e-6) axisX.set(1, 0, 0).addScaledVector(n, -n.x);
  axisX.normalize();
  axisY.crossVectors(n, axisX);
  basis.makeBasis(axisX, axisY, n);
  st.rotation.setFromRotationMatrix(basis);
  const distance = hit.point.distanceTo(from);
  const slant = Math.max(0.3, -light.dot(n)); // 光線越斜，影子拉得越長
  const size = SHADOW_SIZE * (1 + distance * 0.012); // 離越遠，影子越模糊、越大
  st.scale.set(size / slant, size, 1);
  g.shadowMaterial.opacity = SHADOW_OPACITY * MathUtils.clamp(1.1 - distance / 70, 0.25, 1);
}
