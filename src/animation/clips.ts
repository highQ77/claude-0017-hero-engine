/**
 * 用資料建立模型動畫片段（AnimationClip），交給 Animator 的 clips 播放，不用 import three。
 *
 *   const wave = create.clip('wave', {
 *     'arm.rotation': { times: [0, 0.5, 1], values: [[0, 0, -0.6], [0, 0, 0.6], [0, 0, -0.6]] },
 *     'head.position': { times: [0, 1], values: [[0, 1.5, 0], [0, 1.6, 0]] },
 *   });
 *   world.spawn(Transform, SceneObject.with({ object: robot }), Animator.with({ clips: [wave], play: 'wave' }));
 *
 * 鍵是「物件名稱.屬性」（物件名稱是 create.mesh 的 name，或模型裡節點的名稱；只寫 .屬性 代表根物件）：
 * - position、scale：[x, y, z]
 * - rotation：[x, y, z]（弧度，依 X、Y、Z 順序），會轉成四元數平滑內插
 * - quaternion：[x, y, z, w]
 * - visible：true／false（一格一格切換）
 * - 其他數字屬性，例如 'arm.material.opacity'：數字
 * - 顏色屬性，例如 'arm.material.color'：'#rrggbb'
 */
import * as THREE from 'three';

/** 一條軌道：時間點（秒）與每個時間點的值 */
export interface ClipTrack {
  /** 時間點（秒，由小到大） */
  times: readonly number[];
  /** 每個時間點的值（數量和 times 一樣） */
  values: readonly (number | boolean | string | readonly number[])[];
  /** 內插方式：smooth（平滑曲線）、linear（預設）、step（不內插，一格一格跳）。rotation、quaternion 的 smooth 同 linear（球面內插） */
  interpolation?: 'linear' | 'smooth' | 'step';
}

const INTERPOLATION = {
  linear: THREE.InterpolateLinear,
  smooth: THREE.InterpolateSmooth,
  step: THREE.InterpolateDiscrete,
} as const;

function makeTrack(path: string, track: ClipTrack): THREE.KeyframeTrack {
  const { times, values } = track;
  if (times.length !== values.length) {
    throw new Error(`動畫軌道 ${path}：times 有 ${times.length} 個，values 有 ${values.length} 個，數量要一樣`);
  }
  if (!times.length) throw new Error(`動畫軌道 ${path} 沒有任何時間點`);
  const t = times as number[];
  const mode = track.interpolation ? INTERPOLATION[track.interpolation] : undefined;
  const first = values[0];
  let k: THREE.KeyframeTrack;
  if (/\.rotation$/.test(path)) {
    // 尤拉角 → 四元數（三個軸一起轉才不會繞遠路）
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const flat = values.flatMap((v) => {
      const [x = 0, y = 0, z = 0] = v as readonly number[];
      return q.setFromEuler(e.set(x, y, z)).toArray();
    });
    k = new THREE.QuaternionKeyframeTrack(path.replace(/\.rotation$/, '.quaternion'), t, flat);
  } else if (typeof first === 'boolean') {
    k = new THREE.BooleanKeyframeTrack(path, t, values as boolean[]);
  } else if (typeof first === 'string') {
    const c = new THREE.Color();
    k = new THREE.ColorKeyframeTrack(
      path,
      t,
      values.flatMap((v) => c.set(v as string).toArray()),
    );
  } else if (typeof first === 'number') {
    k = new THREE.NumberKeyframeTrack(path, t, values as number[]);
  } else {
    const flat = values.flatMap((v) => [...(v as readonly number[])]);
    k = /\.quaternion$/.test(path)
      ? new THREE.QuaternionKeyframeTrack(path, t, flat)
      : new THREE.VectorKeyframeTrack(path, t, flat);
  }
  // 旋轉（四元數）沒有平滑曲線的內插：smooth 時維持預設的球面線性內插（three.js 不支援，會警告）
  const quaternion = k instanceof THREE.QuaternionKeyframeTrack;
  if (mode !== undefined && !(quaternion && mode === THREE.InterpolateSmooth)) k.setInterpolation(mode);
  return k;
}

/**
 * 建立模型動畫片段：鍵是「物件名稱.屬性」，值是時間點與數值。長度預設是最後一個時間點。
 * @example
 * const bounce = create.clip('bounce', { 'cube.position': { times: [0, 0.5, 1], values: [[0, 0, 0], [0, 1, 0], [0, 0, 0]] } });
 */
export function createClip(
  name: string,
  tracks: Readonly<Record<string, ClipTrack>>,
  duration = -1,
): THREE.AnimationClip {
  return new THREE.AnimationClip(
    name,
    duration,
    Object.entries(tracks).map(([path, track]) => makeTrack(path, track)),
  );
}
