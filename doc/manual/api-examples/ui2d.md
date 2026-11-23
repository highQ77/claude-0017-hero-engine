# @engine/ui2d 的範例

## CanvasUIRenderer
獨立畫布的顯示層：沒有 3D 引擎時（編輯器預覽、純介面工具）把介面畫在自己的畫布上。`UI2D.create({ container })` 預設就是用它。

```ts
const box = document.createElement('div');
box.style.cssText = 'position:fixed;inset:0';
document.body.append(box);
const standalone = await UI2D.create({ container: null, width: 300, height: 200 });
const renderer = new CanvasUIRenderer(box);
standalone.setRenderer(renderer);
standalone.loadString(`<UI padding="16" gap="8" background="#20304a"><UILabel color="#fff" fontSize="18">獨立畫布</UILabel><UIButton text="按我" onClick="hi"/></UI>`);
standalone.setHandler('hi', () => console.log('點了按鈕'));
console.log('畫布：', renderer.canvas.tagName);
engine.start();
```

## MinimapPlugin
小地圖外掛：把有 `MinimapMarker` 的實體位置送到介面上的 `<UIMinimap>`。這裡玩家繞圈、敵人在附近，金色寶箱超出範圍時貼在邊緣。

```ts
spawn.camera(world, { position: [0, 12, 10], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world, { size: 40, divisions: 40 });
ui.loadString(`<UI padding="12" align="end"><UIMinimap id="map" width="160" height="160" range="20" rotate="true"/></UI>`);
const player = spawn.mesh(world, { geometry: { cone: [0.4, 1], rotation: [-Math.PI / 2, 0, 0] }, material: '#4cc9f0' });
world.add(player, MinimapMarker, { color: '#4cc9f0', shape: 'arrow', showHeading: true });
for (let i = 0; i < 6; i++) {
  const e = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b', position: [Math.cos(i) * 8, 0.4, Math.sin(i) * 8] });
  world.add(e, MinimapMarker, { color: '#ff5a5a', shape: 'dot' });
}
const chest = spawn.mesh(world, { geometry: { box: 0.8 }, material: '#ffd166', position: [30, 0.4, -25] });
world.add(chest, MinimapMarker, { color: '#ffd75e', shape: 'star', pin: true });
engine.use(new MinimapPlugin({ minimap: 'map', follow: () => player }));
engine.on('update', (t) => {
  const tr = world.require(player, Transform);
  tr.position.set(Math.cos(t.elapsed * 0.5) * 5, 0.5, Math.sin(t.elapsed * 0.5) * 5);
  math.setRotation(tr, [0, -t.elapsed * 0.5, 0]);
});
engine.start();
```

## SceneTransition
場景轉場：淡出 → 載入頁面（下載資源、顯示提示）→ 切換場景 → 淡入。點按鈕換場景。

```ts
spawn.defaultLights(world);
scenes.persist(spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] }));
scenes.register(
  { name: 'red', setup: (w) => void spawn.mesh(w, { geometry: { box: 1.2 }, material: '#ff6b6b' }) },
  { name: 'blue', setup: (w) => void spawn.mesh(w, { geometry: { sphere: 0.8 }, material: '#4cc9f0' }) },
);
const transition = new SceneTransition({ ui, scenes, assets, duration: 0.3, minLoadingTime: 0.8 }).defineAll({
  red: { title: '紅色房間', tips: ['紅色的是方塊'], hud: undefined },
  blue: { title: '藍色房間', tips: ['藍色的是球'], assets: ['textures/checker.png'] },
});
transition.onChange((c) => console.log(c.type, c.from, '→', c.to));
await transition.go('red');
ui.addLayer('controls', `<UI padding="12" align="start"><UIButton text="換場景" onClick="swap"/></UI>`);
ui.setHandler('swap', () => !transition.busy && transition.go(transition.current === 'red' ? 'blue' : 'red'));
engine.start();
```

## UI2D
2D 介面（`ui`）：讀 XML、建立元件、排版、事件。`get`／`require` 用 id 找元件，`setHandlers` 對應 XML 的 onClick。

```ts
ui.loadString(`
<UI padding="16" gap="10">
  <UILabel id="title" fontSize="20" fontWeight="bold" color="#fff">點擊次數：0</UILabel>
  <UILayout dir="h" gap="8">
    <UIButton text="+1" onClick="add"/>
    <UIButton text="歸零" onClick="reset"/>
    <UIButton text="提示" onClick="tip"/>
  </UILayout>
</UI>`);
let n = 0;
const title = ui.require<UILabel>('title');
ui.setHandlers({
  add: () => title.setText(`點擊次數：${++n}`),
  reset: () => title.setText(`點擊次數：${(n = 0)}`),
  tip: () => ui.toast('這是提示訊息', { icon: 'info' }),
});
console.log('介面大小：', ui.size, '，斷點：', ui.breakpoint);
engine.start();
```

## UIBadge
角標：紅點或數字，放在按鈕右上角。0 時隱藏，超過 max 顯示「99+」。

```ts
ui.loadString(`
<UI padding="20" gap="16" dir="h">
  <UIButton text="任務"><UIBadge id="quest" value="3"/></UIButton>
  <UIButton text="信件"><UIBadge id="mail" value="0"/></UIButton>
  <UIButton text="商店"><UIBadge dot="true" value="1"/></UIButton>
  <UIButton text="新信件" onClick="mail"/>
</UI>`);
let mail = 0;
ui.setHandler('mail', () => ui.require<UIBadge>('mail').setValue((mail += 40)));
console.log('任務角標：', ui.require<UIBadge>('quest').value);
engine.start();
```

## UIButton
按鈕：可以只有文字，也可以放圖示等元件；`disabled` 停用。

```ts
ui.loadString(`
<UI padding="20" gap="10">
  <UIButton id="buy" text="購買（100 金幣）" onClick="buy"/>
  <UIButton dir="h" gap="6" align="center" onClick="like"><UIIcon name="heart" size="16" color="#ff6b6b"/><UILabel color="#fff">喜歡</UILabel></UIButton>
</UI>`);
let coins = 250;
const buy = ui.require<UIButton>('buy');
ui.setHandlers({
  buy: () => {
    coins -= 100;
    console.log('剩', coins, '金幣');
    if (coins < 100) {
      buy.disabled = true;
      buy.setText('金幣不夠');
    }
  },
  like: () => console.log('❤'),
});
engine.start();
```

## UICheckBox
勾選框：點擊切換，觸發 change 事件（`event.checked`）。

```ts
ui.loadString(`
<UI padding="20" gap="10">
  <UICheckBox id="music" text="背景音樂" checked="true" onChange="changed"/>
  <UICheckBox text="顯示傷害數字" onChange="changed"/>
  <UICheckBox text="（停用中）" disabled="true"/>
</UI>`);
ui.setHandler('changed', (e) => console.log(e.target.get('text'), '→', (e.target as UICheckBox).checked));
console.log('背景音樂一開始：', ui.require<UICheckBox>('music').checked);
engine.start();
```

## UICheckIndicator
勾選框、單選按鈕前面畫勾的方塊（`checkBox.indicator`）。可以用外觀屬性改它的大小與顏色。

```ts
ui.loadString(`<UI padding="20"><UICheckBox id="c" text="大大的勾選框" checked="true"/></UI>`);
const box = ui.require<UICheckBox>('c');
box.indicator.set('width', 32).set('height', 32);
console.log('方塊的元件類型：', box.indicator.constructor.name);
engine.start();
```

## UIComponent
內嵌另一個介面檔：`<UIComponent src="card.xml"/>`，同一份介面可以重複使用。這裡用 `uiXml.register` 提供檔案內容。

```ts
uiXml.register({ '/ui/card.xml': async () => `<UI width="140" padding="10" gap="4" background="#2c3326" radius="10"><UIIcon name="sword" size="28" color="#9acd32"/><UILabel color="#fff">卡片</UILabel></UI>` });
await ui.preloadComponents(`<UIComponent src="/ui/card.xml"/>`);
ui.loadString(`
<UI padding="20" gap="12" dir="h">
  <UIComponent src="/ui/card.xml"/>
  <UIComponent src="/ui/card.xml" background="#20304a"/>
</UI>`);
await ui.whenComponentsLoaded();
ui.root?.walk((el) => el instanceof UIComponent && console.log('內嵌：', el.url, el.error ?? '成功'));
engine.start();
```

## UICooldown
冷卻遮罩：放在物品格裡，`start(秒數)` 顯示扇形倒數，結束時觸發 ready 事件。點技能看看。

```ts
ui.loadString(`
<UI padding="20" dir="h" gap="10">
  <UISlot iconName="fire" onClick="fire"><UICooldown id="cd1" onReady="ready"/></UISlot>
  <UISlot iconName="bolt" onClick="bolt"><UICooldown id="cd2" onReady="ready"/></UISlot>
</UI>`);
const use = (id: string, s: number) => {
  const cd = ui.require<UICooldown>(id);
  if (!cd.ready) return console.log('還在冷卻，剩', cd.remaining.toFixed(1), '秒');
  cd.start(s);
  console.log('施放！冷卻', s, '秒');
};
ui.setHandlers({ fire: () => use('cd1', 3), bolt: () => use('cd2', 1.5), ready: () => console.log('可以再用了') });
engine.start();
```

## UIDialog
`<UIDialog>` 是 `<UIDialogue>` 的舊名稱，用法完全一樣（新的介面請寫 UIDialogue）。

```ts
ui.loadString(`<UI padding="16" justify="end"><UIDialog id="d" speaker="旅人">這是舊名稱的對話框。</UIDialog></UI>`);
const d = ui.require<UIDialog>('d');
console.log('是 UIDialogue 嗎？', d instanceof UIDialogue);
engine.start();
```

## UIDialogue
RPG 對話框：頭像、名字、逐字顯示、選項。點對話框：打字中會直接顯示全部，顯示完觸發 next。

```ts
ui.loadString(`
<UI padding="16" justify="end">
  <UIDialogue id="talk" speaker="村長" onNext="next" onChoose="choose">勇者，歡迎來到村子！</UIDialogue>
</UI>`);
const talk = ui.require<UIDialogue>('talk');
const lines = ['最近森林裡出現了[color=#ff6b6b]怪物[/color]……', '可以請你幫忙嗎？'];
let i = 0;
ui.setHandlers({
  next: () => {
    if (i < lines.length - 1) talk.say(lines[i++]);
    else talk.say(lines[i], { choices: [{ value: 'yes', label: '交給我吧！' }, { value: 'no', label: '我考慮一下' }] });
  },
  choose: (e) => talk.say(e.value === 'yes' ? '[b]太好了！[/b]謝謝你！' : '好吧……', { speaker: '村長' }),
});
engine.start();
```

## UIElement
所有元件的基礎：屬性（get／set）、子元件、事件、位置、隱藏。用程式動態加元件。

```ts
ui.loadString(`<UI padding="20" gap="8"><UILayout id="list" gap="6"/><UIButton text="加一個" onClick="add"/></UI>`);
const list = ui.require<UIElement>('list');
let n = 0;
ui.setHandler('add', () => {
  const item = ui.createElement<UILabel>('UILabel', { color: '#ffd166', padding: '4 8', background: '#2c3326', radius: '6' }, `項目 ${++n}（點我刪除）`);
  item.on('click', () => item.destroy());
  list.add(item);
  console.log('子元件數：', list.children.length);
});
engine.start();
```

## UIFpsMeter
FPS 顯示：自己量畫面更新率，依數值變色（≥ 50 綠、≥ 30 黃、其他紅）。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.8, 0.3] }, material: '#9acd32' });
ui.loadString(`<UI><UIFpsMeter id="fps" position="absolute" right="12" top="12" format="FPS {fps}（{ms} ms）" interval="0.5"/></UI>`);
engine.timers.after(2, () => console.log('量到的 FPS：', ui.require<UIFpsMeter>('fps').fps));
engine.start();
```

## UIIcon
內建向量圖示（不需要圖檔，可以換顏色、大小）。

```ts
const names = ['heart', 'coin', 'sword', 'shield', 'potion', 'fire', 'bolt', 'gem', 'star', 'user'];
ui.loadString(`<UI padding="20" dir="h" gap="12" wrap="true">${names.map((n, i) => `<UIIcon name="${n}" size="${24 + i * 2}" color="hsl(${i * 36}, 70%, 65%)"/>`).join('')}</UI>`);
engine.start();
```

## UIImage
圖片：`src` 是網址。只給寬或高時維持比例；`setSrc` 換圖。

```ts
ui.loadString(`
<UI padding="20" gap="10" dir="h" align="center">
  <UIImage id="img" src="ui/coin.png" width="64"/>
  <UIImage src="ui/banner.svg" height="48"/>
</UI>`);
await ui.whenReady();
console.log('原始尺寸：', ui.require<UIImage>('img').natural);
engine.start();
```

## UIJoystick
虛擬搖桿（手機操作）：拖曳圓鈕，`event.value` 是 `{ x, y }`（-1~1）。拖曳搖桿移動方塊。

```ts
spawn.camera(world, { position: [0, 6, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world);
const box = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#4cc9f0', position: [0, 0.3, 0] });
ui.loadString(`<UI><UIJoystick id="stick" position="absolute" left="24" bottom="24"/></UI>`);
const stick = ui.require<UIJoystick>('stick');
engine.on('update', (t) => {
  const p = world.require(box, Transform).position;
  p.x += stick.x * t.delta * 4;
  p.z += stick.y * t.delta * 4;
});
engine.start();
```

## UILabel
文字：依寬度自動換行；`setText` 改內容；`revealed` 做打字機效果。

```ts
ui.loadString(`
<UI padding="20" gap="10">
  <UILabel id="typing" width="260" color="#e9f6d2" fontSize="16">很久很久以前，在一個遙遠的王國裡，住著一位勇敢的少年……</UILabel>
  <UILabel color="#9aa292" fontSize="12" align="end">（打字機效果）</UILabel>
</UI>`);
const label = ui.require<UILabel>('typing');
label.revealed = 0;
engine.on('update', (t) => {
  label.revealed = Math.floor(t.elapsed * 12) % (label.text.length + 20);
  label.invalidate();
});
engine.start();
```

## UILayout
排版容器：`dir="h"` 水平、`dir="v"` 垂直；gap、padding、align、justify、flex。

```ts
ui.loadString(`
<UI padding="16" gap="10">
  <UILayout dir="h" gap="8" height="60">
    <UILayout flex="1" background="#ff6b6b" radius="8"/>
    <UILayout flex="2" background="#4cc9f0" radius="8"/>
    <UILayout width="60" background="#ffd166" radius="8"/>
  </UILayout>
  <UILayout dir="h" justify="between" align="center" padding="8" background="#2c3326" radius="8">
    <UILabel color="#fff">左</UILabel><UILabel color="#fff">中</UILabel><UILabel color="#fff">右</UILabel>
  </UILayout>
</UI>`);
engine.start();
```

## UIList
列表：可以捲動；`type="grid"` 格狀。用 `<UITemplate>` 加 `ui.setItems` 由資料產生項目。

```ts
ui.loadString(`
<UI padding="14" gap="8">
  <UILabel color="#fff" fontWeight="bold">排行榜</UILabel>
  <UIList id="rank" flex="1" gap="4">
    <UITemplate>
      <UILayout dir="h" justify="between" padding="6 10" background="#2c3326" radius="6">
        <UILabel color="#ffd166">#{rank} {name}</UILabel><UILabel color="#fff">{score}</UILabel>
      </UILayout>
    </UITemplate>
  </UIList>
</UI>`);
ui.setItems('rank', Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, name: `玩家${i + 1}`, score: 5000 - i * 120 })));
console.log('類型：', ui.require<UIList>('rank').listType, '，捲動方向：', ui.require<UIList>('rank').scrollAxis);
engine.start();
```

## UIMinimap
小地圖元件：以某個位置為中心的俯視圖。也可以不用外掛，自己用 `setView`、`setMarkers` 控制。

```ts
ui.loadString(`<UI padding="20"><UIMinimap id="map" width="180" height="180" range="20"/></UI>`);
const map = ui.require<UIMinimap>('map');
engine.on('update', (t) => {
  map.setView(Math.cos(t.elapsed) * 5, Math.sin(t.elapsed) * 5, t.elapsed);
  map.setMarkers([
    { x: 0, z: 0, color: '#ffd75e', shape: 'star' },
    { x: 8, z: -3, color: '#ff5a5a' },
    { x: -6, z: 6, color: '#4cc9f0', shape: 'square' },
    { x: 40, z: 40, color: '#b072ff', shape: 'diamond', pin: true },
  ]);
});
engine.start();
```

## UIPainter
介面繪圖器：把一棵介面樹畫到任何 2D 畫布上（截圖、縮圖）。這裡把介面畫到自己的畫布再縮小顯示。

```ts
const headless = await UI2D.create({ container: null, width: 240, height: 120 });
headless.loadString(`<UI padding="12" gap="6" background="#20304a"><UILabel color="#fff" fontSize="18">縮圖</UILabel><UIProgressBar value="70"/></UI>`);
headless.layout();
const canvas = document.createElement('canvas');
canvas.width = 240;
canvas.height = 120;
canvas.style.cssText = 'position:fixed;left:10px;top:10px;width:120px;border:1px solid #9acd32';
document.body.append(canvas);
const painter = new UIPainter((url) => headless.imageSource(url));
painter.paint(canvas.getContext('2d')!, headless.root!, 240, 120, 1, headless.paintState);
console.log('畫好了（縮成一半大小）');
```

## UIPlugin
2D 介面外掛（手冊的 `uiPlugin`）：介面疊在 3D 畫面上，點到介面的滑鼠不會傳給遊戲。`interactive = false` 讓介面只顯示、不攔截。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f' });
ui.loadString(`<UI padding="16" align="start"><UIButton text="切換介面可否點擊" onClick="toggle"/><UILabel id="s" color="#fff"/></UI>`);
const s = ui.require<UILabel>('s');
const update = () => s.setText(`interactive = ${uiPlugin.interactive}`);
ui.setHandler('toggle', () => {
  uiPlugin.interactive = false;
  update();
  setTimeout(() => ((uiPlugin.interactive = true), update()), 2000);
});
update();
console.log('外掛：', uiPlugin.name, '，同一個介面：', uiPlugin.ui === ui);
engine.start();
```

## UIProgressBar
進度條：數值改變時平滑移動，減少時留下殘影；`shape="radial"` 是圓形。

```ts
ui.loadString(`
<UI padding="20" gap="12">
  <UIProgressBar id="hp" value="80" max="100" width="240" fill="#ff5a5a,#ffb347" showText="true" text="{value} / {max}"/>
  <UILayout dir="h" gap="8"><UIButton text="受傷" onClick="hit"/><UIButton text="回復" onClick="heal"/></UILayout>
  <UIProgressBar id="ring" shape="radial" value="30" width="72" height="72" showText="true"/>
</UI>`);
const hp = ui.require<UIProgressBar>('hp');
ui.setHandlers({ hit: () => (hp.value = Math.max(0, hp.value - 20)), heal: () => (hp.value = Math.min(100, hp.value + 30)) });
engine.on('update', (t) => (ui.require<UIProgressBar>('ring').value = (t.elapsed * 20) % 100));
engine.start();
```

## UIRadioButton
單選按鈕：同一個 group 只能選一個。`ui.getRadioValue(群組)` 取得選中的值。

```ts
ui.loadString(`
<UI padding="20" gap="8">
  <UILabel color="#fff">畫質</UILabel>
  <UIRadioButton group="q" value="low" text="低" onChange="pick"/>
  <UIRadioButton group="q" value="mid" text="中" checked="true" onChange="pick"/>
  <UIRadioButton group="q" value="high" text="高" onChange="pick"/>
</UI>`);
ui.setHandler('pick', (e) => console.log('選了', e.value, '，群組的值：', ui.getRadioValue('q')));
console.log('一開始：', ui.getRadioValue('q'));
engine.start();
```

## UIRichText
多樣式文字：同一段文字混用粗體、顏色、大小、圖示，會自動換行。

```ts
ui.loadString(`
<UI padding="20" gap="12">
  <UIRichText width="300" color="#e9f6d2">造成 [b][color=#ff6b6b]120[/color][/b] 點 [icon=fire color=#ffb347] 火焰傷害，[size=20]暴擊！[/size][br]獲得 [icon=coin color=#ffd75e] [b]35[/b] 金幣</UIRichText>
</UI>`);
ui.root?.walk((el) => el instanceof UIRichText && console.log('純文字：', el.plainText, '，單位數', el.length));
engine.start();
```

## UIRoot
根元件（XML 的 `<UI>`）：填滿整個畫面、直向排列。`ui.root` 就是它。

```ts
ui.loadString(`<UI padding="20" background="rgba(76,201,240,0.15)" justify="center" align="center"><UILabel color="#fff">我是根元件的內容</UILabel></UI>`);
console.log('根元件：', ui.root?.constructor.name, ui.root instanceof UIRoot, '，大小', ui.root?.layout.width, 'x', ui.root?.layout.height);
engine.start();
```

## UIScreenManager
畫面管理：`show` 換整個畫面、`open` 疊一層（設定、背包），XML 裡可以直接寫 `screen.open:名稱`、`screen.back`。

```ts
const screens = new UIScreenManager(ui).registerAll({
  title: { xml: `<UI align="center" justify="center" gap="10"><UILabel fontSize="28" color="#fff" fontWeight="bold">我的遊戲</UILabel><UIButton text="開始" onClick="screen.show:hud"/></UI>` },
  hud: { xml: `<UI padding="12" align="start"><UIButton text="設定" onClick="screen.open:settings"/></UI>` },
  settings: { modal: true, xml: `<UI align="center" justify="center"><UIWindow title="設定" width="240" onClose="screen.close"><UIToggle text="音效" checked="true"/><UIButton text="回標題" onClick="screen.show:title"/></UIWindow></UI>` },
});
screens.onChange((c) => console.log(c.type, c.name, '，疊加中：', screens.overlays));
await screens.show('title');
engine.start();
```

## UIScrollView
捲動區：內容超出範圍時用滾輪或拖曳捲動。`ui.scrollTo` 用程式捲動。

```ts
ui.loadString(`
<UI padding="16" gap="8">
  <UIScrollView id="sv" height="160" background="#2c3326" radius="8" padding="10" gap="6">
    ${Array.from({ length: 20 }, (_, i) => `<UILabel color="#e9f6d2">第 ${i + 1} 行說明文字</UILabel>`).join('')}
  </UIScrollView>
  <UIButton text="捲到最下面" onClick="bottom"/>
</UI>`);
const sv = ui.require<UIScrollView>('sv');
ui.setHandler('bottom', () => {
  ui.scrollTo(sv, 0, sv.contentHeight);
  console.log('捲動到', sv.scrollTop, '／內容高度', sv.contentHeight);
});
engine.start();
```

## UISelect
下拉選單：點擊展開，選取後觸發 change（`event.value`）。`setOptions` 用程式設定選項。

```ts
ui.loadString(`
<UI padding="20" gap="10" dir="h">
  <UISelect id="cls" value="mage" onChange="pick">
    <UIOption value="warrior">劍士</UIOption>
    <UIOption value="mage">法師</UIOption>
    <UIOption value="archer">弓手</UIOption>
  </UISelect>
  <UISelect id="lv" onChange="pick"/>
</UI>`);
ui.require<UISelect>('lv').setOptions(Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Lv.${i + 1}` })));
ui.setHandler('pick', (e) => console.log('選了', e.value, '（', (e.target as UISelect).selectedOption?.label, '）'));
console.log('職業：', ui.require<UISelect>('cls').value);
engine.start();
```

## UISlider
滑桿：拖曳改數值，拖曳中觸發 input，放開觸發 change。這裡用滑桿控制方塊大小。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32' });
ui.loadString(`
<UI padding="16" gap="8" align="start">
  <UILabel color="#fff">大小</UILabel>
  <UISlider min="0.2" max="2" step="0.1" value="1" width="200" showValue="true" suffix="x" onInput="size"/>
  <UISlider orientation="vertical" height="120" value="40"/>
</UI>`);
ui.setHandler('size', (e) => world.require(box, Transform).scale.setScalar(Number(e.value)));
engine.start();
```

## UISlot
物品格：圖示、數量、稀有度外框；可以拖曳到另一格（目標觸發 drop，`event.source` 是來源）。

```ts
ui.loadString(`
<UI padding="20" gap="10">
  <UILayout dir="h" gap="6">
    <UISlot iconName="sword" rarity="epic" onDrop="drop"/>
    <UISlot iconName="potion" count="5" rarity="uncommon" onDrop="drop"/>
    <UISlot iconName="gem" rarity="legendary" onDrop="drop"/>
    <UISlot onDrop="drop"/><UISlot onDrop="drop"/>
  </UILayout>
  <UILabel color="#9aa292" fontSize="12">把物品拖到別的格子（交換）</UILabel>
</UI>`);
ui.setHandler('drop', (e) => {
  const to = e.target as UISlot;
  const from = (e as unknown as { source: UISlot }).source;
  const a = { iconName: from.icon.get('name'), count: from.count, rarity: from.get('rarity') };
  const b = to.empty ? null : { iconName: to.icon.get('name'), count: to.count, rarity: to.get('rarity') };
  to.setItem(a);
  from.setItem(b);
  console.log('移動了', a.iconName);
});
engine.start();
```

## UIStackView
頁面堆疊：一次顯示一頁，切換有動畫。按鈕寫 `select="堆疊id:頁"` 就能切換（不用寫程式）。

```ts
ui.loadString(`
<UI padding="16" gap="10">
  <UILayout dir="h" gap="6">
    <UIButton text="角色" select="pages:0" activeBackground="#9acd32" activeColor="#141a07"/>
    <UIButton text="技能" select="pages:skills" activeBackground="#9acd32" activeColor="#141a07"/>
    <UIButton text="下一頁 ▶" onClick="next"/>
  </UILayout>
  <UIStackView id="pages" flex="1" transition="slide" indicator="dots" swipe="true" onChange="changed">
    <UILayout padding="12" background="#2c3326" radius="8"><UILabel color="#fff">角色：勇者 Lv.12</UILabel></UILayout>
    <UILayout id="skills" padding="12" background="#20304a" radius="8"><UILabel color="#fff">技能：火球、治療</UILabel></UILayout>
    <UILayout padding="12" background="#3a2030" radius="8"><UILabel color="#fff">裝備：鐵劍</UILabel></UILayout>
  </UIStackView>
</UI>`);
ui.setHandlers({ next: () => ui.require<UIStackView>('pages').next(true), changed: (e) => console.log('第', e.value, '頁') });
engine.start();
```

## UITab
分頁的一頁：放在 UITabs 裡，`title` 是標籤上的文字。

```ts
ui.loadString(`<UI padding="16"><UITabs id="t"><UITab id="a" title="畫面"><UILabel color="#fff">畫面設定</UILabel></UITab><UITab title="聲音"><UILabel color="#fff">聲音設定</UILabel></UITab></UITabs></UI>`);
const tab = ui.require<UITab>('a');
console.log('標題：', tab.title, '，屬於：', tab.owner?.constructor.name);
engine.start();
```

## UITable
表格：點標題排序、點資料列選取（select 事件，`event.item` 是那一列）。

```ts
ui.loadString(`
<UI padding="16">
  <UITable id="rank" flex="1" onSelect="pick">
    <UIColumn key="rank" title="#" width="44" align="center"/>
    <UIColumn key="name" title="玩家"/>
    <UIColumn key="score" title="分數" width="90" align="right" sort="number"/>
  </UITable>
</UI>`);
const table = ui.require<UITable>('rank');
table.setRows(['小明', '小華', '阿美', '大雄', '靜香', '胖虎'].map((name, i) => ({ rank: i + 1, name, score: Math.round(Math.random() * 3000) })));
table.sortBy('score', -1);
ui.setHandler('pick', (e) => console.log('選了', (e.item as TableRow).name, (e.item as TableRow).score));
engine.start();
```

## UITabs
分頁：上方標籤、下方內容，切換有動畫；change 事件的 `event.value` 是索引。

```ts
ui.loadString(`
<UI padding="16">
  <UITabs id="tabs" flex="1" transition="fade" onChange="changed">
    <UITab title="畫面"><UIToggle text="垂直同步" checked="true"/><UISlider value="70" showValue="true"/></UITab>
    <UITab title="聲音"><UISlider value="50" showValue="true" suffix="%"/></UITab>
    <UITab title="操作"><UILabel color="#fff">WASD 移動、空白鍵跳</UILabel></UITab>
  </UITabs>
</UI>`);
ui.setHandler('changed', () => console.log('切到：', ui.require<UITabs>('tabs').selectedTab?.title));
console.log('分頁數：', ui.require<UITabs>('tabs').tabs.length);
engine.start();
```

## UITextureRenderer
把介面畫成 three.js 貼圖：可以貼在 3D 物件上（遊戲裡的螢幕、看板）。介面有變化時只重畫變動的範圍；第二個參數給了繪製器時也只上傳那一塊（見 `UITextureCopier`）。

```ts
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
const panel = await UI2D.create({ container: null, width: 256, height: 160 });
const tr = new UITextureRenderer();
panel.setRenderer(tr);
panel.loadString(`<UI padding="14" gap="8" background="#20304a"><UILabel color="#fff" fontSize="22" fontWeight="bold">遊戲內螢幕</UILabel><UIProgressBar id="p" value="0"/></UI>`);
const e = spawn.mesh(world, { geometry: { box: [1.6, 1, 0.05] }, material: { basic: { map: tr.texture } } });
engine.on('update', (t) => {
  panel.require<UIProgressBar>('p').value = (t.elapsed * 25) % 100;
  panel.tick(t.delta);
  math.setRotation(world.require(e, Transform), [0, Math.sin(t.elapsed) * 0.5, 0]);
});
engine.start();
```

## UITextureCopier
介面貼圖局部更新要用的繪製器功能（`copyTextureToTexture`）：引擎的繪製器（WebGPURenderer）就有。自己用 `UITextureRenderer` 時傳進去，介面只有一小塊變動時只上傳那一塊。

```ts
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
await render.ready;
const copier: UITextureCopier = render.renderer;
const panel = await UI2D.create({ container: null, width: 256, height: 160 });
const tr = new UITextureRenderer(undefined, () => copier);
panel.setRenderer(tr);
panel.loadString(`<UI padding="14" gap="8" background="#20304a"><UILabel color="#fff" fontSize="22">局部更新</UILabel><UIProgressBar id="p" value="0"/></UI>`);
spawn.mesh(world, { geometry: { box: [1.6, 1, 0.05] }, material: { basic: { map: tr.texture } } });
engine.on('update', (t) => {
  panel.require<UIProgressBar>('p').value = (t.elapsed * 25) % 100;
  panel.tick(t.delta);
});
engine.timers.after(2, () => console.log('局部更新次數：', tr.uploadStats.partial, '，整張上傳：', tr.uploadStats.full));
engine.start();
```

## UIToast
提示訊息：自動淡入淡出、可以疊好幾則。`ui.toast` 會用介面裡的 `<UIToast>`。

```ts
ui.loadString(`<UI padding="20" gap="8"><UIToast id="t" placement="top"/><UIButton text="獲得金幣" onClick="coin"/><UIButton text="存檔" onClick="save"/></UI>`);
ui.setHandlers({
  coin: () => ui.toast('獲得金幣 ×10', { icon: 'coin', color: '#ffd75e' }),
  save: () => ui.require<UIToast>('t').show('存檔完成', { icon: 'check', duration: 1.5, background: '#1f3a1f' }),
});
engine.start();
```

## UIToggle
開關：像遊戲設定的切換開關，點擊切換、觸發 change。

```ts
ui.loadString(`
<UI padding="20" gap="10">
  <UIToggle text="背景音樂" checked="true" onChange="changed"/>
  <UIToggle text="震動" onChange="changed"/>
</UI>`);
ui.setHandler('changed', (e) => console.log(e.target.get('text'), (e.target as UIToggle).checked ? '開' : '關'));
engine.start();
```

## UIWindow
視窗：標題列、關閉鈕，可以拖曳標題列移動。關閉時觸發 close 事件。

```ts
ui.loadString(`
<UI padding="16">
  <UIButton text="打開視窗" onClick="open"/>
  <UIWindow id="w" title="背包" position="absolute" left="40" top="60" width="240" onClose="closed">
    <UILayout dir="h" gap="6"><UISlot iconName="sword"/><UISlot iconName="potion" count="3"/></UILayout>
  </UIWindow>
</UI>`);
ui.setHandlers({ open: () => ui.require<UIWindow>('w').open(), closed: () => console.log('視窗關了') });
engine.start();
```

## XmlError
XML 格式錯誤：訊息帶行號、欄號，方便找到寫錯的地方。

```ts
try {
  uiXml.parse(`<UI>\n  <UILabel>沒有結尾\n</UI>`);
} catch (error) {
  if (error instanceof XmlError) console.log('第', error.line, '行、第', error.column, '欄：', error.message);
}
```

## BUILTIN_COMPONENTS
內建的基本元件（標籤名稱 → 元件類別）。

```ts
console.log(Object.keys(BUILTIN_COMPONENTS).join('、'));
```

## COMMENT_TAG
解析 XML 時保留註解（`keepComments`），註解節點的 tag 就是它（編輯器存檔時保留註解用）。

```ts
const root = uiXml.parse(`<UI><!-- 標題 --><UILabel>Hi</UILabel></UI>`, { keepComments: true });
console.log(root.children.map((c) => (c.tag === COMMENT_TAG ? `註解：${c.text}` : c.tag)));
```

## DEFAULT_BREAKPOINTS
預設的斷點（行動優先）：寬度 ≥ 數值時，`md:width="…"` 這種屬性生效。

```ts
console.log(DEFAULT_BREAKPOINTS);
console.log('目前生效的斷點：', ui.breakpoint);
```

## DEFAULT_LOADING_XML
場景轉場內建的載入頁面（沒指定 loading 時用它）。可以照著它的 id 寫自己的載入頁面。

```ts
console.log(DEFAULT_LOADING_XML.slice(0, 400));
```

## draw
2D 繪圖小工具：內建圖示、圓角矩形、九宮格、文字換行（自訂元件或自己畫畫布時用）。

```ts
const c = document.createElement('canvas');
c.width = 320;
c.height = 120;
c.style.cssText = 'position:fixed;left:10px;top:10px';
document.body.append(c);
const g = c.getContext('2d')!;
g.fillStyle = '#2c3326';
draw.roundRect(g, 0, 0, 320, 120, 16);
g.fill();
['heart', 'coin', 'sword', 'fire'].forEach((n, i) => draw.icon(g, n, 16 + i * 52, 16, 40, 40, '#ffd166'));
const m = draw.wrapText('文字自動換行：寬度不夠時換到下一行。', { size: 14, family: 'sans-serif', weight: 'normal', lineHeight: 1.4 }, 280, measure.canvas());
g.fillStyle = '#fff';
g.font = '14px sans-serif';
m.lines.forEach((line, i) => g.fillText(line, 16, 80 + i * 20));
console.log('換成', m.lines.length, '行');
```

## env
執行環境：`env.isWebKit()` 判斷是不是 Safari（介面的畫布模式會依此調整）。

```ts
console.log('是 WebKit（Safari）嗎？', env.isWebKit());
```

## ICON_NAMES
所有內建圖示的名稱。

```ts
console.log(ICON_NAMES.length, '個圖示：', ICON_NAMES.join(' '));
ui.loadString(`<UI padding="12" dir="h" wrap="true" gap="6">${ICON_NAMES.map((n) => `<UIIcon name="${n}" size="20" color="#9acd32"/>`).join('')}</UI>`);
engine.start();
```

## ICONS
內建圖示的資料：名稱 → 向量路徑。

```ts
console.log('heart 的資料：', JSON.stringify(ICONS.heart).slice(0, 120));
console.log('共有', Object.keys(ICONS).length, '個');
```

## load
`load.layoutEngine`：載入排版引擎 Yoga（`UI2D.create()` 會自動載入）。

```ts
const yoga = await load.layoutEngine();
const node = yoga.Node.create();
node.setWidth(100);
node.setHeight(50);
node.calculateLayout(undefined, undefined);
console.log('Yoga 算出的大小：', node.getComputedWidth(), 'x', node.getComputedHeight());
node.free();
```

## measure
文字量測：`canvas()` 用瀏覽器畫布量，`fixed()` 用固定字寬（測試、沒有畫布時）。

```ts
const font = { size: 16, family: 'sans-serif', weight: 'normal', lineHeight: 1.4 };
console.log('畫布量「Hello 你好」：', measure.canvas()('Hello 你好', font).toFixed(1), 'px');
console.log('固定字寬：', measure.fixed(0.6)('Hello 你好', font).toFixed(1), 'px');
```

## MinimapMarker
小地圖標記元件：有它（加上 Transform）的實體會出現在小地圖上（需要 MinimapPlugin）。

```ts
ui.loadString(`<UI padding="12" align="end"><UIMinimap id="m" width="140" height="140" range="10"/></UI>`);
const shapes = ['dot', 'square', 'diamond', 'arrow', 'star'] as const;
shapes.forEach((shape, i) => {
  const e = world.spawn(Transform.at(Math.cos(i * 1.2) * 5, 0, Math.sin(i * 1.2) * 5));
  world.add(e, MinimapMarker, { shape, color: `hsl(${i * 70}, 70%, 60%)`, size: 10 });
});
engine.use(new MinimapPlugin({ minimap: 'm' }));
engine.start();
```

## parse
解析介面屬性：尺寸、上右下左、陰影、多樣式文字。

```ts
console.log('dim("50%")：', parse.dim('50%'));
console.log('edges("8 16")：', parse.edges('8 16'));
console.log('shadow：', parse.shadow('0 4 12 rgba(0,0,0,0.5)'));
console.log('richText：', parse.richText('[b]粗[/b]體').length, '個片段');
```

## RARITY_COLORS
物品稀有度的顏色（UISlot 的 rarity 外框用）。

```ts
console.log(RARITY_COLORS);
ui.loadString(`<UI padding="16" dir="h" gap="8">${Object.keys(RARITY_COLORS).map((r) => `<UISlot iconName="gem" rarity="${r}"/>`).join('')}</UI>`);
engine.start();
```

## UI_OVERLAY_ORDER
介面疊加在 3D 畫面上的順序（`render.addOverlay` 的 order；越大越上面）。

```ts
console.log('介面的疊加順序：', UI_OVERLAY_ORDER, '（自己的疊加圖層想蓋在介面上面就用更大的數字）');
```

## UIKey
系統與腳本用 `world.requireResource(UIKey)` 取得介面。

```ts
console.log('和 ui 同一個：', world.requireResource(UIKey) === ui);
```

## uiXml
介面檔的小工具：讀取（有快取）、提供內容、解析。

```ts
uiXml.register({ '/ui/hello.xml': async () => `<UI padding="16"><UILabel color="#fff">來自 uiXml.register 的檔案</UILabel></UI>` });
console.log('有內嵌的檔案嗎？', uiXml.hasBundled('/ui/hello.xml'));
const text = await uiXml.load('/ui/hello.xml');
console.log('解析：', uiXml.parse(text).children[0].tag, '，整理路徑：', uiXml.normalizePath('ui/a/../b/./c.xml'));
await ui.load('/ui/hello.xml');
engine.start();
```

## WIDGET_COMPONENTS
進階元件（UI2D 會自動註冊）：進度條、開關、視窗、物品格、對話框、搖桿、小地圖……

```ts
console.log(Object.keys(WIDGET_COMPONENTS).join('、'));
```

## WIDGET2_COMPONENTS
進階元件第二批：頁面堆疊、分頁、表格、多樣式文字、FPS 顯示。

```ts
console.log(Object.keys(WIDGET2_COMPONENTS).join('、'));
console.log('都註冊了：', Object.keys(WIDGET2_COMPONENTS).every((t) => UI2D.components.has(t)));
```

## DialogChoice
對話選項：值（choose 事件的 value）與顯示的文字。

```ts
ui.loadString(`<UI padding="16" justify="end"><UIDialogue id="d" speaker="商人" onChoose="choose"/></UI>`);
const choices: DialogChoice[] = [{ value: 'buy', label: '我要買東西' }, { value: 'sell', label: '我要賣東西' }];
ui.require<UIDialogue>('d').say('需要什麼嗎？', { choices });
ui.setHandler('choose', (e) => console.log('選了', e.value));
engine.start();
```

## FontSpec
字型設定：大小、字體、粗細、行高（文字量測、換行用）。

```ts
const font: FontSpec = { size: 20, family: 'serif', weight: 'bold', lineHeight: 1.5 };
const m = draw.wrapText('這是一段很長很長的文字，用來測試換行。', font, 160, measure.canvas());
console.log(m.lines, '高度', m.height.toFixed(1));
```

## GoOptions
`transition.go` 的選項：`beforeReveal` 在淡入前（畫面還是黑的）執行，例如先打開標題畫面。

```ts
scenes.register({ name: 'menu', setup: () => {} });
const transition = new SceneTransition({ ui, scenes }).define('menu', { title: '主選單' });
const options: GoOptions = {
  beforeReveal: () => void ui.addLayer('title', `<UI align="center" justify="center"><UILabel fontSize="28" color="#fff">標題畫面</UILabel></UI>`),
};
await transition.go('menu', options);
console.log('進入', transition.current, '（標題在淡入前就打開了）');
engine.start();
```

## ImageSize
圖片的原始尺寸（`UIImage.natural`、圖片載入器回傳的資料）。

```ts
ui.loadString(`<UI padding="20"><UIImage id="i" src="ui/coin.png" width="48"/></UI>`);
await ui.whenReady();
const size: ImageSize | null = ui.require<UIImage>('i').natural;
console.log('原始尺寸：', size?.width, 'x', size?.height);
engine.start();
```

## MinimapMarkerData
MinimapMarker 的資料：顏色、形狀、大小、箭頭轉向、超出範圍時貼邊。

```ts
const data: MinimapMarkerData = MinimapMarker.create();
console.log('預設：', data);
```

## MinimapPluginOptions
MinimapPlugin 的設定：小地圖的 id（可以好幾個）、跟著誰、每秒更新幾次。

```ts
const player = world.spawn(Transform);
const options: MinimapPluginOptions = { minimap: ['hudMap', 'mobileMap'], follow: () => player, rate: 10 };
console.log('設定：', options.minimap, '，每秒', options.rate, '次');
```

## MinimapPoint
小地圖上的一個標記：世界座標 x／z、顏色、形狀、方向、貼邊。

```ts
ui.loadString(`<UI padding="20"><UIMinimap id="m" width="160" height="160" range="10"/></UI>`);
const points: MinimapPoint[] = [
  { x: 0, z: 0, shape: 'arrow', heading: 0, color: '#4cc9f0' },
  { x: 4, z: -4, color: '#ff5a5a' },
  { x: 30, z: 0, shape: 'star', color: '#ffd75e', pin: true },
];
ui.require<UIMinimap>('m').setMarkers(points);
engine.start();
```

## PaintState
互動狀態：滑鼠移到的、按著的元件（繪圖器用來決定按鈕外觀）。

```ts
ui.loadString(`<UI padding="20" gap="8"><UIButton id="a" text="移到我上面"/><UIButton id="b" text="或是我"/></UI>`);
engine.on('update', () => {
  const s: PaintState = ui.paintState;
  if (engine.time.frame % 20 === 0 && s.hover) console.log('滑鼠在：', s.hover.get('text') ?? s.hover.constructor.name);
});
engine.start();
```

## ParseOptions
`uiXml.parse` 的設定：不需要結尾的標籤、保留註解。

```ts
const options: ParseOptions = { voidTags: ['br'], keepComments: true };
const root = uiXml.parse(`<UI><!-- 說明 --><UILabel>一<br>二</UILabel></UI>`, options);
console.log(JSON.stringify(root.children.map((c) => c.tag)));
```

## PointerCapture
元件接管指標：按下後，移動與放開都交給它（拖曳）。這裡寫一個可以拖的方塊元件。

```ts
class UIDragBox extends UIElement {
  pointerDown(): PointerCapture {
    const start = { x: this.offsetX, y: this.offsetY };
    let first: { x: number; y: number } | null = null;
    return {
      move: (x, y) => {
        first ??= { x, y };
        this.offsetX = start.x + x - first.x;
        this.offsetY = start.y + y - first.y;
        this.ctx.requestLayout();
      },
      up: () => console.log('放開，位移', Math.round(this.offsetX), Math.round(this.offsetY)),
      cancel: () => ((this.offsetX = start.x), (this.offsetY = start.y)),
    };
  }
  get interactive() {
    return true;
  }
}
UI2D.register('UIDragBox', UIDragBox);
ui.loadString(`<UI padding="40"><UIDragBox width="80" height="80" background="#ff6b6b" radius="12"/></UI>`);
console.log('拖曳紅色方塊');
engine.start();
```

## Rect
矩形（介面座標，像素）：元件的 `layout`、`absoluteRect` 都是它。

```ts
ui.loadString(`<UI padding="30"><UILayout padding="10"><UIButton id="b" text="我在哪裡？"/></UILayout></UI>`);
ui.layout();
const r: Rect = ui.require<UIButton>('b').absoluteRect;
console.log(`x=${r.x} y=${r.y} 寬=${r.width} 高=${r.height}`);
```

## SceneDefinition
一個場景要準備的東西：名稱、載入頁面、HUD、要先下載的資源與介面、提示、進入與離開時的處理。

```ts
scenes.register({ name: 'cave', setup: () => {} });
uiXml.register({ '/ui/cave-hud.xml': async () => `<UI padding="12"><UILabel color="#fff">🦇 洞窟</UILabel></UI>` });
const cave: SceneDefinition = {
  title: '黑暗洞窟',
  hud: '/ui/cave-hud.xml',
  assets: ['sounds/pop.wav'],
  tips: ['帶上火把'],
  onEnter: () => console.log('進入洞窟'),
  onExit: () => console.log('離開洞窟'),
};
await new SceneTransition({ ui, scenes, assets }).define('cave', cave).go('cave');
engine.start();
```

## SceneTransitionOptions
SceneTransition 的設定：介面、場景、資源、載入頁面、效果、時間、顏色。

```ts
scenes.register({ name: 'a', setup: () => {} }, { name: 'b', setup: () => {} });
const options: SceneTransitionOptions = { ui, scenes, assets, effect: 'fade', duration: 0.5, color: '#ffffff', minLoadingTime: 0.5 };
const t = new SceneTransition(options).defineAll({ a: {}, b: {} });
await t.go('a');
ui.addLayer('btn', `<UI padding="12"><UIButton text="白色淡出換場景" onClick="go"/></UI>`);
ui.setHandler('go', () => t.go(t.current === 'a' ? 'b' : 'a'));
engine.start();
```

## SceneTransitionProgress
載入進度：場景、已完成／總數、比例、剛完成的檔案、失敗數。

```ts
scenes.register({ name: 'level', setup: () => {} });
const t = new SceneTransition({ ui, scenes, assets }).define('level', { assets: ['textures/checker.png', 'sounds/jump.wav', 'sounds/bounce.wav', 'models/robot.gltf'] });
t.onProgress((p: SceneTransitionProgress) => console.log(`${p.scene}：${p.loaded}/${p.total}（${Math.round(p.progress * 100)}%）`, p.item));
await t.go('level');
engine.start();
```

## ScreenFader
全螢幕單色層（`ui.screenFader`）：改透明度不用重畫介面（轉場、受傷閃紅）。點畫面閃一下紅色。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32' });
const fader: ScreenFader | null = ui.screenFader;
addEventListener('pointerdown', () => {
  const s = { a: 0.6 };
  tweens.to(s, { a: 0 }, { duration: 0.5, onUpdate: () => fader?.set(s.a, '#ff0000') });
});
console.log('有單色層嗎？', fader !== null);
engine.start();
```

## ScreenOptions
畫面的設定：名稱、modal（擋住下面）、背景顏色。

```ts
const screens = new UIScreenManager(ui);
const options: ScreenOptions = { title: '暫停選單', modal: true, backdrop: 'rgba(0,0,40,0.6)' };
screens.register('base', { xml: `<UI padding="16"><UIButton text="暫停" onClick="screen.open:pause"/></UI>` });
screens.register('pause', { xml: `<UI align="center" justify="center"><UIButton text="繼續" onClick="screen.back"/></UI>` }, options);
await screens.show('base');
console.log(screens.info('pause'));
engine.start();
```

## SelectOption
下拉選單的選項：值與顯示文字。

```ts
ui.loadString(`<UI padding="20"><UISelect id="s" onChange="c"/></UI>`);
const options: SelectOption[] = [{ value: 'easy', label: '簡單' }, { value: 'hard', label: '困難' }];
ui.require<UISelect>('s').setOptions(options).value = 'hard';
ui.setHandler('c', (e) => console.log('難度：', e.value));
engine.start();
```

## TableColumn
表格的欄位：資料的鍵、標題、寬度或比例、對齊、排序方式。

```ts
ui.loadString(`<UI padding="16"><UITable id="t" flex="1"/></UI>`);
const columns: (Partial<TableColumn> & { key: string })[] = [
  { key: 'item', title: '物品', flex: '2' },
  { key: 'price', title: '價格', width: '80', align: 'right', sort: 'number' },
  { key: 'note', title: '備註', sort: 'none' },
];
const t = ui.require<UITable>('t');
t.setColumns(columns);
t.setRows([{ item: '鐵劍', price: 120, note: '' }, { item: '藥水', price: 25, note: '回復 50' }, { item: '寶石', price: 500, note: '稀有' }]);
engine.start();
```

## TextMetrics
文字排版的結果：每一行、最寬的寬度、總高度。

```ts
ui.loadString(`<UI padding="20"><UILabel id="l" width="150" color="#fff">一段需要換行的長文字，看看會變成幾行。</UILabel></UI>`);
ui.layout();
const m: TextMetrics = ui.require<UILabel>('l').metrics;
console.log(m.lines.length, '行：', m.lines, '，寬', m.width.toFixed(0), '高', m.height.toFixed(0));
engine.start();
```

## ToastOptions
提示訊息的設定：圖示、顏色、秒數、背景。

```ts
const options: ToastOptions = { icon: 'heart', color: '#ff6b6b', duration: 4, background: 'rgba(80,0,0,0.8)' };
ui.loadString(`<UI/>`);
ui.toast('生命 +20', options);
engine.start();
```

## UI2DOptions
`UI2D.create(options)` 的設定：容器、尺寸、事件函式、斷點、顯示層……這裡建立一個寬度 ≥ 400 就生效 `wide:` 屬性的介面。

```ts
const options: UI2DOptions = {
  container: document.body,
  breakpoints: { wide: 400 },
  handlers: { hi: () => console.log('hi') },
  unknownTags: 'placeholder',
};
const mine = await UI2D.create(options);
mine.loadString(`<UI padding="16" gap="8" wide:dir="h"><UIButton text="A" onClick="hi"/><UIButton text="B" onClick="hi"/><UIMystery/></UI>`);
console.log('斷點：', mine.breakpoint, '，不認識的元件：', mine.unknownComponents);
```

## UIContext
元件共用的環境（`element.ctx`）：排版引擎、量文字、樣式、要求重排、動畫……自訂元件時用。

```ts
class UIStars extends UIElement {
  constructor(ctx: UIContext, type: string, raw: Attrs, _text: string) {
    super(ctx, type, raw);
    console.log('建立 UIStars，目前的斷點：', ctx.activeBreakpoints);
  }
  paintContent(g: Context2D, x: number, y: number, w: number, h: number) {
    const n = Number(this.get('count') ?? 3);
    for (let i = 0; i < n; i++) draw.icon(g, 'star', x + i * h, y, h, h, this.get('color') ?? '#ffd75e');
  }
}
UI2D.register('UIStars', UIStars);
ui.loadString(`<UI padding="20" gap="8"><UIStars count="3" width="96" height="32"/><UIStars count="5" width="120" height="24" color="#9acd32"/></UI>`);
engine.start();
```

## UIEvent
事件處理函式收到的資料：事件名稱、觸發的元件，以及各種元件附帶的資料（value、checked、item…）。

```ts
ui.loadString(`<UI padding="20" gap="8"><UIButton id="b" text="按我" onClick="log"/><UISlider onChange="log"/></UI>`);
ui.setHandler('log', (e: UIEvent) => console.log('事件', e.type, '，元件', e.target.constructor.name, '，value', e.value));
ui.require<UIButton>('b').click(); // 程式觸發
engine.start();
```

## UIPluginOptions
`UIPlugin.create(options)` 的設定：一開始就載入的介面檔、事件函式、斷點……

```ts
const options: UIPluginOptions = { scene: 'ui/scene.xml', handlers: { pause: () => engine.pause() }, breakpoints: { md: 768 } };
console.log('設定：', options);
```

## UIRenderer
顯示層介面：UI2D 排版或狀態改變後呼叫 `render()`。這裡寫一個「每次重畫就記一筆」的顯示層，套在無畫面的介面上。

```ts
let renders = 0;
const logger: UIRenderer = {
  attach: (u) => console.log('連接到介面，大小', u.size),
  render: () => void renders++,
  dispose: () => console.log('釋放，總共重畫', renders, '次'),
};
const headless = await UI2D.create({ container: null, width: 200, height: 100, autoTick: false });
headless.setRenderer(logger);
headless.loadString(`<UI><UILabel id="l">0</UILabel></UI>`);
for (let i = 1; i <= 3; i++) {
  headless.require<UILabel>('l').setText(i);
  headless.layout();
}
headless.destroy();
```

## UIRenderStats
介面重畫的統計（效能面板用）：完整、局部上傳次數、重畫時間、畫布模式。

```ts
ui.loadString(`<UI padding="20"><UIProgressBar id="p" value="0"/></UI>`);
engine.on('update', (t) => (ui.require<UIProgressBar>('p').value = (t.elapsed * 30) % 100));
engine.timers.after(2, () => {
  const s: UIRenderStats | null = ui.renderStats;
  if (s) console.log(`重畫 ${s.renders} 次（完整 ${s.full}、局部 ${s.partial}），共 ${s.ms.toFixed(1)} ms，模式 ${s.mode}`);
});
engine.start();
```

## XmlNode
XML 解析後的節點：標籤、屬性、子節點、文字、行號。

```ts
const node: XmlNode = uiXml.parse(`<UI padding="8">\n  <UILabel color="#fff">你好</UILabel>\n</UI>`);
const label = node.children[0];
console.log(node.tag, node.attrs, '→', label.tag, label.attrs, `「${label.text}」第 ${label.line} 行`);
```

## Attrs
XML 屬性：名稱 → 字串值。`UI2D.setSkin` 用它設定整個遊戲某種元件的外觀。

```ts
const skin: Attrs = { background: '#9acd32', hoverBackground: '#b4e05a', color: '#141a07', radius: '999' };
UI2D.setSkin('UIButton', skin);
ui.loadString(`<UI padding="20" gap="8"><UIButton text="套用全域外觀"/><UIButton text="每個按鈕都一樣"/></UI>`);
console.log('UIButton 的外觀：', UI2D.skins.get('UIButton'));
engine.start();
```

## ComponentConstructor
元件類別的建構函式型別（`UI2D.register` 用）。

```ts
class UIHello extends UILabel {
  defaults() {
    return { ...super.defaults(), color: '#ffd166', fontSize: '20' };
  }
}
const ctor: ComponentConstructor = UIHello;
UI2D.register('UIHello', ctor);
ui.loadString(`<UI padding="20"><UIHello>自訂的文字元件</UIHello></UI>`);
console.log('註冊了：', UI2D.components.get('UIHello') === ctor);
engine.start();
```

## Context2D
2D 繪圖環境：瀏覽器的 CanvasRenderingContext2D，或 OffscreenCanvas 的。

```ts
const g: Context2D = new OffscreenCanvas(100, 100).getContext('2d')!;
g.fillStyle = '#ff0000';
draw.roundRect(g, 10, 10, 80, 80, 12);
g.fill();
console.log('中心像素：', [...g.getImageData(50, 50, 1, 1).data]);
```

## ImageLoader
圖片載入器：回傳圖片原始尺寸。測試時可以換成假的。

```ts
const fakeLoader: ImageLoader = async (url) => {
  console.log('（假的）載入', url);
  return { width: 64, height: 32 };
};
const headless = await UI2D.create({ container: null, width: 200, height: 100, loadImage: fakeLoader });
headless.loadString(`<UI><UIImage id="i" src="any.png"/></UI>`);
await headless.whenReady();
headless.layout();
console.log('排版的大小：', headless.require<UIImage>('i').layout.width, 'x', headless.require<UIImage>('i').layout.height);
```

## ImageSourceLookup
依網址取得已載入的圖片（`UIPainter` 用它畫圖片）。

```ts
ui.loadString(`<UI padding="20"><UIImage src="ui/coin.png" width="48"/></UI>`);
await ui.whenReady();
const lookup: ImageSourceLookup = (url) => ui.imageSource(url);
const img = lookup(ui.root!.children[0].get('src')!) ?? lookup('/ui/coin.png');
console.log('找到圖片：', img !== undefined);
engine.start();
```

## ListType
清單的排列方式：直向、橫向、格狀。點按鈕切換。

```ts
ui.loadString(`<UI padding="14" gap="8"><UIButton text="切換排列" onClick="next"/><UIList id="l" flex="1" gap="6" columns="4">${Array.from({ length: 12 }, (_, i) => `<UISlot iconName="gem"><UIBadge value="${i + 1}"/></UISlot>`).join('')}</UIList></UI>`);
const types: ListType[] = ['vertical', 'horizontal', 'grid'];
let i = 2;
ui.require<UIList>('l').set('type', types[i]);
ui.setHandler('next', () => {
  const t = types[++i % 3];
  ui.require<UIList>('l').set('type', t);
  console.log('排列：', t);
});
engine.start();
```

## MeasureTextWidth
量單段文字寬度的函式型別。自己寫一個（例如每個字固定 10px），給無畫面的介面用。

```ts
const tenPx: MeasureTextWidth = (text) => text.length * 10;
const headless = await UI2D.create({ container: null, width: 300, height: 100, measure: tenPx });
headless.loadString(`<UI><UILabel id="l" width="fit">12345</UILabel></UI>`);
headless.layout();
console.log('5 個字 × 10px =', headless.require<UILabel>('l').layout.width);
```

## OverlayPainter
畫在所有元件之上的東西（介面座標）：拖曳中的圖示、浮動說明、教學提示圈。

```ts
ui.loadString(`<UI padding="40"><UIButton id="b" text="點這裡開始"/></UI>`);
const painter: OverlayPainter = (g) => {
  const r = ui.require<UIButton>('b').absoluteRect;
  const pulse = 6 + Math.sin(performance.now() / 200) * 4;
  g.strokeStyle = '#ffd166';
  g.lineWidth = 3;
  g.strokeRect(r.x - pulse, r.y - pulse, r.width + pulse * 2, r.height + pulse * 2);
};
const key = {};
ui.setOverlay(key, painter);
engine.on('update', () => ui.damageArea({ x: 0, y: 0, width: 400, height: 200 }));
engine.start();
```

## SceneTransitionChange
轉場的狀態改變：開始（start）或進入場景（enter）。

```ts
scenes.register({ name: 'x', setup: () => {} });
const t = new SceneTransition({ ui, scenes }).define('x');
t.onChange((c: SceneTransitionChange) => console.log(c.type === 'start' ? '開始轉場' : '進入場景', c.from, '→', c.to));
await t.go('x', {});
engine.start();
```

## ScreenChange
畫面的變化：顯示基本畫面、打開、關閉。

```ts
const screens = new UIScreenManager(ui).registerAll({ a: { xml: '<UI/>' }, pop: { xml: '<UI/>' } });
screens.onChange((c: ScreenChange) => console.log(c.type, c.name));
await screens.show('a');
await screens.open('pop');
screens.close('pop');
```

## ScreenSource
畫面的來源：網址或直接給 XML 文字。

```ts
uiXml.register({ '/ui/from-url.xml': async () => `<UI padding="16"><UILabel color="#fff">從網址載入</UILabel></UI>` });
const sources: Record<string, ScreenSource> = { byUrl: { url: '/ui/from-url.xml' }, byXml: { xml: `<UI padding="16"><UILabel color="#fff">直接給 XML</UILabel></UI>` } };
const screens = new UIScreenManager(ui);
for (const [name, src] of Object.entries(sources)) screens.register(name, src);
await screens.show('byUrl');
setTimeout(() => screens.show('byXml'), 1200);
engine.start();
```

## ScrollAxis
捲動方向：`x` 水平、`y` 垂直、`both` 兩個方向。

```ts
ui.loadString(`<UI padding="16"><UIScrollView id="s" scroll="both" width="220" height="140" background="#2c3326"><UILayout width="600" height="400" padding="10"><UILabel color="#fff">可以往右、往下捲（拖曳或滾輪）</UILabel></UILayout></UIScrollView></UI>`);
const axis: ScrollAxis = ui.require<UIScrollView>('s').scrollAxis;
console.log('捲動方向：', axis);
engine.start();
```

## TableRow
表格的一列資料：欄位名稱 → 值。

```ts
ui.loadString(`<UI padding="16"><UITable id="t" flex="1"><UIColumn key="name" title="名稱"/><UIColumn key="hp" title="HP" sort="number" align="right"/></UITable></UI>`);
const rows: TableRow[] = [{ name: '史萊姆', hp: 30 }, { name: '哥布林', hp: 55 }, { name: '巨龍', hp: 900 }];
ui.require<UITable>('t').setRows(rows);
console.log('顯示順序：', ui.require<UITable>('t').displayRows.map((r) => r.name));
engine.start();
```

## UICanvasMode
介面畫布的模式：`auto`（依瀏覽器決定）、`cpu`、`gpu`。在建立之前設定 `UITextureRenderer.canvasMode`。

```ts
const mode: UICanvasMode = UITextureRenderer.canvasMode;
console.log('預設模式：', mode, '，實際使用：', ui.renderStats?.mode ?? '（還沒重畫）');
```

## UIHandler
事件處理函式的型別：收到 UIEvent。

```ts
const onBuy: UIHandler = (e) => console.log('購買', e.target.get('text'));
ui.loadString(`<UI padding="20" dir="h" gap="8"><UIButton text="劍" onClick="buy"/><UIButton text="盾" onClick="buy"/></UI>`);
ui.setHandler('buy', onBuy);
engine.start();
```

## UICanvas
畫布：用 Canvas 2D 的寫法自己畫（底層是 WebGL）。`ui.require<UICanvas>(id).getContext()` 取得 ctx，取代 `canvas.getContext('2d')`；畫完介面會自動重畫。背景預設 `#333333FF`，完整的繪圖 API 見說明文件的「UICanvas 畫布」一章。

```ts
ui.loadString(`<UI align="center" justify="center"><UICanvas id="paint" width="320" height="200" radius="12"/></UI>`);
const uicanvas = ui.require<UICanvas>('paint');
const ctx = uicanvas.getContext();
const g = ctx.createLinearGradient(0, 0, 320, 0);
g.addColorStop(0, '#9acd32');
g.addColorStop(1, '#7fd6c2');
ctx.fillStyle = g;
ctx.beginPath();
ctx.arc(160, 100, 70, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 20px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.fillText('UICanvas', 160, 107);
console.log('WebGL 2：', ctx.isWebGL2, '，大小：', uicanvas.width, '×', uicanvas.height, '，像素比：', uicanvas.pixelRatio);
engine.start();
```

尺寸改變時內容會清空並觸發 `resize` 事件（XML 寫 `onResize`），在那裡重畫。

```ts
ui.loadString(`<UI align="center" justify="center"><UICanvas id="c" width="160" height="120"/></UI>`);
const uicanvas = ui.require<UICanvas>('c');
const draw = () => {
  const ctx = uicanvas.getContext();
  ctx.fillStyle = 'tomato';
  ctx.fillRect(10, 10, uicanvas.width - 20, uicanvas.height - 20);
};
uicanvas.on('resize', () => {
  console.log('新的大小：', uicanvas.width, '×', uicanvas.height);
  draw();
});
draw();
engine.timers.after(1, () => uicanvas.resize(300, 160));
engine.start();
```

## WebGL2DRenderingContext
`uicanvas.getContext()` 回傳的繪圖 context：方法、屬性和 `CanvasRenderingContext2D` 相同，另外有 `gl`、`isWebGL2`、`pixelRatio`、`createShaderFilter`、`applyFilter`。

```ts
ui.loadString(`<UI align="center" justify="center"><UICanvas id="c" width="320" height="200"/></UI>`);
const ctx: WebGL2DRenderingContext = ui.require<UICanvas>('c').getContext();
ctx.filter = 'blur(2px) hue-rotate(90deg)';
ctx.fillStyle = '#f59e0b';
ctx.fillRect(40, 40, 240, 120);
ctx.filter = 'none';
console.log('GL 版本：', ctx.gl.getParameter(ctx.gl.VERSION));
engine.start();
```

## ShaderFilter
自訂 GLSL 濾鏡：`ctx.createShaderFilter(source, uniforms)` 建立，放進 `ctx.filter` 或傳給 `ctx.applyFilter`。source 要定義 `vec4 effect(vec2 uv)`。

```ts
ui.loadString(`<UI align="center" justify="center"><UICanvas id="c" width="320" height="200"/></UI>`);
const ctx = ui.require<UICanvas>('c').getContext();
ctx.fillStyle = '#2457d6';
ctx.fillRect(20, 20, 280, 160);
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 36px system-ui, sans-serif';
ctx.fillText('ShaderFilter', 50, 115);
const wave: ShaderFilter = ctx.createShaderFilter(`
  uniform float amp;
  vec4 effect(vec2 uv) {
    uv.x += sin(uv.y * 30.0) * amp;
    return texture2D(u_src, uv);
  }
`, { amp: 0.01 });
ctx.applyFilter(wave);
console.log('uniform：', wave.uniformNames);
engine.start();
```

## WebGL2DOptions
建立 context 的選項（`uicanvas.getContext(options)`，只在第一次呼叫時有效）：反鋸齒、透明通道、WebGL 版本、保留畫面內容。

```ts
ui.loadString(`<UI align="center" justify="center"><UICanvas id="c" width="320" height="200"/></UI>`);
const options: WebGL2DOptions = { antialias: true, webgl2: true, preserveDrawingBuffer: true };
const ctx = ui.require<UICanvas>('c').getContext(options);
ctx.strokeStyle = '#9acd32';
ctx.lineWidth = 6;
ctx.strokeRect(40, 40, 240, 120);
console.log('context 設定：', ctx.getContextAttributes());
engine.start();
```

## WebGL2DHiDPIOptions
`UICanvas.contextOfHiDPI(canvas, options)` 的選項：介面以外的畫布（離屏圖層）以 CSS 尺寸 × 螢幕像素比的解析度繪製。

```ts
ui.loadString(`<UI align="center" justify="center"><UICanvas id="c" width="320" height="200"/></UI>`);
const options: WebGL2DHiDPIOptions = { width: 160, height: 100, setStyle: false };
const layer = UICanvas.contextOfHiDPI(document.createElement('canvas'), options);
layer.fillStyle = '#1e3a8a';
layer.fillRect(0, 0, 160, 100);
layer.fillStyle = '#f59e0b';
layer.beginPath();
layer.arc(80, 50, 34, 0, Math.PI * 2);
layer.fill();
const ctx = ui.require<UICanvas>('c').getContext();
ctx.drawImage(layer.canvas, 80, 50, 160, 100);
console.log('離屏圖層 backing store：', layer.canvas.width, '×', layer.canvas.height);
engine.start();
```
