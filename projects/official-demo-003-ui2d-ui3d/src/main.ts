/**
 * official-demo-003-ui2d-ui3d：2D 與 3D 介面。
 *
 * 五個分頁，每一頁是一個場景（切換分頁時換場景），右邊的 2D 疊加層也跟著換：
 *   ① HUD（hud）：血條、魔力、金幣、角標、技能冷卻、提示訊息，按鈕和技能讓 3D 角色做動作
 *   ② 背包（bag）：可拖曳的視窗、列表樣板 + 資料（物品格可以拖曳交換）、可排序的表格；點物品在 3D 顯示
 *   ③ 3D 面板（panels）：3D 空間裡可以點擊的商店看板、永遠面向攝影機的名牌血條
 *   ④ 對話（talk）：點 3D 角色（render.pick）開始 2D 對話，頭上的泡泡是 3D 面板
 *   ⑤ 畫布（canvas）：UICanvas 畫板（滑鼠畫圖，同時貼到 3D 看板）與即時折線圖（3D 彈跳球的高度）
 *
 * 介面在 public/ui/scene.xml（左邊的說明面板與右邊的疊加層）、public/ui/kiosk.xml（商店看板）。
 */
import type { Entity, World } from '@engine/ecs';
import { Color, Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { OrbitControl, create, spawn, type Texture } from '@engine/render';
import { type Scene, Transform, math } from '@engine/scene';
import * as ui2d from '@engine/ui2d';
import type {
  TableRow,
  UIBadge,
  UICooldown,
  UIDialogue,
  UIEvent,
  UILabel,
  UIProgressBar,
  UISlider,
  UISlot,
  UIStackView,
  UICanvas,
  UITable,
  UIToggle,
  UIWindow,
} from '@engine/ui2d';
import { UIPanel3D } from '@engine/ui3d';
import { audio, engine, hierarchy, input, render, scenes, tweens, ui, ui3d, world } from './engine';

type Vec3 = [number, number, number];

// ───────── 共用：舞台（燈光、地面）、每頁的攝影機 ─────────

for (const e of Object.values(spawn.defaultLights(world, { shadows: true }))) scenes.persist(e);
scenes.persist(
  spawn.mesh(world, {
    geometry: { circle: 9 },
    material: '#262c22',
    rotation: [-Math.PI / 2, 0, 0],
    receiveShadow: true,
  }),
);
scenes.persist(spawn.grid(world, { size: 18, divisions: 18, color: '#343c2e', position: [0, 0.01, 0] }));

/**
 * 這一頁的攝影機（可以用滑鼠轉動；換頁時跟著場景移除）。
 * 左邊的說明面板會擋住畫面左側，所以攝影機和注視點一起往左移一點，讓場景出現在右邊看得到的地方。
 */
function camera(position: Vec3, target: Vec3): Entity {
  const eye = new Vector3(...position);
  const look = new Vector3(...target);
  const right = look
    .clone()
    .sub(eye)
    .cross(new Vector3(0, 1, 0))
    .normalize();
  const shift = right.multiplyScalar(-0.15 * eye.distanceTo(look));
  eye.add(shift);
  look.add(shift);
  const cam = spawn.camera(world, { position: eye, target: look, fov: 50 });
  world.add(cam, OrbitControl, { target: look, minDistance: 3, maxDistance: 20, wheelNeedsFocus: true });
  return cam;
}

/** 每幀要做的事（只在目前這一頁執行；換頁時清掉） */
let pageUpdate: ((dt: number) => void) | null = null;
engine.on('update', (time) => pageUpdate?.(time.delta));

/** 點一下畫面（按下到放開幾乎沒移動）；拖曳是轉動視角，不算點擊 */
let press: { x: number; y: number } | null = null;
function clicked(): boolean {
  if (input.wasPressed('Mouse:Left')) press = { x: input.pointer.x, y: input.pointer.y };
  if (!input.wasReleased('Mouse:Left') || !press) return false;
  const moved = Math.hypot(input.pointer.x - press.x, input.pointer.y - press.y);
  press = null;
  return moved < 6;
}

/** 簡單的角色：根實體（移動、旋轉用）底下有身體與頭。回傳根實體與身體的材質（可以改顏色） */
function character(w: World, color: string, position: Vec3, name: string) {
  const root = w.spawn(Transform.at(...position));
  const skin = create.material({ standard: { color, roughness: 0.5 } });
  spawn.mesh(w, {
    geometry: { capsule: [0.35, 0.7] },
    material: skin,
    position: [0, 0.7, 0],
    castShadow: true,
    parent: root,
    name,
  });
  spawn.mesh(w, {
    geometry: { sphere: 0.27 },
    material: '#f1d2b4',
    position: [0, 1.5, 0],
    castShadow: true,
    parent: root,
    name,
  });
  return { root, skin };
}

/** 讓材質閃一下某個顏色，再補間回原本的顏色 */
function flash(skin: { color: Color }, color: string, base: string): void {
  tweens.killTweensOf(skin.color);
  const { r, g, b } = new Color(base);
  skin.color.set(color);
  tweens.to(skin.color, { r, g, b }, { duration: 0.5, easing: 'quadOut' });
}

// ───────── ① HUD ─────────

const HERO_COLOR = '#9acd32';
const SKILLS = [
  { key: 'Digit1', cd: 'cd1', mana: 15, seconds: 2 },
  { key: 'Digit2', cd: 'cd2', mana: 20, seconds: 3 },
  { key: 'Digit3', cd: 'cd3', mana: 30, seconds: 5 },
  { key: 'Digit4', cd: 'cd4', mana: 25, seconds: 4 },
] as const;
/** HUD 的數值（換頁後保留） */
const stats = { hp: 80, mp: 60, coins: 120, newItems: 2 };
let useSkill: (i: number) => void = () => {};
let hurtHero: () => void = () => {};
let healHero: (amount: number) => void = () => {};

/** 數值寫回 HUD（只有改變的元件會重畫） */
function syncHud(): void {
  ui.require<UIProgressBar>('hp').value = stats.hp;
  ui.require<UIProgressBar>('mp').value = stats.mp;
  ui.require<UILabel>('coins').setText(String(stats.coins));
  ui.require<UIBadge>('bagBadge').setValue(stats.newItems);
}

const hudPage: Scene = {
  name: 'hud',
  setup(w) {
    const cam = camera([0, 2.6, 6.5], [0, 1, 0]);
    const hero = character(w, HERO_COLOR, [0, 0, 0], '勇者');
    const t = w.require(hero.root, Transform);
    const look = { spin: 0 };
    const applySpin = () => math.setRotation(t, [0, look.spin, 0]);

    hurtHero = () => {
      flash(hero.skin, '#ff3b3b', HERO_COLOR);
      tweens.killTweensOf(t.position);
      t.position.x = 0;
      tweens.to(t.position, { x: 0.15 }, { duration: 0.05, repeat: 5, yoyo: true });
    };
    healHero = () => flash(hero.skin, '#7dffb0', HERO_COLOR);

    // 技能：閃電＝跳起來、旋風＝轉一圈、巨大化＝變大 2 秒、治療＝回血
    const actions = [
      () => tweens.to(t.position, { y: 1.2 }, { duration: 0.3, easing: 'quadOut', yoyo: true, repeat: 1 }),
      () => {
        look.spin = 0;
        tweens.to(look, { spin: Math.PI * 2 }, { duration: 0.6, easing: 'cubicInOut', onUpdate: applySpin });
      },
      () => {
        tweens.to(t.scale, { x: 1.6, y: 1.6, z: 1.6 }, { duration: 0.3, easing: 'backOut' });
        tweens.to(t.scale, { x: 1, y: 1, z: 1 }, { duration: 0.3, delay: 2, easing: 'quadIn' });
      },
      () => healHero(25),
    ];
    useSkill = (i) => {
      const skill = SKILLS[i];
      const cd = ui.require<UICooldown>(skill.cd);
      if (!cd.ready) return ui.toast(`冷卻中，還要 ${cd.remaining.toFixed(1)} 秒`, { icon: 'clock', color: '#c6cdbb' });
      if (stats.mp < skill.mana) return ui.toast('魔力不足', { icon: 'bolt', color: '#4cc9f0' });
      stats.mp -= skill.mana;
      if (i === 3) stats.hp = Math.min(100, stats.hp + 25);
      cd.start(skill.seconds);
      actions[i]();
      audio.play('sounds/jump.wav', { volume: 0.4, pitch: 0.8 + i * 0.15 });
      syncHud();
    };

    pageUpdate = () => {
      SKILLS.forEach((s, i) => input.wasPressed(s.key) && useSkill(i));
    };
    // 魔力每 0.2 秒回復 1 點（綁定攝影機：換頁時自動停止）
    engine.timers.every(
      0.2,
      () => {
        if (stats.mp >= 100) return;
        stats.mp += 1;
        ui.require<UIProgressBar>('mp').value = stats.mp;
      },
      { owner: cam },
    );
    syncHud();
  },
};

// ───────── ② 背包與表格 ─────────

interface ItemType {
  iconName: string;
  name: string;
  desc: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  stack: boolean;
  /** 在 3D 顯示時的樣子 */
  geometry: Parameters<typeof spawn.mesh>[1]['geometry'];
  color: string;
}

const ITEM_TYPES: ItemType[] = [
  {
    iconName: 'sword',
    name: '鐵劍',
    desc: '攻擊 +12',
    rarity: 'epic',
    stack: false,
    geometry: { box: [0.14, 1.4, 0.06] },
    color: '#c0c8d0',
  },
  {
    iconName: 'shield',
    name: '木盾',
    desc: '防禦 +5',
    rarity: 'rare',
    stack: false,
    geometry: { cylinder: [0.6, 0.12], rotation: [Math.PI / 2, 0, 0] },
    color: '#a0703a',
  },
  {
    iconName: 'potion',
    name: '回復藥水',
    desc: '回復 50 生命',
    rarity: 'uncommon',
    stack: true,
    geometry: { sphere: 0.4 },
    color: '#ff5a7a',
  },
  {
    iconName: 'gem',
    name: '藍寶石',
    desc: '可以賣很多錢',
    rarity: 'legendary',
    stack: true,
    geometry: { octahedron: 0.5 },
    color: '#4cc9f0',
  },
  {
    iconName: 'coin',
    name: '古代金幣',
    desc: '收藏品',
    rarity: 'common',
    stack: true,
    geometry: { cylinder: [0.45, 0.08], rotation: [Math.PI / 2, 0, 0] },
    color: '#ffd75e',
  },
  {
    iconName: 'fire',
    name: '火焰卷軸',
    desc: '學會火球術',
    rarity: 'rare',
    stack: false,
    geometry: { icosahedron: 0.45 },
    color: '#ff8c42',
  },
  {
    iconName: 'star',
    name: '星星碎片',
    desc: '集滿 5 個換獎勵',
    rarity: 'epic',
    stack: true,
    geometry: { dodecahedron: 0.45 },
    color: '#ffe066',
  },
];
const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
const BAG_SIZE = 15;

interface Item {
  type: ItemType;
  count: number;
}
/** 背包的資料（15 格，null 是空格）：畫面一律由這份資料產生 */
const bag: (Item | null)[] = Array.from({ length: BAG_SIZE }, () => null);
// 一開始有的東西：鐵劍、木盾、5 瓶藥水、2 顆藍寶石、火焰卷軸
bag[0] = { type: ITEM_TYPES[0], count: 1 };
bag[1] = { type: ITEM_TYPES[1], count: 1 };
bag[2] = { type: ITEM_TYPES[2], count: 5 };
bag[3] = { type: ITEM_TYPES[3], count: 2 };
bag[4] = { type: ITEM_TYPES[5], count: 1 };

/** 資料 → 列表（樣板裡的 {index}、{iconName}… 換成每一格的值） */
function renderBag(): void {
  ui.setItems(
    'items',
    bag.map((it, index) => ({
      index,
      iconName: it?.type.iconName ?? '',
      count: it && it.count > 1 ? it.count : '',
      rarity: it?.type.rarity ?? '',
      name: it?.type.name ?? '',
      desc: it?.type.desc ?? '',
    })),
  );
  ui.require<UILabel>('itemCount').setText(`${bag.filter(Boolean).length} / ${BAG_SIZE}`);
}

/** 格子的 id 是 item{index} */
const slotIndex = (slot: unknown) => Number((slot as UISlot).id?.replace('item', '') ?? -1);

const PLAYERS = ['小明', '小華', '阿美', '大雄', '靜香', '胖虎', '小夫', '出木杉'];
const randomRows = (): TableRow[] =>
  PLAYERS.map((name) => ({ name, score: Math.round(500 + Math.random() * 2500) }))
    .sort((a, b) => b.score - a.score)
    .map((row, i) => ({ rank: i + 1, ...row }));

let showItem: (type: ItemType) => void = () => {};

const bagPage: Scene = {
  name: 'bag',
  setup(w) {
    camera([0, 2.2, 5.5], [0, 1.2, 0]);
    // 展示台：點背包裡的物品，在台子上方轉
    spawn.mesh(w, {
      geometry: { cylinder: [0.8, 0.6] },
      material: '#3a4232',
      position: [0, 0.3, 0],
      castShadow: true,
      receiveShadow: true,
    });
    let shown: Entity | null = null;
    showItem = (type) => {
      if (shown !== null) w.destroy(shown);
      shown = spawn.mesh(w, {
        geometry: type.geometry,
        material: { standard: { color: type.color, roughness: 0.3, metalness: 0.3 } },
        position: [0, 1.5, 0],
        castShadow: true,
      });
      const t = w.require(shown, Transform);
      t.scale.setScalar(0.01);
      tweens.to(t.scale, { x: 1, y: 1, z: 1 }, { duration: 0.4, easing: 'backOut', entity: shown });
    };
    let angle = 0;
    pageUpdate = (dt) => {
      angle += dt;
      if (shown !== null && w.isAlive(shown)) math.setRotation(w.require(shown, Transform), [0.3, angle, 0]);
    };
    stats.newItems = 0;
    renderBag();
    ui.require<UITable>('rank').setRows(randomRows());
    showItem(ITEM_TYPES[0]);
  },
};

// ───────── ③ 3D 面板 ─────────

const NPCS = [
  { name: '哥布林', color: '#7bc96f' },
  { name: '史萊姆', color: '#4cc9f0' },
  { name: '骷髏兵', color: '#d8d8d0' },
];
/** 名牌：直接寫 XML（每個角色的名字不同） */
const nameTag = (name: string, hp: number) => `
  <UI width="180" height="52" padding="6 10" gap="5" background="rgba(0,0,0,0.65)" radius="10">
    <UILabel color="#ffffff" fontSize="15" fontWeight="bold">${name}</UILabel>
    <UIProgressBar id="hp" value="${hp}" width="100%" height="9" fill="#ff5a5a"/>
  </UI>`;

let tags: Entity[] = [];
let kiosk: Entity | null = null;
let money = 100;
let buyCube: (color: string, price: number) => void = () => {};

/** 左邊面板的開關、滑桿 → 3D 面板的設定（直接改元件資料，下一幀生效） */
function applyPanelOptions(): void {
  for (const tag of tags) {
    const p = world.get(tag, UIPanel3D);
    if (!p) continue;
    p.billboard = ui.require<UIToggle>('billboard').checked;
    p.depthTest = ui.require<UIToggle>('depthTest').checked;
  }
  const k = kiosk !== null ? world.get(kiosk, UIPanel3D) : undefined;
  if (k) {
    k.lit = ui.require<UIToggle>('lit').checked;
    k.worldWidth = ui.require<UISlider>('kioskSize').value;
  }
}

const panelsPage: Scene = {
  name: 'panels',
  setup(w) {
    camera([0, 3.2, 8], [0, 1.4, 0]);
    // 商店看板：立在柱子上，稍微轉向攝影機
    spawn.mesh(w, {
      geometry: { box: [0.15, 1.4, 0.15] },
      material: '#4a5340',
      position: [-2.6, 0.7, -0.5],
      castShadow: true,
    });
    kiosk = w.spawn(Transform.at(-2.6, 2.3, -0.5), UIPanel3D.with({ src: 'ui/kiosk.xml', worldWidth: 2.2 }));
    math.setRotation(w.require(kiosk, Transform), [0, 0.35, 0]);
    const setMoney = () => ui3d.uiOf(kiosk!)?.get<UILabel>('money')?.setText(String(money));

    // 中間的石柱：關掉 depthTest 時，名牌繞到柱子後面也看得到
    spawn.mesh(w, {
      geometry: { box: [0.8, 2.6, 0.8] },
      material: '#5a6350',
      position: [1.8, 1.3, 0],
      castShadow: true,
    });

    // 三個繞圈走的角色，頭上有名牌（billboard：永遠面向攝影機；interactive: false：滑鼠穿透）
    const walkers = NPCS.map((npc, i) => {
      const c = character(w, npc.color, [0, 0, 0], npc.name);
      const tag = w.spawn(
        Transform.at(0, 2.15, 0),
        UIPanel3D.with({ xml: nameTag(npc.name, 100 - i * 25), worldWidth: 1.1, billboard: true, interactive: false }),
      );
      hierarchy.setParent(tag, c.root);
      return { ...c, tag, phase: (i / NPCS.length) * Math.PI * 2 };
    });
    tags = walkers.map((x) => x.tag);
    let time = 0;
    pageUpdate = (dt) => {
      time += dt * 0.5;
      for (const x of walkers) {
        const a = time + x.phase;
        const t = w.require(x.root, Transform);
        t.position.set(1.8 + Math.cos(a) * 2, 0, Math.sin(a) * 2);
        math.setRotation(t, [0, -a, 0]); // 面向前進的方向
      }
    };

    const cubes: Entity[] = [];
    buyCube = (color, price) => {
      if (money < price) {
        ui.toast('金幣不夠，按「把錢補滿」', { icon: 'coin', color: '#ffd75e' });
        return;
      }
      money -= price;
      setMoney();
      const size = 0.4 + Math.random() * 0.25;
      const cube = spawn.mesh(w, {
        geometry: { box: size },
        material: { standard: { color, roughness: 0.4, metalness: color === '#ffd75e' ? 0.7 : 0 } },
        position: [-1 + Math.random() * 1.4, 6, 1 + Math.random() * 1.6],
        rotation: [0, Math.random() * 3, 0],
        castShadow: true,
      });
      tweens.to(
        w.require(cube, Transform).position,
        { y: size / 2 },
        { duration: 0.9, easing: 'bounceOut', entity: cube },
      );
      cubes.push(cube);
      if (cubes.length > 20) w.destroy(cubes.shift()!);
      audio.play('sounds/pop.wav', { volume: 0.5 });
    };
    // 面板載入完成後才有介面，才能改上面的文字
    engine.timers.after(0.3, setMoney, { owner: kiosk });
    applyPanelOptions();
  },
};

// 3D 面板裡的 onClick：所有 3D 面板共用這組處理函式
ui3d.setHandlers({
  buyRed: () => buyCube('#ff6b6b', 10),
  buyBlue: () => buyCube('#4c8df0', 20),
  buyGold: () => buyCube('#ffd75e', 50),
  refill: () => {
    money = 100;
    if (kiosk !== null) ui3d.uiOf(kiosk)?.get<UILabel>('money')?.setText(String(money));
  },
  bubble: () => startTalk(),
});

// ───────── ④ 對話 ─────────

const LINES = [
  '勇者，你終於來了！歡迎來到[b]綠葉村[/b]。',
  '最近森林裡出現了[color=#ff6b6b]怪物[/color]，村民都不敢出門……',
  '牠們好像在找[color=#4cc9f0]藍寶石[/color] [icon=gem color=#4cc9f0]。你可以幫我們調查嗎？',
];
/** 對話的狀態：idle（還沒開始）→ talking（一句一句）→ choosing（選擇中）→ done（說完最後一句，再點就關閉） */
let talkState: 'idle' | 'talking' | 'choosing' | 'done' = 'idle';
let line = 0;
let questAccepted = false;
let chief: ReturnType<typeof character> | null = null;
let bubble: Entity | null = null;

const dialogue = () => ui.require<UIDialogue>('dialogue');
const setBubble = (mark: string) =>
  bubble !== null ? ui3d.uiOf(bubble)?.get<UILabel>('mark')?.setText(mark) : undefined;

function startTalk(): void {
  if (talkState !== 'idle' || currentPage !== 'talk') return;
  talkState = 'talking';
  line = 0;
  dialogue().visible = true;
  dialogue().say(questAccepted ? '藍寶石找到了嗎？森林就在村子的北邊。' : LINES[0], { speaker: '村長' });
  if (questAccepted) talkState = 'done';
  audio.play('sounds/pop.wav', { volume: 0.4 });
}

function endTalk(): void {
  talkState = 'idle';
  dialogue().visible = false;
}

const talkPage: Scene = {
  name: 'talk',
  setup(w) {
    camera([2.4, 2.6, 6.5], [0, 1.2, 0]);
    chief = character(w, '#b072ff', [0, 0, 0], '村長');
    // 村長頭上的泡泡：3D 面板（billboard），點它也能開始對話
    bubble = w.spawn(
      Transform.at(0, 2.35, 0),
      UIPanel3D.with({
        xml: `<UI width="64" height="64" radius="32" background="#ffd166" align="center" justify="center" border="3 #ffffff" onClick="bubble">
          <UILabel id="mark" fontSize="36" fontWeight="bold" color="#3a2a00">${questAccepted ? '…' : '!'}</UILabel>
        </UI>`,
        worldWidth: 0.5,
        billboard: true,
      }),
    );
    hierarchy.setParent(bubble, chief.root);
    // 幾棵樹當背景
    for (const [x, z] of [
      [-3, -2],
      [3.5, -2.5],
      [-4, 1.5],
      [4, 1],
    ]) {
      spawn.mesh(w, {
        geometry: { cylinder: [0.15, 1] },
        material: '#6b4a2b',
        position: [x, 0.5, z],
        castShadow: true,
      });
      spawn.mesh(w, { geometry: { cone: [0.8, 1.8] }, material: '#3f7a3a', position: [x, 1.8, z], castShadow: true });
    }
    // 泡泡上下浮動；點到村長或按 E 開始對話
    const bubbleT = w.require(bubble, Transform);
    let time = 0;
    pageUpdate = (dt) => {
      time += dt;
      bubbleT.position.y = 2.35 + Math.sin(time * 3) * 0.06;
      if (input.wasPressed('KeyE')) startTalk();
      if (clicked()) {
        const hit = render.pick(input.pointer.ndcX, input.pointer.ndcY);
        if (hit && chief && hierarchy.parentOf(hit.entity) === chief.root) startTalk();
      }
    };
    endTalk();
  },
};

ui.setHandlers({
  // 對話框：說完一句（點一下）→ 下一句；最後一句給選項
  talkNext: () => {
    if (talkState === 'done') return endTalk();
    if (talkState !== 'talking') return;
    line++;
    if (line < LINES.length - 1) dialogue().say(LINES[line]);
    else {
      talkState = 'choosing';
      dialogue().say(LINES[line], {
        choices: [
          { value: 'yes', label: '交給我吧！' },
          { value: 'no', label: '我考慮一下' },
        ],
      });
    }
  },
  talkChoose: (e: UIEvent) => {
    talkState = 'done';
    if (e.value === 'yes') {
      questAccepted = true;
      dialogue().say('[b]太好了！[/b]找到藍寶石就回來找我，我會好好答謝你。');
      ui.require<UILabel>('quest').setText('進行中：調查森林、找到藍寶石');
      ui.toast('接受任務：森林的怪物', { icon: 'star', color: '#ffd166' });
      setBubble('…');
      if (chief) {
        const p = world.require(chief.root, Transform).position;
        tweens.to(p, { y: 0.6 }, { duration: 0.25, easing: 'quadOut', yoyo: true, repeat: 1 });
        flash(chief.skin, '#ffd166', '#b072ff');
      }
    } else {
      dialogue().say('好吧……改變主意的話再來找我。');
    }
  },
  resetTalk: () => {
    questAccepted = false;
    ui.require<UILabel>('quest').setText('還沒接任務');
    setBubble('!');
    endTalk();
  },
});

// ───────── ⑤ 畫布（UICanvas） ─────────

const PEN_COLORS = ['#9acd32', '#ff6b6b', '#4cc9f0', '#ffd166', '#ffffff'];
let penColor = PEN_COLORS[0];
/** 3D 看板用的貼圖：來源是畫板底下的 <canvas>，畫了新東西就設定 needsUpdate */
let padTexture: Texture | null = null;

const pad = ui.require<UICanvas>('pad');
const padCtx = pad.getContext(); // 取代 canvas.getContext('2d')
/** 畫板有新內容、3D 看板還沒更新 */
let padDirty = false;
const padChanged = () => {
  padDirty = true;
};
/**
 * 更新 3D 看板的貼圖（每幀呼叫）。把 WebGL 畫布上傳到另一個 WebGL（three.js）時，
 * 瀏覽器每次都要建立再銷毀一份畫布快照，很耗 GPU；畫圖中每秒最多更新 15 次，放開滑鼠時馬上補上最後的樣子
 */
let padUploadWait = 0;
function syncPadTexture(dt: number): void {
  padUploadWait -= dt;
  if (!padDirty || !padTexture || (penDown && padUploadWait > 0)) return;
  padTexture.needsUpdate = true;
  padDirty = false;
  padUploadWait = 1 / 15;
}

/** 清除畫板：淡淡的格線與提示文字 */
function clearPad(): void {
  const { width: w, height: h } = pad;
  padCtx.clearRect(0, 0, w, h);
  padCtx.strokeStyle = 'rgba(255,255,255,0.06)';
  padCtx.lineWidth = 1;
  padCtx.beginPath();
  for (let x = 20; x < w; x += 20) {
    padCtx.moveTo(x + 0.5, 0);
    padCtx.lineTo(x + 0.5, h);
  }
  for (let y = 20; y < h; y += 20) {
    padCtx.moveTo(0, y + 0.5);
    padCtx.lineTo(w, y + 0.5);
  }
  padCtx.stroke();
  padCtx.fillStyle = 'rgba(255,255,255,0.35)';
  padCtx.font = '13px system-ui, sans-serif';
  padCtx.fillText('按住滑鼠在這裡畫圖', 12, 22);
  padChanged();
}

/** 筆的樣式：顏色、粗細、發光（陰影模糊） */
function penStyle(): void {
  padCtx.strokeStyle = padCtx.fillStyle = penColor;
  padCtx.lineWidth = ui.require<UISlider>('penSize').value;
  padCtx.lineCap = padCtx.lineJoin = 'round';
  const glow = ui.require<UIToggle>('penGlow').checked;
  padCtx.shadowColor = penColor;
  padCtx.shadowBlur = glow ? 10 : 0;
}

// 滑鼠拖曳：event.value 是畫板的繪圖座標 { x, y }
// 滑鼠事件一秒可能上百次（比畫面更新還頻繁）：事件裡只記下座標，每幀一次畫成一條路徑（flushPen），
// 畫圖、更新介面、上傳 3D 貼圖都是每幀一次，GPU 才不會忙不過來；筆跡的轉角也比較圓順
type Point = { x: number; y: number };
/** 還沒畫的點（第一個是上一幀畫到的位置，用來接上） */
let penPoints: Point[] = [];
let penDown = false;
/** 剛按下：只點一下也要畫出一個點 */
let penDot = false;
pad.on('pointerdown', (e) => {
  penDown = penDot = true;
  penPoints = [e.value as Point];
});
pad.on('pointermove', (e) => {
  if (penDown) penPoints.push(e.value as Point);
});
pad.on('pointerup', () => {
  flushPen();
  penDown = false;
  penPoints = [];
});

/** 把累積的點畫出來（每幀呼叫一次） */
function flushPen(): void {
  if (penPoints.length === 0 || (penPoints.length === 1 && !penDot)) return;
  penStyle();
  padCtx.beginPath();
  if (penPoints.length === 1) {
    const p = penPoints[0];
    padCtx.arc(p.x, p.y, padCtx.lineWidth / 2, 0, Math.PI * 2);
    padCtx.fill();
  } else {
    padCtx.moveTo(penPoints[0].x, penPoints[0].y);
    for (const p of penPoints.slice(1)) padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
  }
  penDot = false;
  penPoints = penDown ? [penPoints[penPoints.length - 1]] : [];
  padChanged();
}
clearPad();

/** 折線圖：最近 3 秒的高度紀錄 */
const chart = ui.require<UICanvas>('chart');
const chartCtx = chart.getContext();
const CHART_MAX = 3; // 公尺
const CHART_SECONDS = 3;
/** 取樣間隔（秒）：固定時間取一點，和畫面更新率無關 */
const CHART_STEP = 1 / 30;
/** 紀錄（t 是秒、y 是高度）：位置依時間算，所以不管畫面更新率多少，捲動都是平滑的 */
const samples: { t: number; y: number }[] = [];
let chartTime = 0;
/** 上一幀的時間與高度（取樣點落在兩幀之間時用來內插） */
let prevTime = 0;
let prevY = 0;
/** 曲線下方的漸層：建立一次重複使用（每幀建立新的漸層會一直配置新的 GPU 紋理） */
const chartFill = chartCtx.createLinearGradient(0, 0, 0, chart.height);
chartFill.addColorStop(0, 'rgba(154,205,50,0.45)');
chartFill.addColorStop(1, 'rgba(154,205,50,0)');

function resetChart(y: number): void {
  samples.length = 0;
  chartTime = prevTime = 0;
  prevY = y;
  samples.push({ t: 0, y });
}

/**
 * 記錄高度：每隔 CHART_STEP 秒取一點，落在兩幀之間的用前後兩幀內插。
 * 時間和高度一定對得上，畫面更新率高低、偶爾掉幀，曲線都不會抖
 */
function recordHeight(dt: number, y: number): void {
  chartTime += dt;
  let next = samples[samples.length - 1].t + CHART_STEP;
  while (next <= chartTime) {
    const f = (next - prevTime) / Math.max(1e-6, chartTime - prevTime);
    samples.push({ t: next, y: prevY + (y - prevY) * f });
    next += CHART_STEP;
  }
  prevTime = chartTime;
  prevY = y;
  // 只留看得到的（左邊多留一點，給左邊界內插用）
  while (samples.length > 2 && samples[1].t < chartTime - CHART_SECONDS) samples.shift();
}

/** 沿著紀錄點畫平滑曲線：相鄰兩點的中點用二次曲線接起來（沒有折角） */
function smoothPath(c: typeof chartCtx, pts: { x: number; y: number }[]): void {
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const end = pts[pts.length - 1];
  c.lineTo(end.x, end.y);
}

function drawChart(): void {
  const { width: w, height: h } = chart;
  const c = chartCtx;
  const left = 20;
  const right = w - 6;
  c.clearRect(0, 0, w, h);
  // 刻度
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  c.lineWidth = 1;
  c.fillStyle = 'rgba(255,255,255,0.4)';
  c.font = '10px system-ui, sans-serif';
  c.beginPath();
  for (let m = 0; m <= CHART_MAX; m++) {
    const y = h - 6 - (m / CHART_MAX) * (h - 14);
    c.moveTo(left - 2, Math.round(y) + 0.5);
    c.lineTo(w, Math.round(y) + 0.5);
    c.fillText(String(m), 4, y + 3);
  }
  c.stroke();
  const toX = (t: number) => right - ((chartTime - t) / CHART_SECONDS) * (right - left);
  const toY = (v: number) => h - 6 - (v / CHART_MAX) * (h - 14);
  // 最後一點用目前的高度（取樣點之間也跟著動），左邊界上的點用內插算出來（不用每幀裁切）
  const data = [...samples, { t: chartTime, y: prevY }];
  const t0 = chartTime - CHART_SECONDS;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const s = data[i];
    if (s.t < t0) {
      const n = data[i + 1];
      if (n && n.t > t0) pts.push({ x: left, y: toY(s.y + ((n.y - s.y) * (t0 - s.t)) / (n.t - s.t)) });
      continue;
    }
    pts.push({ x: toX(s.t), y: toY(s.y) });
  }
  if (pts.length < 3) return;
  // 曲線下方的漸層 + 曲線
  c.beginPath();
  smoothPath(c, pts);
  c.lineTo(pts[pts.length - 1].x, h);
  c.lineTo(pts[0].x, h);
  c.closePath();
  c.fillStyle = chartFill;
  c.fill();
  c.beginPath();
  smoothPath(c, pts);
  c.strokeStyle = '#c8f07a';
  c.lineWidth = 2;
  c.lineJoin = c.lineCap = 'round';
  c.stroke();
  // 目前的值
  const end = pts[pts.length - 1];
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
  c.fill();
}

// ───────── 點 3D 看板長出花朵 ─────────

interface Flower {
  x: number;
  y: number;
  /** 花的半徑（繪圖座標） */
  size: number;
  petals: number;
  hue: number;
  spin: number;
  /** 綻放的進度（秒） */
  age: number;
}
/** 正在綻放的花（綻放完就不用再畫，留在畫板上） */
const flowers: Flower[] = [];
const BLOOM_SECONDS = 0.6;

function addFlower(x: number, y: number): void {
  flowers.push({
    x,
    y,
    size: 16 + Math.random() * 16,
    petals: 5 + Math.floor(Math.random() * 4),
    hue: [330, 350, 280, 200, 45, 15][Math.floor(Math.random() * 6)] + Math.random() * 20,
    spin: Math.random() * Math.PI,
    age: 0,
  });
}

/** 畫一朵花：scale 0～1 是綻放程度（每幀用更大的尺寸畫在原本的上面，花瓣不透明，所以不會越疊越深） */
function drawFlower(f: Flower, scale: number): void {
  const c = padCtx;
  const r = f.size * scale;
  c.save();
  c.shadowBlur = 0;
  c.translate(f.x, f.y);
  c.rotate(f.spin + (1 - scale) * 0.8); // 一邊轉一邊打開
  for (let i = 0; i < f.petals; i++) {
    const a = (i / f.petals) * Math.PI * 2;
    c.save();
    c.rotate(a);
    c.fillStyle = `hsl(${f.hue} 75% 62%)`;
    c.beginPath();
    c.ellipse(r * 0.55, 0, r * 0.52, r * 0.3, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = `hsl(${f.hue} 90% 80%)`;
    c.beginPath();
    c.ellipse(r * 0.5, 0, r * 0.3, r * 0.14, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.fillStyle = '#ffd166';
  c.beginPath();
  c.arc(0, 0, r * 0.24, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#c9822b';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.beginPath();
    c.arc(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12, Math.max(0.5, r * 0.035), 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** 讓花綻放（每幀呼叫） */
function growFlowers(dt: number): void {
  if (flowers.length === 0) return;
  for (const f of flowers) {
    f.age = Math.min(BLOOM_SECONDS, f.age + dt);
    const t = f.age / BLOOM_SECONDS;
    // 先快後慢地打開（cubicOut）；只會越畫越大，新的一層剛好蓋住上一層
    const scale = 1 - (1 - t) ** 3;
    drawFlower(f, scale);
  }
  for (let i = flowers.length - 1; i >= 0; i--) if (flowers[i].age >= BLOOM_SECONDS) flowers.splice(i, 1);
  padChanged();
}

const canvasPage: Scene = {
  name: 'canvas',
  setup(w) {
    camera([0, 2.4, 7], [0, 1.4, 0]);
    flowers.length = 0;
    // 3D 看板：畫板的內容當成貼圖（同一張 <canvas>，畫了新東西就更新）
    padTexture = create.texture(pad.canvas);
    spawn.mesh(w, {
      geometry: { box: [3.3, 2.3, 0.08] },
      material: '#4a5340',
      position: [-1.2, 1.75, -0.05],
      castShadow: true,
    });
    // 畫板沒畫到的地方是透明的（介面裡露出 UICanvas 的背景 #333333）：看板也墊一塊同色的底板，再疊上半透明的貼圖
    const boardSize: [number, number] = [3.1, 3.1 * (pad.height / pad.width)];
    const boardBack = spawn.mesh(w, {
      geometry: { plane: boardSize },
      material: { basic: { color: '#333333' } },
      position: [-1.2, 1.75, 0],
    });
    const board = spawn.mesh(w, {
      geometry: { plane: boardSize },
      material: { basic: { map: padTexture, transparent: true, depthWrite: false } },
      position: [-1.2, 1.75, 0.005],
    });
    for (const x of [-2.6, 0.2])
      spawn.mesh(w, { geometry: { box: [0.12, 0.7, 0.12] }, material: '#3a4232', position: [x, 0.35, -0.05] });

    // 彈跳球：高度畫在折線圖上
    const ball = spawn.mesh(w, {
      geometry: { sphere: 0.3 },
      material: { standard: { color: '#ffd166', roughness: 0.35 } },
      position: [2.2, 0.3, 0.5],
      castShadow: true,
    });
    const t = w.require(ball, Transform);
    const sim = { y: 2.5, vy: 0 };
    resetChart(sim.y);
    pageUpdate = (dt) => {
      // 點 3D 看板：射線點選拿到貼圖座標（uv，左下 0,0），換算成畫板的繪圖座標（左上 0,0），在那裡長出一朵花
      if (clicked()) {
        const hit = render.pick(input.pointer.ndcX, input.pointer.ndcY);
        if (hit?.uv && (hit.entity === board || hit.entity === boardBack)) {
          addFlower(hit.uv.x * pad.width, (1 - hit.uv.y) * pad.height);
          audio.play('sounds/pop.wav', { volume: 0.45, pitch: 1.1 + Math.random() * 0.4 });
        }
      }
      flushPen();
      growFlowers(dt);
      syncPadTexture(dt);
      // 簡單的重力與反彈；彈不動了就再丟高一次
      sim.vy -= 9.8 * dt;
      sim.y += sim.vy * dt;
      if (sim.y < 0) {
        sim.y = 0;
        sim.vy = Math.abs(sim.vy) * 0.78;
        if (sim.vy < 1.2) sim.vy = 7;
      }
      t.position.y = 0.3 + sim.y;
      // 折線圖每幀重畫（捲動才平滑；UICanvas 每幀最多更新介面一次）
      recordHeight(dt, sim.y);
      drawChart();
    };
    padChanged();
  },
};

ui.setHandlers({
  penColor: (e) => {
    penColor = PEN_COLORS[Number(e.target?.id?.replace('pen', '') ?? 0)] ?? PEN_COLORS[0];
  },
  clearPad: () => clearPad(),
  // 程式畫一顆星星（路徑、漸層、描邊）
  drawStar: () => {
    const cx = 40 + Math.random() * (pad.width - 80);
    const cy = 40 + Math.random() * (pad.height - 80);
    const r = 22 + Math.random() * 18;
    padCtx.save();
    padCtx.shadowBlur = 0;
    padCtx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      padCtx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    padCtx.closePath();
    const g = padCtx.createRadialGradient(cx, cy - r * 0.3, 2, cx, cy, r);
    g.addColorStop(0, '#fff6cc');
    g.addColorStop(1, penColor);
    padCtx.fillStyle = g;
    padCtx.fill();
    padCtx.lineWidth = 2;
    padCtx.strokeStyle = 'rgba(0,0,0,0.35)';
    padCtx.stroke();
    padCtx.restore();
    padChanged();
  },
});

// ───────── 分頁切換 ─────────

scenes.register(hudPage, bagPage, panelsPage, talkPage, canvasPage);
/** 每一頁對應的 2D 疊加層 */
const LAYERS: Record<string, string> = { hud: 'hudLayer', bag: 'bagLayer', talk: 'talkLayer', canvas: 'canvasLayer' };
let currentPage = '';
function showPage(name: string): void {
  if (name === currentPage) return;
  pageUpdate = null;
  currentPage = name;
  for (const [page, layer] of Object.entries(LAYERS)) ui.require(layer).visible = page === name;
  // 一般載入（不疊加）：先卸載上一頁，之後按按鈕、計時器建立的物件也算這一頁的，換頁時一起清掉
  scenes.load(name);
}

ui.setHandlers({
  page: () => showPage(ui.require<UIStackView>('pages').selectedPage?.id ?? 'hud'),
  // ① HUD
  hurt: () => {
    stats.hp = Math.max(0, stats.hp - 15);
    hurtHero();
    syncHud();
    if (stats.hp === 0) ui.toast('倒下了！喝藥水回復', { icon: 'heart', color: '#ff6b6b' });
  },
  heal: () => {
    stats.hp = Math.min(100, stats.hp + 30);
    healHero(30);
    syncHud();
  },
  coin: () => {
    const n = 10 + Math.floor(Math.random() * 20);
    stats.coins += n;
    stats.newItems++;
    syncHud();
    ui.toast(`獲得金幣 ×${n}`, { icon: 'coin', color: '#ffd75e' });
    audio.play('sounds/pop.wav', { volume: 0.5, pitch: 1.3 });
  },
  openBag: () => ui.require<UIStackView>('pages').show('bag', true),
  skill1: () => useSkill(0),
  skill2: () => useSkill(1),
  skill3: () => useSkill(2),
  skill4: () => useSkill(3),
  // ② 背包與表格
  pickItem: (e) => {
    const item = bag[slotIndex(e.target)];
    if (!item) return;
    showItem(item.type);
  },
  dropItem: (e) => {
    const from = slotIndex((e as unknown as { source: UISlot }).source);
    const to = slotIndex(e.target);
    if (from < 0 || to < 0 || from === to) return;
    [bag[from], bag[to]] = [bag[to], bag[from]];
    renderBag();
  },
  addItem: () => {
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    const same = type.stack ? bag.find((it) => it?.type === type) : undefined;
    if (same) same.count++;
    else {
      const empty = bag.indexOf(null);
      if (empty === -1) return ui.toast('背包滿了', { icon: 'close', color: '#ff6b6b' });
      bag[empty] = { type, count: 1 };
    }
    renderBag();
    showItem(type);
    ui.toast(`獲得 ${type.name}`, { icon: type.iconName, color: ui2d.RARITY_COLORS[type.rarity] });
  },
  sortItems: () => {
    const items = bag.filter((it): it is Item => it !== null);
    items.sort((a, b) => RARITY_ORDER.indexOf(a.type.rarity) - RARITY_ORDER.indexOf(b.type.rarity));
    bag.fill(null);
    items.forEach((it, i) => (bag[i] = it));
    renderBag();
  },
  shuffleScores: () => ui.require<UITable>('rank').setRows(randomRows()),
  openWindows: () => {
    ui.require<UIWindow>('bagWindow').open();
    ui.require<UIWindow>('rankWindow').open();
  },
  pickRow: (e) => {
    const row = e.item as TableRow;
    ui.require<UILabel>('picked').setText(`第 ${row.rank} 名　${row.name}　${row.score} 分`);
  },
  // ③ 3D 面板
  panelOptions: () => applyPanelOptions(),
  hurtAll: () => {
    for (const tag of tags) {
      const bar = ui3d.uiOf(tag)?.get<UIProgressBar>('hp');
      if (bar) bar.value = Math.max(5, bar.value - 10 - Math.random() * 30);
    }
  },
});

// 效能監視器（FPS、每幀時間、介面重畫次數）：按 ` 鍵顯示／隱藏，可以拖到畫面任何地方
// 這個範例的右邊四個角落都有介面（HUD、視窗、對話框），所以一開始先隱藏
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: false,
  position: { bottom: 16, right: 16 },
});

showPage('hud');
engine.start();
