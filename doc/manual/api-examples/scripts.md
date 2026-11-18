# @engine/scripts 的範例

## Script
行為腳本：用類別替實體寫行為。只要寫需要的生命週期方法（onStart、onUpdate、onClick…）。欄位可以在加上腳本時設定。點方塊讓它跳一下、變色。

```ts
class Spinner extends Script {
  speed = 1;
  private hue = 0;
  onStart() {
    console.log('Spinner 開始，速度', this.speed);
  }
  onUpdate(dt: number) {
    math.rotate(this.transform, [0, this.speed * dt, 0]);
  }
  async onClick() {
    this.hue = (this.hue + 0.15) % 1;
    this.require(MeshRenderer).material = `hsl(${Math.round(this.hue * 360)}, 70%, 60%)`;
    this.tweens.to(this.transform.position, { y: 1 }, { duration: 0.2, yoyo: true, repeat: 1 });
    await this.wait(0.4);
    console.log('跳完了');
  }
}
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 3; i++) {
  const e = spawn.mesh(world, { geometry: { box: 0.8 }, material: '#9acd32', position: [i * 1.5 - 1.5, 0, 0] });
  scripts.add(e, Spinner, { speed: (i + 1) * 0.8 });
}
engine.start();
```

## ScriptPlugin
腳本外掛（手冊的 `scriptPlugin` 已經裝好）；`scriptPlugin.runner` 就是 `scripts`。

```ts
console.log('外掛：', scriptPlugin.name, '，依賴：', scriptPlugin.dependencies);
console.log('同一個執行器：', scriptPlugin.runner === scripts, '，目前腳本數：', scripts.count);
```

## ScriptRunner
腳本執行器（`scripts`）：加上、取得、移除腳本，依名稱找實體，呼叫同名方法。

```ts
class Health extends Script {
  hp = 3;
  takeDamage(n: number) {
    this.hp -= n;
    console.log(this.find('Hero') === this.entity ? '主角' : '?', '受到', n, '傷害，剩', this.hp);
    if (this.hp <= 0) this.destroy();
  }
  onDestroy() {
    console.log('倒下了');
  }
}
const hero = world.spawn(Name.with({ value: 'Hero' }), Transform);
scripts.add(hero, Health, { hp: 2 });
scripts.sendMessage(scripts.find('Hero')!, 'takeDamage', 1);
console.log('取得腳本：', scripts.get(hero, Health)?.hp, '，身上的腳本數：', scripts.getAll(hero).length);
scripts.sendMessage(hero, 'takeDamage', 1);
engine.start();
```

## Name
實體名稱：`scripts.find('名稱')`、腳本裡的 `this.find('名稱')` 用它找實體。

```ts
world.spawn(Name.with({ value: 'Door' }), Transform);
const door = scripts.find('Door');
console.log('找到 Door：', door !== undefined, '，名稱：', door && world.require(door, Name).value);
```

## SCRIPT_FIXED_PRIORITY
腳本的 onFixedUpdate 在物理更新之前執行，在這裡施的力這一步就生效。

```ts
console.log('onFixedUpdate 的順序：', SCRIPT_FIXED_PRIORITY, '（物理是 100）');
```

## SCRIPT_LATE_PRIORITY
腳本的 onLateUpdate 在物理寫回位置之後、變換計算之前，適合攝影機跟隨。

```ts
console.log('onLateUpdate 的順序：', SCRIPT_LATE_PRIORITY, '（物理寫回 900、變換計算', TRANSFORM_PRIORITY, '）');
```

## SCRIPT_UPDATE_PRIORITY
腳本的 onUpdate 和一般系統同一層（0）。用 `static executionOrder` 決定腳本之間的順序。

```ts
class First extends Script {
  static executionOrder = -1;
  onUpdate() {
    if (engine.time.frame === 1) console.log('First（executionOrder -1）');
  }
}
class Second extends Script {
  onUpdate() {
    if (engine.time.frame === 1) console.log('Second（executionOrder 0）');
  }
}
const e = world.spawn(Transform);
scripts.add(e, Second);
scripts.add(e, First);
console.log('onUpdate 的順序：', SCRIPT_UPDATE_PRIORITY);
engine.start();
```

## ScriptList
場景檔裡要掛的腳本（名稱 → 參數）。先用 `scripts.register` 登記名稱，載入場景時會自動加上。

```ts
class Bob extends Script {
  height = 0.5;
  onUpdate() {
    this.transform.position.y = Math.sin(engine.time.elapsed * 3) * this.height;
  }
}
scripts.register({ Bob });
spawn.camera(world, { position: [0, 1, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const file = parseSceneFile({
  format: 'hero-scene',
  version: 1,
  entities: [
    {
      id: 'ball',
      components: {
        Transform: {},
        MeshRenderer: { geometry: { sphere: 0.5 }, material: '#ff6b6b' },
        ScriptList: { Bob: { height: 1 } },
      },
    },
  ],
});
const ball = spawnSceneFile(world, file).entities.get('ball')!;
console.log('ScriptList：', world.require(ball, ScriptList).scripts, '，腳本：', scripts.getAll(ball).length, '個');
engine.start();
```

## scriptListCodec
ScriptList 在場景檔裡的寫法：`{ 腳本名稱: { 參數… } }`。

```ts
console.log(scriptListCodec.write({ scripts: { Rotator: { speed: 2 }, Health: {} } }));
```

## Scripts
實體上實際的腳本實例（由執行器管理，用 `scripts.add`／`remove` 修改）。

```ts
class A extends Script {}
class B extends Script {}
const e = world.spawn(Transform);
scripts.add(e, A);
scripts.add(e, B);
console.log('腳本：', world.require(e, Scripts).list.map((s) => s.constructor.name));
scripts.remove(e, A);
console.log('移除 A 之後：', world.require(e, Scripts).list.map((s) => s.constructor.name));
```

## ScriptsKey
系統裡用 `world.requireResource(ScriptsKey)` 取得腳本執行器。

```ts
console.log('和 scripts 同一個：', world.requireResource(ScriptsKey) === scripts);
```

## ScriptListData
ScriptList 的資料：腳本名稱 → 參數（只寫和預設值不同的）。

```ts
const data: ScriptListData = { scripts: { Patrol: { speed: 3, loop: true } } };
const e = world.spawn(Transform, ScriptList.with(data));
console.log(world.require(e, ScriptList).scripts);
```

## ScriptRunnerOptions
執行器的設定：`rethrow: true` 時腳本錯誤直接丟出（測試用）；預設記錄錯誤、其他腳本照常執行。

```ts
class Broken extends Script {
  onStart() {
    throw new Error('壞掉了');
  }
}
const options: ScriptRunnerOptions = { rethrow: true };
const strict = new ScriptRunner(world, engine, options);
try {
  strict.add(world.spawn(Transform), Broken);
  strict.fixedUpdate(0);
  engine.start();
} catch (error) {
  console.log('丟出：', (error as Error).message);
}
strict.dispose();
console.log('預設（rethrow: false）只會記錄錯誤，不會中斷遊戲');
```

## ScriptClass
腳本類別的型別（建構式不能有參數）。用來寫「接受任何腳本類別」的函式。

```ts
class Coin extends Script {}
class Gem extends Script {}
function spawnWith(cls: ScriptClass): Entity {
  const e = world.spawn(Transform);
  scripts.add(e, cls);
  return e;
}
const list: ScriptClass[] = [Coin, Gem];
for (const cls of list) console.log(cls.name, '→ 實體', spawnWith(cls));
```
