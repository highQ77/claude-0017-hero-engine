# @engine/core 的範例

## Engine
引擎是整個遊戲的核心：安裝外掛、啟動主迴圈、暫停與恢復。手冊的 `engine` 已經裝好所有外掛；這裡在畫面上放一個會轉的方塊，並用引擎事件印出狀態變化。點畫面暫停、再點一次繼續。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32' });

engine.addListener('pause', () => console.log('暫停，狀態：', engine.state));
engine.addListener('resume', () => console.log('繼續，狀態：', engine.state));
engine.on('update', (time) => math.rotate(world.require(box, Transform), [0, time.delta, 0]));
addEventListener('pointerdown', () => (engine.state === 'running' ? engine.pause() : engine.resume()));

engine.start();
console.log('狀態：', engine.state, '，外掛數：', ['ecs', 'render', 'physics'].filter((n) => engine.hasPlugin(n)).length);
```

## Loop
主迴圈依階段（input → fixedUpdate → update → lateUpdate → render）呼叫回呼。這裡用一個獨立的 `Loop` 手動推進三幀，看看每個階段的執行順序，以及固定步長的累積。

```ts
const time = new Time(1 / 60, 1);
const loop = new Loop(time, { maxFixedSteps: 5, maxDelta: 0.25 });
for (const phase of PHASES) loop.on(phase, () => console.log(`幀 ${time.frame}：${phase}`));
loop.step(1 / 60);
loop.step(1 / 30); // 這一幀比較久：fixedUpdate 會補跑兩次
console.log('固定步長：', time.fixedDelta.toFixed(4), '秒');
```

## Pool
物件池重複使用物件，避免一直建立、丟掉（子彈、特效）。`acquire` 拿一個、`release` 放回去。

```ts
let made = 0;
const bullets = new Pool({ create: () => ({ id: ++made, x: 0 }), onRelease: (b) => (b.x = 0) });
const a = bullets.acquire();
const b = bullets.acquire();
bullets.release(a);
const c = bullets.acquire(); // 拿到的是剛放回去的 a
console.log('c 就是 a：', c === a, '，建立過', made, '個，使用中', bullets.inUse, '個');
console.log('b 的編號：', b.id);
```

## SaveError
讀到壞掉或版本不對的存檔時會丟出 `SaveError`，`slot` 是出問題的存檔欄位。

```ts
const storage = memoryStorage();
storage.setItem('demo/slot1', '這不是 JSON');
const save = createSave({ name: 'demo', storage });
try {
  save.read('slot1');
} catch (error) {
  if (error instanceof SaveError) console.log('存檔壞了：', error.slot, error.message);
}
```

## SaveFile
`createSave` 建立的存檔：寫入、讀取、列出、刪除。這裡用記憶體當儲存空間，重新整理不會留下資料。

```ts
const save = createSave<{ level: number; coins: number }>({ name: 'my-game', storage: memoryStorage() });
save.write('slot1', { level: 3, coins: 120 });
save.write('auto', { level: 4, coins: 80 });
console.log('讀取：', save.read('slot1'));
console.log('所有存檔：', save.list().map((s) => s.slot));
save.remove('auto');
console.log('還有 auto 嗎？', save.has('auto'));
```

## Time
`engine.time` 提供每幀的間隔、經過時間與時間縮放。這裡讓方塊用 `time.delta` 轉動，並用 lil-gui 調整 `timeScale`（0.2 是慢動作）。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: 1 }, material: '#4cc9f0' });
engine.on('update', (time) => math.rotate(world.require(box, Transform), [0, time.delta * 2, 0]));
engine.timers.every(1, () => console.log(`經過 ${engine.time.elapsed.toFixed(1)} 秒，FPS ${Math.round(engine.time.fps)}`), { realtime: true });

const gui = new GUI();
gui.add(engine.time, 'timeScale', 0, 2, 0.1).name('時間縮放');
engine.start();
```

## Timers
`engine.timers.after` 幾秒後執行一次，`every` 每隔幾秒執行；回傳的計時器可以取消。

```ts
let n = 0;
const tick = engine.timers.every(0.5, () => console.log('滴答', ++n));
engine.timers.after(2.2, () => {
  tick.cancel();
  console.log('停止，還在等的計時器：', engine.timers.count);
});
engine.start();
```

## createLogger
每個模組建立自己的記錄器，訊息前面會加上模組名稱；可以用 `setLogLevel` 決定要顯示到哪個等級。

```ts
const log = createLogger('inventory');
log.info('撿到', 3, '個金幣');
log.warn('背包快滿了');
log.debug('這行預設不顯示（等級是 debug）');
```

## createPool
`createPool` 和 `new Pool` 一樣，比較好讀。`prewarm` 先建立幾個，遊戲中途就不會卡一下。

```ts
const pool = createPool({ create: () => ({ hp: 100 }), max: 10 });
pool.prewarm(5);
console.log('閒置', pool.free, '個');
const enemy = pool.acquire();
console.log('拿出一個之後：閒置', pool.free, '個，使用中', pool.inUse, '個', enemy);
```

## createSave
建立存檔。`version` 改了之後，用 `migrate` 把舊存檔轉成新格式。

```ts
const storage = memoryStorage();
createSave({ name: 'rpg', version: 1, storage }).write('slot1', { gold: 50 });

// 新版：gold 改名成 coins
const save = createSave<{ coins: number }>({
  name: 'rpg',
  version: 2,
  storage,
  migrate: (data, from) => (from === 1 ? { coins: (data as { gold: number }).gold } : (data as { coins: number })),
});
console.log('讀到舊存檔（自動轉換）：', save.read('slot1'));
```

## getLogLevel
取得目前的最低記錄等級。

```ts
console.log('目前的等級：', getLogLevel());
setLogLevel('warn');
console.log('改成：', getLogLevel());
```

## memoryStorage
只存在記憶體裡的儲存空間：測試、或瀏覽器不能用 localStorage 時使用。

```ts
const storage = memoryStorage();
storage.setItem('a', '1');
storage.setItem('b', '2');
console.log('所有的鍵：', storage.keys(), '，a =', storage.getItem('a'));
storage.removeItem('a');
console.log('刪掉 a 之後：', storage.keys());
```

## onLog
收到每一則記錄（例如顯示在遊戲裡的除錯視窗）。回傳取消的函式。

```ts
const off = onLog((entry) => console.log(`[收到] ${entry.level} ${entry.module}：`, ...entry.args));
const log = createLogger('shop');
log.info('買了一把劍');
log.error('金幣不夠');
off();
log.info('取消之後就收不到了');
```

## setLogLevel
設定全域的最低等級：`'debug'` 顯示全部，`'silent'` 全部不顯示。

```ts
const log = createLogger('demo');
setLogLevel('debug');
log.debug('現在看得到 debug 訊息');
setLogLevel('error');
log.warn('這則警告不會顯示');
log.error('只顯示錯誤');
setLogLevel('info');
```

## browserScheduler
瀏覽器的排程（requestAnimationFrame），引擎預設用它推進每一幀。也可以自己用來排下一幀。

```ts
const start = browserScheduler.now();
browserScheduler.request(() => console.log(`下一幀在 ${(browserScheduler.now() - start).toFixed(1)} 毫秒後`));
const id = browserScheduler.request(() => console.log('這個被取消了，不會印出'));
browserScheduler.cancel(id);
```

## create
`create` 是建立物件的小工具分類（core 的部分：設定、記錄器、物件池、存檔）。

```ts
const config = create.config({ timeScale: 0.5 });
console.log('時間縮放：', config.timeScale, '，固定步長：', config.fixedDelta.toFixed(4));
const pool = create.pool({ create: () => ({}) });
console.log('物件池閒置：', pool.free);
create.logger('demo').info('用 create.logger 建立的記錄器');
```

## DEFAULT_CONFIG
預設的引擎設定。`new Engine({ … })` 沒寫的欄位用這些值。

```ts
console.log(DEFAULT_CONFIG);
console.log('預設每秒固定步長次數：', Math.round(1 / DEFAULT_CONFIG.fixedDelta));
```

## ENGINE_VERSION
引擎的版本；套件用 `engine: '^0.1.0'` 宣告相容的範圍。

```ts
console.log('Hero Engine 版本：', ENGINE_VERSION);
```

## PHASES
每一幀依序執行的更新階段。系統、`engine.on` 都是註冊到其中一個階段。

```ts
PHASES.forEach((phase, i) => console.log(i + 1, phase));
```

## EngineConfig
引擎的全域設定，`engine.config` 可以讀到目前的值。

```ts
const config: EngineConfig = engine.config;
console.log('固定步長', config.fixedDelta.toFixed(4), '秒；分頁隱藏時暫停：', config.pauseOnHidden);
```

## EngineOptions
`new Engine(options)` 的設定：EngineConfig 的任何欄位，加上可以替換的排程器。

```ts
const options: EngineOptions = { timeScale: 0.5, pauseOnHidden: false };
const myEngine = new Engine(options);
console.log('時間縮放：', myEngine.time.timeScale, '，狀態：', myEngine.state);
myEngine.destroy();
```

## EveryOptions
`timers.every` 的設定：`immediate: true` 一開始就先執行一次。

```ts
const options: EveryOptions = { immediate: true };
let n = 0;
const t = engine.timers.every(1, () => console.log('第', ++n, '次'), options);
engine.timers.after(2.5, () => t.cancel());
engine.start();
```

## LogEntry
`onLog` 收到的一則記錄：等級、模組、內容。

```ts
onLog((entry: LogEntry) => console.log(`等級=${entry.level} 模組=${entry.module} 內容=`, entry.args));
createLogger('save').warn('存檔空間快滿了', { used: 0.9 });
```

## Logger
記錄器有 debug、info、warn、error 四個等級。

```ts
const log: Logger = createLogger('network');
console.log('模組：', log.module);
log.info('連線成功');
log.warn('延遲 300ms');
log.error('斷線');
```

## LoopOptions
`new Loop` 的設定：每幀最多補跑幾次固定步長、每幀最長的時間。

```ts
const options: LoopOptions = { maxFixedSteps: 2, maxDelta: 0.1 };
const time = new Time(1 / 60, 1);
const loop = new Loop(time, options);
let fixed = 0;
loop.on('fixedUpdate', () => fixed++);
loop.step(1); // 卡了一秒：最多只算 0.1 秒、補跑 2 次
console.log('fixedUpdate 執行了', fixed, '次');
```

## Plugin
外掛有名稱、依賴，以及 install／uninstall。這裡寫一個每秒印出幀數的外掛。

```ts
class FpsLogger implements Plugin {
  readonly name = 'fps-logger';
  private off: (() => void) | null = null;
  install(engine: Engine): void {
    this.off = engine.timers.every(1, () => console.log('FPS', Math.round(engine.time.fps))).cancel;
  }
  uninstall(): void {
    this.off?.();
  }
}
engine.use(new FpsLogger());
console.log('裝好了嗎？', engine.hasPlugin('fps-logger'));
engine.start();
```

## PoolOptions
物件池的設定：建立、拿出來、放回去、上限與丟掉。

```ts
const options: PoolOptions<{ active: boolean }> = {
  create: () => ({ active: false }),
  onAcquire: (o) => (o.active = true),
  onRelease: (o) => (o.active = false),
  max: 2,
  destroy: () => console.log('超過上限，丟掉一個'),
};
const pool = createPool(options);
const items = [pool.acquire(), pool.acquire(), pool.acquire()];
for (const item of items) pool.release(item);
console.log('閒置', pool.free, '個（上限 2）');
```

## SaveInfo
`save.list()` 回傳的每個存檔資訊：欄位、存檔時間、版本。

```ts
const save = createSave({ name: 'demo', storage: memoryStorage() });
save.write('slot1', { hp: 10 });
for (const info of save.list() as SaveInfo[])
  console.log(info.slot, '存於', info.savedAt.toLocaleTimeString(), '版本', info.version);
```

## SaveOptions
存檔的設定：遊戲名稱、版本、轉換、檢查、儲存空間。`validate` 回傳 false 時讀取會失敗。

```ts
const options: SaveOptions<{ hp: number }> = {
  name: 'demo',
  storage: memoryStorage(),
  validate: (d) => typeof (d as { hp?: unknown }).hp === 'number',
};
const save = createSave(options);
save.write('ok', { hp: 5 });
console.log('讀取：', save.read('ok'));
```

## SaveStorage
自己提供儲存空間（例如存到伺服器、或桌面版的檔案）。這裡用 Map 實作一個。

```ts
const map = new Map<string, string>();
const storage: SaveStorage = {
  getItem: (k) => map.get(k) ?? null,
  setItem: (k, v) => void map.set(k, v),
  removeItem: (k) => void map.delete(k),
  keys: () => [...map.keys()],
};
createSave({ name: 'custom', storage }).write('slot1', { level: 2 });
console.log('存到 Map 裡的鍵：', storage.keys());
```

## Scheduler
排程器決定「下一幀」什麼時候來。測試時可以換成手動推進的排程器。

```ts
const queue: ((now: number) => void)[] = [];
let now = 0;
const manual: Scheduler = { request: (cb) => queue.push(cb), cancel: () => {}, now: () => now };
const myEngine = new Engine({ scheduler: manual, pauseOnHidden: false });
myEngine.on('update', (t) => console.log('第', t.frame, '幀，經過', t.elapsed.toFixed(3), '秒'));
myEngine.start();
for (let i = 0; i < 3; i++) {
  now += 16;
  queue.shift()?.(now);
}
myEngine.destroy();
```

## TimerHandle
`after`、`every` 回傳的計時器：`cancel()` 取消，`active` 看它還會不會觸發。

```ts
const handle: TimerHandle = engine.timers.after(10, () => console.log('不會執行'));
console.log('取消前：', handle.active);
handle.cancel();
console.log('取消後：', handle.active);
```

## TimerOptions
`realtime: true` 不受時間縮放影響；`owner` 可以一次取消同一個擁有者的計時器。

```ts
const owner = { name: '敵人 A' };
const options: TimerOptions = { owner, realtime: true };
engine.timers.every(0.3, () => console.log(owner.name, '攻擊'), options);
engine.timers.after(1, () => {
  engine.timers.cancelOwner(owner);
  console.log('敵人 A 被打倒，它的計時器都取消了');
});
engine.time.timeScale = 0.2; // 遊戲變慢，但 realtime 的計時器照常
engine.start();
```

## EngineState
引擎的狀態：`idle`、`running`、`paused`、`destroyed`。

```ts
const myEngine = new Engine({ pauseOnHidden: false });
const states: EngineState[] = [myEngine.state];
myEngine.start();
states.push(myEngine.state);
myEngine.pause();
states.push(myEngine.state);
myEngine.destroy();
states.push(myEngine.state);
console.log(states.join(' → '));
```

## LogLevel
記錄等級：`debug` < `info` < `warn` < `error`，`silent` 全部不顯示。

```ts
const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
const log = createLogger('demo');
for (const level of levels) {
  setLogLevel(level);
  console.log(`等級 ${level}：`);
  log.warn('  一則警告');
}
setLogLevel('info');
```

## Phase
更新階段的型別，`engine.on(階段, 函式)` 用。

```ts
const phase: Phase = 'lateUpdate';
engine.on(phase, (time) => {
  if (time.frame === 3) console.log(`${phase} 在第 3 幀執行`);
});
engine.start();
```

## PhaseCallback
每個階段呼叫的函式，參數是 `Time`。

```ts
const everySecond: PhaseCallback = (time) => {
  if (Math.floor(time.elapsed) !== Math.floor(time.elapsed - time.delta)) console.log('經過', Math.floor(time.elapsed), '秒');
};
engine.on('update', everySecond);
engine.start();
```
