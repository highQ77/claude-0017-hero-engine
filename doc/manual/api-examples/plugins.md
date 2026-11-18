# @engine/plugins 的範例

## PluginContext
套件安裝時拿到的環境（`setup(ctx)`）：透過它加的系統、資源、元件，移除套件時自動撤銷。

```ts
const Spin = define.component('Spin', () => ({ speed: 1 }));
const spinner = define.plugin({
  name: 'demo/spinner',
  version: '1.0.0',
  setup(ctx: PluginContext) {
    ctx.addSystem({ name: 'spin', run: (w, t) => w.query([Transform, Spin]).each((_e, tr, s) => math.rotate(tr, [0, s.speed * t.delta, 0])) });
    ctx.onDispose(() => console.log('清理完畢'));
    ctx.log('安裝好了，有物理嗎？', !!ctx.optionalApi('physics'));
  },
});
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32' });
world.add(e, Spin, { speed: 2 });
const plugins = new PluginManager(engine, { api: engineApi });
await plugins.install(spinner);
engine.timers.after(2, () => plugins.uninstall('demo/spinner')); // 2 秒後移除：方塊停止
engine.start();
```

## PluginManager
套件管理：安裝（檢查版本與依賴）、列出、移除。用 lil-gui 安裝或移除「格線」套件。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 5, 7], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f', position: [0, 0.5, 0] });
const gridPkg = define.plugin<{ size: number }>({
  name: 'demo/grid',
  version: '1.2.0',
  description: '地面格線',
  engine: '^0.1.0',
  requires: ['render'],
  setup(ctx, options) {
    const e = spawn.grid(world, { size: options.size, divisions: options.size });
    ctx.onDispose(() => world.destroy(e));
  },
});
const plugins = new PluginManager(engine);
plugins.onChange(() => console.log('已安裝：', plugins.list().map((p) => `${p.name}@${p.version}`)));
const gui = new GUI();
gui.add({ install: () => !plugins.has('demo/grid') && plugins.install(gridPkg, { size: 10 }) }, 'install').name('安裝格線');
gui.add({ remove: () => plugins.has('demo/grid') && plugins.uninstall('demo/grid') }, 'remove').name('移除格線');
console.log('引擎版本：', plugins.engineVersion);
engine.start();
```

## define
`define.plugin`：定義套件（有型別檢查，options 的型別會帶進 setup）。

```ts
const greeter = define.plugin<{ name: string }>({
  name: 'demo/greeter',
  version: '0.1.0',
  setup: (ctx, options) => ctx.log(`你好，${options.name}！`),
});
await new PluginManager(engine).install(greeter, { name: '勇者' });
```

## ENGINE_VERSION
引擎版本。套件用 `engine: '^0.1.0'` 宣告相容的範圍；不相容時安裝會失敗。

```ts
console.log('引擎版本：', ENGINE_VERSION);
const future = define.plugin({ name: 'demo/future', version: '1.0.0', engine: '^9.0.0', setup: () => {} });
await new PluginManager(engine).install(future).catch((e: Error) => console.log('安裝失敗：', e.message));
```

## engineApi
給第三方套件的完整引擎 API（所有模組）。網址安裝的套件透過 `ctx.api` 取得，不用自己打包一份引擎。

```ts
console.log('模組：', Object.keys(engineApi).join('、'));
const pkg = define.plugin({
  name: 'demo/api-user',
  version: '1.0.0',
  setup(ctx) {
    const { spawn: s } = ctx.api.render;
    s.mesh(world, { geometry: { sphere: 0.5 }, material: '#4cc9f0' });
    ctx.log('用 ctx.api 建立了一顆球，THREE 版本', ctx.api.THREE.REVISION);
  },
});
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
await new PluginManager(engine, { api: engineApi }).install(pkg);
engine.start();
```

## integrity
完整性驗證：從網址安裝套件時，確認下載的程式碼沒被竄改。

```ts
const code = 'export default { name: "x", version: "1.0.0", setup() {} }';
const hash = await integrity.compute(code, 'sha384');
console.log('雜湊：', hash);
await integrity.verify(code, hash);
console.log('驗證通過');
await integrity.verify(code + ' ', hash, 'x.js').catch((e: Error) => console.log('被竄改：', e.message));
```

## semver
版本號：比較、檢查、是否符合範圍。

```ts
console.log('1.2.0 vs 1.10.0：', semver.compare('1.2.0', '1.10.0'));
console.log('合法嗎？', semver.isValid('1.2'), semver.isValid('1.2.3-beta.1'));
console.log('1.4.2 符合 ^1.2.0 嗎？', semver.satisfies('1.4.2', '^1.2.0'), '；2.0.0 呢？', semver.satisfies('2.0.0', '^1.2.0'));
console.log(semver.parse('3.1.4-rc.2'));
```

## InstalledPlugin
已安裝的套件資訊（`plugins.list()`）：名稱、版本、說明、作者、來源、安裝時間。

```ts
const plugins = new PluginManager(engine);
await plugins.install(define.plugin({ name: 'me/coins', version: '2.1.0', description: '金幣系統', author: '我', setup: () => {} }));
const info: InstalledPlugin | undefined = plugins.get('me/coins');
console.log(info?.name, info?.version, info?.description, info?.author, info?.source, info?.installedAt.toLocaleTimeString());
```

## PluginManagerOptions
PluginManager 的設定：信任的網址來源、給套件的引擎模組、自訂下載與匯入（測試用）。這裡用自訂下載模擬「從網址安裝」。

```ts
const code = 'export default { name: "remote/hello", version: "1.0.0", setup(ctx) { ctx.log("從網址安裝成功"); } }';
const options: PluginManagerOptions = {
  trustedOrigins: ['https://cdn.example.com'],
  fetch: async () => ({ ok: true, status: 200, text: async () => code }),
  importModule: async (_url, src) => import(/* @vite-ignore */ URL.createObjectURL(new Blob([src ?? code], { type: 'text/javascript' }))),
};
const plugins = new PluginManager(engine, options);
await plugins.installFromUrl('https://cdn.example.com/hello.js');
console.log('已安裝：', plugins.list().map((p) => `${p.name}（${p.source}）`));
```

## PluginPackage
套件的格式：名稱、版本、說明、相容的引擎版本、依賴、安裝與清理。

```ts
const pkg: PluginPackage<{ color: string }> = {
  name: 'demo/background',
  version: '1.0.0',
  description: '換背景顏色',
  requires: ['render'],
  setup(ctx, options) {
    const before = render.renderer.getClearColor(new Color()).getHex();
    render.renderer.setClearColor(options.color);
    ctx.onDispose(() => render.renderer.setClearColor(before));
  },
  teardown: (ctx) => ctx.log('移除了'),
};
spawn.camera(world);
const plugins = new PluginManager(engine);
await plugins.install(pkg, { color: '#20304a' });
engine.timers.after(1.5, () => plugins.uninstall(pkg.name));
engine.start();
```

## UrlInstallOptions
從網址安裝的設定：內容雜湊（有給就先驗證）、傳給套件的設定。

```ts
const code = 'export default { name: "remote/opts", version: "1.0.0", setup(ctx, o) { ctx.log("收到設定", JSON.stringify(o)); } }';
const plugins = new PluginManager(engine, {
  fetch: async () => ({ ok: true, status: 200, text: async () => code }),
  importModule: async (_u, src) => import(/* @vite-ignore */ URL.createObjectURL(new Blob([src ?? code], { type: 'text/javascript' }))),
});
const opts: UrlInstallOptions<{ level: number }> = { integrity: await integrity.compute(code), options: { level: 3 } };
await plugins.installFromUrl('https://other.example.com/opts.js', opts);
```

## EngineApi
完整引擎 API 的型別（`ctx.api` 的型別）。

```ts
const api: EngineApi = engineApi;
console.log('版本', api.version, '，有 ai 模組嗎？', 'ai' in api);
```

## EngineApiModules
PluginManager 的 `api` 選項：只給套件需要的模組（version、THREE 會自動加上）。

```ts
const modules: EngineApiModules = { core: engineApi.core, ecs: engineApi.ecs, render: engineApi.render };
const plugins = new PluginManager(engine, { api: modules });
await plugins.install(define.plugin({ name: 'demo/limited', version: '1.0.0', setup: (ctx) => ctx.log('拿得到 render 嗎？', !!ctx.optionalApi('render'), '，physics？', !!ctx.optionalApi('physics')) }));
```
