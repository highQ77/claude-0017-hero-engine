# @engine/math 的範例

## Box2
2D 的矩形範圍（左下角 min、右上角 max）：判斷點在不在裡面、兩個範圍有沒有重疊。

```ts
const screen = new Box2(new Vector2(0, 0), new Vector2(800, 600));
const button = new Box2(new Vector2(700, 550), new Vector2(820, 620));
console.log('(400, 300) 在畫面裡？', screen.containsPoint(new Vector2(400, 300)));
console.log('按鈕和畫面重疊？', screen.intersectsBox(button));
console.log('重疊的部分：', button.clone().intersect(screen));
```

## Box3
3D 的範圍盒：常用來取得物件的大小、判斷碰撞。這裡算出模型的外框並畫出來。

```ts
spawn.camera(world, { position: [3, 2.5, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#ffa94f', position: [0, 0.8, 0] });
engine.start();
engine.on('update', () => {
  const obj = render.getObject(e);
  if (!obj) return;
  const box = new Box3().setFromObject(obj);
  render.debug.box(box, undefined, { color: '#4cc9f0' });
  if (engine.time.frame === 2) console.log('大小：', box.getSize(new Vector3()));
});
```

## Color
顏色：可以用 '#rrggbb'、CSS 顏色名稱、數字建立，也可以在兩個顏色之間漸變。

```ts
const red = new Color('#ff4040');
const blue = new Color('royalblue');
console.log('紅色的 RGB：', red.r.toFixed(2), red.g.toFixed(2), red.b.toFixed(2));
for (let i = 0; i <= 4; i++) console.log(`漸變 ${i * 25}%：#${red.clone().lerp(blue, i / 4).getHexString()}`);
```

## Cylindrical
圓柱座標（半徑、角度、高度）：繞著一根柱子排列東西很方便。

```ts
spawn.camera(world, { position: [0, 4, 6], target: [0, 1, 0] });
spawn.defaultLights(world);
const c = new Cylindrical(2, 0, 0);
for (let i = 0; i < 12; i++) {
  c.theta = (i / 12) * Math.PI * 2;
  c.y = i * 0.18;
  const p = new Vector3().setFromCylindrical(c);
  spawn.mesh(world, { geometry: { box: 0.3 }, material: '#9acd32', position: [p.x, p.y, p.z] });
}
engine.start();
```

## Euler
用三個角度（弧度）表示旋轉。`order` 決定旋轉的順序。

```ts
const e = new Euler(0, Math.PI / 2, 0); // 繞 Y 軸轉 90 度
const forward = new Vector3(0, 0, -1).applyEuler(e);
console.log('原本朝 -Z，轉了之後朝：', forward.round());
console.log('順序：', e.order, '，換成四元數：', new Quaternion().setFromEuler(e));
```

## Line3
3D 線段：求線段上最接近某個點的位置、線段長度。

```ts
const wall = new Line3(new Vector3(-2, 0, 0), new Vector3(2, 0, 0));
const player = new Vector3(1, 0, 3);
const closest = wall.closestPointToPoint(player, true, new Vector3());
console.log('牆的長度：', wall.distance(), '，離玩家最近的點：', closest);
console.log('距離：', closest.distanceTo(player).toFixed(2));
```

## Matrix3
3×3 矩陣：常用在 2D 變換（平移、旋轉、縮放）或法線矩陣。

```ts
const m = new Matrix3().makeRotation(Math.PI / 2); // 2D 旋轉 90 度
const p = new Vector2(1, 0).applyMatrix3(m);
console.log('(1, 0) 轉 90 度：', p.x.toFixed(2), p.y.toFixed(2));
console.log('行列式：', m.determinant().toFixed(2));
```

## Matrix4
4×4 矩陣：3D 的位置、旋轉、縮放合在一起。`compose`／`decompose` 互相轉換。

```ts
const m = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI), new Vector3(2, 2, 2));
const pos = new Vector3();
const rot = new Quaternion();
const scale = new Vector3();
m.decompose(pos, rot, scale);
console.log('位置', pos, '縮放', scale);
console.log('把 (1, 0, 0) 轉到世界：', new Vector3(1, 0, 0).applyMatrix4(m).round());
```

## Path
穿過幾個點的平滑曲線：`pointAt(t)` 位置、`tangentAt(t)` 方向，t 依實際距離，速度均勻。用 lil-gui 調整彎曲程度與速度。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 8, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
const points: PathPoint[] = [[-3, 0.3, -2], [0, 0.3, -3], [3, 0.3, -1], [2, 0.3, 2], [-2, 0.3, 2]];
const params = { tension: 0.5, speed: 2 };
let path = new Path(points, { closed: true, tension: params.tension });
const ball = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ffd166' });
let distance = 0;
engine.on('update', (time) => {
  distance += time.delta * params.speed;
  path.pointAtDistance(distance, world.require(ball, Transform).position);
  render.debug.path(path.sample(80), { closed: true, color: '#4cc9f0' });
});
const gui = new GUI();
gui.add(params, 'tension', 0, 1, 0.05).name('彎曲程度').onChange((v: number) => (path = new Path(points, { closed: true, tension: v })));
gui.add(params, 'speed', 0.5, 6, 0.1).name('速度（公尺／秒）');
engine.start();
```

## Plane
無限大的平面：點到平面的距離、射線和平面的交點（例如滑鼠點到地面的位置）。

```ts
const ground = new Plane(new Vector3(0, 1, 0), 0); // y = 0 的地面
console.log('(0, 3, 0) 到地面的距離：', ground.distanceToPoint(new Vector3(0, 3, 0)));
const ray = new Ray(new Vector3(0, 5, 5), new Vector3(0, -1, -1).normalize());
console.log('射線打到地面的位置：', ray.intersectPlane(ground, new Vector3()));
```

## Quaternion
四元數表示旋轉，不會有萬向鎖；`slerp` 在兩個旋轉之間平滑內插。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: [1.4, 0.4, 0.8] }, material: '#9acd32' });
const from = new Quaternion();
const to = new Quaternion().setFromEuler(new Euler(Math.PI / 3, Math.PI, 0));
engine.on('update', (time) => {
  const t = (Math.sin(time.elapsed) + 1) / 2;
  world.require(box, Transform).rotation.slerpQuaternions(from, to, t);
});
engine.start();
```

## Random
可以重現的亂數：同一個種子每次結果都一樣（關卡生成、重播）。

```ts
const rng = new Random('dungeon-1');
console.log('擲骰子：', Array.from({ length: 5 }, () => rng.int(1, 6)).join(' '));
console.log('寶箱：', rng.weighted([['普通', 80], ['稀有', 15], ['傳說', 5]]));
console.log('隊伍順序：', rng.shuffle(['劍士', '法師', '弓手', '牧師']).join('、'));
const again = new Random('dungeon-1');
console.log('同一個種子再擲一次：', Array.from({ length: 5 }, () => again.int(1, 6)).join(' '));
```

## Ray
射線（起點加方向）：判斷打不打得到球、離某個點多近。

```ts
const ray = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
const target = new Sphere(new Vector3(5, 0.5, 0), 1);
console.log('打得到球嗎？', ray.intersectsSphere(target));
console.log('打到的位置：', ray.intersectSphere(target, new Vector3()));
console.log('前進 3 公尺的位置：', ray.at(3, new Vector3()));
```

## Sphere
球形範圍：包住一群點、判斷兩個範圍有沒有碰到。

```ts
const points = [new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(1, 1, 0)];
const bounds = new Sphere().setFromPoints(points);
console.log('包住所有點的球：中心', bounds.center, '半徑', bounds.radius.toFixed(2));
console.log('(5, 0, 0) 在裡面嗎？', bounds.containsPoint(new Vector3(5, 0, 0)));
```

## Spherical
球座標（距離、上下角、左右角）：繞著目標轉的攝影機常用。

```ts
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f' });
const camera = spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
const orbit = new Spherical(5, Math.PI / 3, 0);
engine.on('update', (time) => {
  orbit.theta = time.elapsed * 0.6;
  const t = world.require(camera, Transform);
  t.position.setFromSpherical(orbit);
  math.lookAt(t, new Vector3(0, 0, 0));
});
engine.start();
```

## Triangle
三角形：面積、法線、判斷點在不在三角形裡。

```ts
const tri = new Triangle(new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(0, 3, 0));
console.log('面積：', tri.getArea());
console.log('法線：', tri.getNormal(new Vector3()));
console.log('(1, 1, 0) 在裡面嗎？', tri.containsPoint(new Vector3(1, 1, 0)));
```

## Vector2
2D 向量：位置、速度、方向（介面、2D 遊戲、搖桿輸入）。

```ts
const a = new Vector2(3, 4);
console.log('長度：', a.length());
console.log('單位向量：', a.clone().normalize());
console.log('角度（度）：', MathUtils.radToDeg(a.angle()).toFixed(1));
console.log('和 (1, 0) 的距離：', a.distanceTo(new Vector2(1, 0)).toFixed(2));
```

## Vector3
3D 向量：位置、速度、方向。這裡讓球朝著目標移動，並畫出方向。

```ts
spawn.camera(world, { position: [0, 6, 7], target: [0, 0, 0] });
spawn.defaultLights(world);
const ball = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#4cc9f0', position: [-3, 0.3, 0] });
const target = new Vector3(3, 0.3, -2);
spawn.mesh(world, { geometry: { box: 0.3 }, material: '#ff6b6b', position: [target.x, target.y, target.z] });
engine.on('update', (time) => {
  const pos = world.require(ball, Transform).position;
  const dir = target.clone().sub(pos);
  if (dir.length() > 0.05) pos.addScaledVector(dir.normalize(), time.delta * 1.5);
  render.debug.ray(pos, dir, 1, { color: '#ffd166' });
});
engine.start();
```

## Vector4
4D 向量：常用在著色器的 uniform（例如 RGBA 顏色、矩形範圍）。

```ts
const rect = new Vector4(10, 20, 300, 200); // x, y, 寬, 高
console.log('寬高：', rect.z, rect.w);
const rgba = new Vector4(1, 0.5, 0, 1).multiplyScalar(0.5);
console.log('變暗一半：', rgba.toArray());
```

## MathUtils
常用的數學小工具：限制範圍、內插、角度轉換、平滑。

```ts
console.log('clamp(15, 0, 10)：', MathUtils.clamp(15, 0, 10));
console.log('lerp(0, 100, 0.25)：', MathUtils.lerp(0, 100, 0.25));
console.log('90 度 = ', MathUtils.degToRad(90).toFixed(4), '弧度');
console.log('smoothstep：', [0, 0.25, 0.5, 0.75, 1].map((x) => MathUtils.smoothstep(x, 0, 1).toFixed(2)).join(' '));
```

## CurvePathOptions
`Path` 的設定：`closed` 頭尾相連，`tension` 決定彎曲程度。

```ts
const points: PathPoint[] = [[0, 0, 0], [2, 0, 2], [4, 0, 0]];
for (const tension of [0, 0.5, 1]) {
  const options: CurvePathOptions = { tension };
  console.log(`tension ${tension}：全長 ${new Path(points, options).length.toFixed(3)}`);
}
console.log('closed：全長', new Path(points, { closed: true }).length.toFixed(3));
```

## ColorRepresentation
顏色可以用 Color、'#rrggbb' 文字或數字表示，引擎的參數大多接受這三種。

```ts
const colors: ColorRepresentation[] = ['#ff8800', 0x00ccff, new Color('hotpink')];
for (const c of colors) console.log(String(c), '→ #' + new Color(c).getHexString());
```

## EulerOrder
尤拉角的旋轉順序：同樣的三個角度，順序不同結果就不同。

```ts
const orders: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY'];
for (const order of orders) {
  const v = new Vector3(0, 0, -1).applyEuler(new Euler(Math.PI / 4, Math.PI / 4, 0, order));
  console.log(order, '→', v.x.toFixed(2), v.y.toFixed(2), v.z.toFixed(2));
}
```

## PathPoint
`Path` 的點可以是 Vector3、[x, y, z] 或 { x, y, z }。

```ts
const points: PathPoint[] = [new Vector3(0, 0, 0), [1, 0, 1], { x: 2, y: 0, z: 0 }];
const path = new Path(points);
console.log('經過的點：', path.points.map((p) => p.toArray().join(',')).join(' → '));
```
