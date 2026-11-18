# @engine/network 的範例

## BroadcastChannelTransport
同一個瀏覽器、同一個網站的分頁互相連線，不需要伺服器（開發、示範很方便）。把這個範例在兩個分頁打開，就會互相收到訊息。

```ts
const client = new NetworkClient({ transport: new BroadcastChannelTransport('manual-demo'), meta: { name: `分頁 ${Math.floor(Math.random() * 100)}` } });
client.onPeerJoin((p) => console.log('加入：', p.meta.name));
client.on<string>('chat', (text, from) => console.log(`${from.meta.name}：${text}`));
await client.connect();
console.log('我是', client.meta.name, '，狀態', client.status);
engine.timers.every(2, () => client.send('chat', '哈囉！'));
engine.start();
```

## LoopbackHub
模擬網路的集線器：同一個程式裡建立好幾個「玩家」，可以模擬延遲與斷線（測試、範例用）。

```ts
const hub = new LoopbackHub();
const alice = new NetworkClient({ transport: hub.create({ latency: 50 }), meta: { name: 'Alice' } });
const bob = new NetworkClient({ transport: hub.create({ latency: 50 }), meta: { name: 'Bob' } });
bob.on<string>('hi', (msg, from) => console.log(`Bob 收到 ${from.meta.name} 的訊息：${msg}`));
await Promise.all([alice.connect(), bob.connect()]);
alice.send('hi', '你好');
console.log('集線器上的連線：', hub.size);
```

## LoopbackTransport
測試用的傳輸：可以設定延遲、讓下一次連線失敗（測試重連）。

```ts
const hub = new LoopbackHub();
const t: LoopbackTransport = hub.create({ latency: 20 });
t.failNextConnect = true;
const client = new NetworkClient({ transport: t, reconnect: { minDelay: 200, maxDelay: 1000 } });
client.onStatus((s) => console.log('狀態：', s));
client.connect().then(() => console.log('最後連上了'));
```

## NetworkClient
連線客戶端：送訊息、請求與回應、玩家名單、延遲量測、斷線重連。這裡兩個玩家在同一個頁面裡互傳。

```ts
const hub = new LoopbackHub();
const host = new NetworkClient({ transport: hub.create({ latency: 30 }), meta: { name: '房主' } });
const guest = new NetworkClient({ transport: hub.create({ latency: 30 }), meta: { name: '訪客' } });
host.handle<{ a: number; b: number }, number>('add', ({ a, b }, from) => {
  console.log(`房主幫 ${from.meta.name} 算 ${a} + ${b}`);
  return a + b;
});
await Promise.all([host.connect(), guest.connect()]);
const sum = await guest.request<number>('add', { a: 2, b: 3 });
console.log('訪客收到答案：', sum);
setTimeout(() => {
  for (const p of guest.peers.values()) console.log('訪客看到的玩家：', p.meta.name, '，延遲', p.rtt, 'ms');
  console.log('流量：', guest.stats);
}, 1500);
```

## NetworkPlugin
實體同步外掛：用預製物件建立同步實體，位置自動送給其他玩家。這裡在同一個頁面模擬第二位玩家（另一個 World），他的方塊在畫面上繞圈（是遠端複本）。

```ts
spawn.camera(world, { position: [0, 6, 7], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world);
const hub = new LoopbackHub();
const look = (color: string): PrefabBuilder => ({ world: w, entity, local }) =>
  void w.add(entity, MeshRenderer, { geometry: { box: 0.6 }, material: local ? color : '#ff6b6b' });
// 我（這個頁面的 world）
const me = new NetworkClient({ transport: hub.create({ latency: 40 }) });
const net = new NetworkPlugin(me).registerPrefab('cube', look('#4cc9f0'));
engine.use(net);
// 另一位玩家（自己的引擎與 world，沒有畫面）
const other = new Engine({ pauseOnHidden: false });
const otherEcs = new EcsPlugin();
other.use(otherEcs).use(new ScenePlugin());
const otherNet = new NetworkPlugin(new NetworkClient({ transport: hub.create({ latency: 40 }) })).registerPrefab('cube', look('#4cc9f0'));
other.use(otherNet);
await Promise.all([me.connect(), world.requireResource(NetworkKey) === me && otherEcs.world.requireResource(NetworkKey).connect()]);
const mine = net.spawn('cube', null, { position: new Vector3(0, 0.3, 0) });
const theirs = otherNet.spawn('cube');
other.on('update', (t) => otherEcs.world.require(theirs, Transform).position.set(Math.cos(t.elapsed) * 3, 0.3, Math.sin(t.elapsed) * 3));
engine.on('update', (t) => (world.require(mine, Transform).position.x = Math.sin(t.elapsed * 2)));
engine.timers.every(1, () => console.log('遠端實體數：', net.remoteCount));
other.start();
engine.start();
```

## WebSocketTransport
WebSocket 傳輸：正式連線用，需要轉送伺服器（`npm run relay` 啟動 server/relay.mjs）。這裡連不到伺服器時會顯示重連中。

```ts
const client = new NetworkClient({ transport: new WebSocketTransport('ws://localhost:8787'), reconnect: { minDelay: 500, maxDelay: 2000 } });
client.onStatus((s) => console.log('狀態：', s));
client.connect().catch(() => {});
setTimeout(() => {
  console.log('（沒有啟動 relay 伺服器時會一直重連）');
  client.disconnect();
}, 2500);
```

## NetworkIdentity
同步元件：網路編號、擁有者、預製物件、附帶資料（由 NetworkPlugin 加上）。

```ts
const hub = new LoopbackHub();
const client = new NetworkClient({ transport: hub.create(), peerId: 'player-1' });
const net = new NetworkPlugin(client).registerPrefab('flag', () => {});
engine.use(net);
await client.connect();
const e = net.spawn('flag', { team: 'red' });
const id = world.require(e, NetworkIdentity);
console.log('netId', id.netId, '，擁有者', id.owner, '，預製物件', id.prefab, '，資料', id.data);
```

## NetworkKey
系統與腳本用 `world.requireResource(NetworkKey)` 取得連線客戶端（安裝 NetworkPlugin 後才有）。

```ts
const client = new NetworkClient({ transport: new LoopbackHub().create() });
engine.use(new NetworkPlugin(client));
console.log('同一個客戶端：', world.requireResource(NetworkKey) === client);
```

## ReplicationKey
系統用 `world.requireResource(ReplicationKey)` 取得同步外掛（例如腳本裡建立同步實體）。

```ts
const net = new NetworkPlugin(new NetworkClient({ transport: new LoopbackHub().create() }));
engine.use(net);
console.log('同一個外掛：', world.requireResource(ReplicationKey) === net);
```

## LoopbackOptions
測試用傳輸的設定：單向延遲（毫秒）。

```ts
const hub = new LoopbackHub();
const options: LoopbackOptions = { latency: 120 };
const a = new NetworkClient({ transport: hub.create(options), heartbeatInterval: 200 });
const b = new NetworkClient({ transport: hub.create(options), heartbeatInterval: 200 });
await Promise.all([a.connect(), b.connect()]);
setTimeout(() => console.log('量到的來回延遲：', [...a.peers.values()][0]?.rtt, 'ms（單向 120）'), 1000);
```

## NetworkClientOptions
NetworkClient 的設定：傳輸、編號、自己的資料、心跳、離線判定、重連、暫存。

```ts
const options: NetworkClientOptions = {
  transport: new LoopbackHub().create(),
  peerId: 'hero-42',
  meta: { name: '勇者', color: '#9acd32' },
  heartbeatInterval: 500,
  peerTimeout: 3000,
  reconnect: { minDelay: 250, maxDelay: 4000 },
  queueLimit: 50,
};
const client = new NetworkClient(options);
console.log('編號', client.peerId, '，資料', client.meta);
```

## NetworkIdentityData
NetworkIdentity 的資料。

```ts
const data: NetworkIdentityData = NetworkIdentity.create();
console.log('預設：', data);
```

## NetworkPluginOptions
NetworkPlugin 的設定：每秒送幾次位置、插值延遲。

```ts
const options: NetworkPluginOptions = { sendRate: 30, interpolationDelay: 0.05 };
const net = new NetworkPlugin(new NetworkClient({ transport: new LoopbackHub().create() }), options);
console.log('外掛：', net.name, '，設定', options);
```

## Peer
另一位玩家：編號、資料、延遲、最後一次收到訊息的時間。

```ts
const hub = new LoopbackHub();
const a = new NetworkClient({ transport: hub.create({ latency: 25 }), meta: { name: 'A' } });
const b = new NetworkClient({ transport: hub.create({ latency: 25 }), meta: { name: 'B', level: 7 }, heartbeatInterval: 300 });
a.onPeerJoin((p: Peer) => console.log('加入：', p.id.slice(0, 8), p.meta));
await Promise.all([a.connect(), b.connect()]);
setTimeout(() => {
  const p: Peer = [...a.peers.values()][0];
  console.log(`${p.meta.name} 的延遲 ${p.rtt} ms，${(performance.now() - p.lastSeen).toFixed(0)} ms 前收到訊息`);
}, 1000);
```

## Transport
自己寫傳輸方式：只要會連線、送文字、關閉。這裡做一個「把訊息印出來再轉給集線器」的傳輸。

```ts
class LoggingTransport implements Transport {
  constructor(private inner: Transport) {}
  connect(handlers: TransportHandlers) {
    this.inner.connect({ ...handlers, message: (d) => (console.log('收到', d.length, 'bytes'), handlers.message(d)) });
  }
  send(data: string) {
    console.log('送出', data.slice(0, 60));
    this.inner.send(data);
  }
  close() {
    this.inner.close();
  }
}
const hub = new LoopbackHub();
const a = new NetworkClient({ transport: new LoggingTransport(hub.create()), heartbeatInterval: 60000 });
const b = new NetworkClient({ transport: hub.create() });
await Promise.all([a.connect(), b.connect()]);
a.send('ping', { n: 1 });
```

## TransportHandlers
傳輸收到的處理函式：連線成功、收到訊息、連線中斷。

```ts
const hub = new LoopbackHub();
const t = hub.create();
const handlers: TransportHandlers = {
  open: () => console.log('連上了'),
  message: (d) => console.log('收到：', d),
  close: (reason) => console.log('斷線：', reason ?? '（沒有原因）'),
};
t.connect(handlers);
setTimeout(() => hub.drop(t), 300);
```

## ConnectionStatus
連線狀態：未連線、連線中、已連線。

```ts
const client = new NetworkClient({ transport: new LoopbackHub().create({ latency: 100 }) });
const seen: ConnectionStatus[] = [client.status];
client.onStatus((s) => seen.push(s));
await client.connect();
client.disconnect();
console.log(seen.join(' → '));
```

## MessageHandler
收到訊息的處理函式：資料與傳送者。

```ts
const hub = new LoopbackHub();
const a = new NetworkClient({ transport: hub.create(), meta: { name: 'A' } });
const b = new NetworkClient({ transport: hub.create() });
const onScore: MessageHandler<{ score: number }> = (data, from) => console.log(`${from.meta.name} 得了 ${data.score} 分`);
b.on('score', onScore);
await Promise.all([a.connect(), b.connect()]);
a.send('score', { score: 120 });
```

## PrefabBuilder
預製物件：建立同步實體的外觀。本地與遠端都會呼叫，`local` 區分是不是自己的。

```ts
spawn.camera(world, { position: [0, 2, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const builder: PrefabBuilder = ({ world: w, entity, data, local, owner }) => {
  w.add(entity, MeshRenderer, { geometry: { sphere: 0.5 }, material: (data as { color: string }).color });
  console.log(local ? '建立自己的' : `建立 ${owner?.id} 的`, '球');
};
const net = new NetworkPlugin(new NetworkClient({ transport: new LoopbackHub().create() })).registerPrefab('ball', builder);
engine.use(net);
net.spawn('ball', { color: '#9acd32' });
engine.start();
```

## RequestHandler
處理請求的函式：回傳值（或 Promise）會送回給請求者。

```ts
const hub = new LoopbackHub();
const server = new NetworkClient({ transport: hub.create() });
const player = new NetworkClient({ transport: hub.create() });
const lookup: RequestHandler<string, { price: number }> = async (item) => {
  await new Promise((r) => setTimeout(r, 100));
  return { price: item === 'sword' ? 120 : 10 };
};
server.handle('price', lookup);
await Promise.all([server.connect(), player.connect()]);
console.log('劍的價格：', await player.request<{ price: number }>('price', 'sword'));
```
