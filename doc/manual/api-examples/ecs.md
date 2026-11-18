# @engine/ecs 的範例

## ComponentStore
每種元件的資料存在一個 ComponentStore 裡（連續的陣列，走訪很快）。一般不直接用它，這裡示範它怎麼存放資料。

```ts
const store = new ComponentStore<{ hp: number }>();
const a = world.create();
const b = world.create();
store.set(a, { hp: 100 });
store.set(b, { hp: 40 });
console.log('數量：', store.size, '，a 的血量：', store.get(a)?.hp);
store.delete(a);
console.log('刪掉 a 之後還有：', store.size, '個；a 還在嗎？', store.has(a));
```

## EcsPlugin
ECS 外掛把 World 和系統接到主迴圈：`each` 是最常用的系統（每幀處理符合條件的實體）。

```ts
const Spin = define.component('Spin', () => ({ speed: 1 }));
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 5; i++) {
  const e = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#9acd32', position: [i * 1.2 - 2.4, 0, 0] });
  world.add(e, Spin, { speed: 0.5 + i * 0.5 });
}
ecs.each('spin', [Transform, Spin], (_e, t, s, time) => math.rotate(t, [0, s.speed * time.delta, 0]));
engine.timers.after(2, () => {
  ecs.setEnabled('spin', false);
  console.log('2 秒後暫停 spin 系統：', ecs.isEnabled('spin'));
});
engine.start();
```

## EventBus
事件（`world.events`）：一個地方發出、好幾個地方收聽，彼此不用互相知道。

```ts
const Scored = define.event<{ points: number }>('Scored');
let total = 0;
world.events.on(Scored, (e) => (total += e.points));
world.events.on(Scored, (e) => console.log('得分 +', e.points, '，總分', total));
world.events.once(Scored, () => console.log('（第一次得分！）'));
world.events.emit(Scored, { points: 10 });
world.events.emit(Scored, { points: 5 });
console.log('收聽數：', world.events.listenerCount(Scored));
```

## Query
查詢：找出「有這些元件、沒有那些元件」的實體。同樣的條件會共用快取，元件增減時自動更新。

```ts
const Health = define.component('Health', () => ({ hp: 100 }));
const Dead = define.tag('Dead');
for (let i = 0; i < 4; i++) world.spawn(Health.with({ hp: i * 30 }));
const alive = world.query([Health], { none: [Dead] });
alive.each((e, h) => {
  if (h.hp === 0) world.add(e, Dead);
});
console.log('活著的：', alive.size, '個');
for (const e of alive) console.log('  血量', world.require(e, Health).hp);
```

## World
世界存放所有實體、元件與資源。實體只是一個編號，資料都在元件裡。

```ts
const Position = define.component('Position', () => ({ x: 0, y: 0 }));
const Velocity = define.component('Velocity', () => ({ x: 0, y: 0 }));
const ball = world.spawn(Position, Velocity.with({ x: 2, y: 1 }));
for (let i = 0; i < 3; i++) {
  const p = world.require(ball, Position);
  const v = world.require(ball, Velocity);
  p.x += v.x;
  p.y += v.y;
}
console.log('三步之後的位置：', world.get(ball, Position));
console.log('實體數量：', world.entityCount, '，有 Velocity 嗎？', world.has(ball, Velocity));
world.destroy(ball);
console.log('銷毀之後還在嗎？', world.isAlive(ball));
```

## define
定義元件、標籤、資源與事件（ECS 的部分）。

```ts
const Speed = define.component('Speed', () => ({ value: 3 }));
const Player = define.tag('Player');
const Settings = define.resource<{ volume: number }>('Settings');
const LevelUp = define.event<{ level: number }>('LevelUp');

const hero = world.spawn(Player, Speed.with({ value: 5 }));
world.setResource(Settings, { volume: 0.8 });
world.events.on(LevelUp, (e) => console.log('升級到', e.level));
world.events.emit(LevelUp, { level: 2 });
console.log('速度', world.require(hero, Speed).value, '，音量', world.requireResource(Settings).volume);
```

## entityId
實體編號由「索引」和「世代」組成：同一個索引被重複使用時世代會增加，舊的編號就不會誤指到新的實體。

```ts
const a = world.create();
console.log('a：索引', entityId.index(a), '世代', entityId.generation(a));
world.destroy(a);
const b = world.create(); // 重複使用同一個索引
console.log('b：索引', entityId.index(b), '世代', entityId.generation(b));
console.log('舊的 a 還在嗎？', world.isAlive(a), '（和 b 不會搞混）');
```

## NULL_ENTITY
代表「沒有實體」，例如還沒選取任何東西。

```ts
let selected: Entity = NULL_ENTITY;
console.log('有選取嗎？', selected !== NULL_ENTITY);
selected = world.create();
console.log('選取之後：', selected !== NULL_ENTITY, world.isAlive(selected));
```

## ComponentType
`define.component` 回傳的元件類型：`with()` 指定初始值，`create()` 建立預設值。

```ts
const Stats: ComponentType<{ atk: number; def: number }> = define.component('Stats', () => ({ atk: 10, def: 5 }));
console.log('名稱：', Stats.name, '，預設值：', Stats.create());
const e = world.spawn(Stats.with({ atk: 25 }));
console.log('實體的資料（def 用預設值）：', world.require(e, Stats));
```

## EventOptions
`events.on` 的設定：`once` 只收一次；`owner` 綁定擁有者，實體銷毀時自動取消。

```ts
const Ping = define.event('Ping');
const listener = world.create();
const options: EventOptions = { owner: listener };
world.events.on(Ping, () => console.log('收到 Ping'), options);
world.events.emit(Ping);
world.destroy(listener); // 擁有者銷毀：收聽自動取消
world.events.emit(Ping);
console.log('剩下的收聽：', world.events.listenerCount(Ping));
```

## EventType
`define.event` 建立的事件種類；泛型是事件內容的型別（沒有內容時用 void）。

```ts
const Damage: EventType<{ amount: number }> = define.event<{ amount: number }>('Damage');
const GameOver: EventType = define.event('GameOver');
world.events.on(Damage, (e) => console.log(Damage.name, e.amount));
world.events.on(GameOver, () => console.log(GameOver.name));
world.events.emit(Damage, { amount: 7 });
world.events.emit(GameOver);
```

## QueryOptions
查詢的設定：`none` 排除擁有這些元件的實體。

```ts
const Enemy = define.tag('Enemy');
const Boss = define.tag('Boss');
world.spawn(Enemy);
world.spawn(Enemy);
world.spawn(Enemy, Boss);
const options: QueryOptions = { none: [Boss] };
console.log('所有敵人：', world.query([Enemy]).size, '，不含頭目：', world.query([Enemy], options).size);
```

## ResourceKey
資源是全域唯一的資料（不屬於任何實體），用 `define.resource` 建立的鍵存取。

```ts
const Score: ResourceKey<{ value: number }> = define.resource<{ value: number }>('Score');
world.setResource(Score, { value: 0 });
world.requireResource(Score).value += 50;
console.log(Score.name, '=', world.getResource(Score)?.value);
world.removeResource(Score);
console.log('移除之後：', world.getResource(Score));
```

## System
系統：所有行為都寫在系統裡。可以指定階段、順序，以及加入／移除時的初始化與清理。

```ts
const Lifetime = define.component('Lifetime', () => ({ seconds: 1 }));
const expire: System = {
  name: 'expire',
  phase: 'update',
  init: () => console.log('expire 系統開始'),
  run(w, time) {
    w.query([Lifetime]).each((e, life) => {
      life.seconds -= time.delta;
      if (life.seconds <= 0) {
        w.defer(() => w.destroy(e));
        console.log('實體', entityId.index(e), '時間到，銷毀');
      }
    });
  },
};
ecs.addSystem(expire);
world.spawn(Lifetime.with({ seconds: 0.5 }));
world.spawn(Lifetime.with({ seconds: 1.5 }));
engine.start();
```

## ComponentInit
`world.spawn` 的參數：只給元件類型（用預設值），或用 `with` 給初始值。

```ts
const Name = define.component('Label', () => ({ text: '無名' }));
const Hp = define.component('Hp', () => ({ value: 100 }));
const parts: ComponentInit[] = [Name.with({ text: '史萊姆' }), Hp];
const e = world.spawn(...parts);
console.log(world.require(e, Name).text, world.require(e, Hp).value);
```

## ComponentValues
把元件類型的清單轉成資料型別的清單（查詢、`each` 的參數就是這樣算出來的）。

```ts
const A = define.component('A', () => ({ a: 1 }));
const B = define.component('B', () => ({ b: 'x' }));
const values: ComponentValues<[typeof A, typeof B]> = [{ a: 2 }, { b: 'y' }];
console.log('A 的值：', values[0].a, '，B 的值：', values[1].b);
world.spawn(A, B.with({ b: 'z' }));
world.query([A, B]).each((_e, a, b) => console.log('查詢拿到：', a.a, b.b));
```

## Entity
實體只是一個數字編號（型別上和一般數字分開，避免拿錯）。

```ts
const e: Entity = world.create();
console.log('實體編號：', e, '，型別是 number：', typeof e);
console.log('還在嗎？', world.isAlive(e));
```
