/**
 * official-demo-003-ui2d-ui3d：2D 與 3D 介面。
 *
 * 四個分頁，每一頁是一個場景（切換分頁時換場景），右邊的 2D 疊加層也跟著換：
 *   ① HUD（hud）：血條、魔力、金幣、角標、技能冷卻、提示訊息，按鈕和技能讓 3D 角色做動作
 *   ② 背包（bag）：可拖曳的視窗、列表樣板 + 資料（物品格可以拖曳交換）、可排序的表格；點物品在 3D 顯示
 *   ③ 3D 面板（panels）：3D 空間裡可以點擊的商店看板、永遠面向攝影機的名牌血條
 *   ④ 對話（talk）：點 3D 角色（render.pick）開始 2D 對話，頭上的泡泡是 3D 面板
 *
 * 介面在 public/ui/scene.xml（左邊的說明面板與右邊的疊加層）、public/ui/kiosk.xml（商店看板）。
 */
import type { Entity, World } from '@engine/ecs';
import { Color, Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { OrbitControl, create, spawn } from '@engine/render';
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

// ───────── 分頁切換 ─────────

scenes.register(hudPage, bagPage, panelsPage, talkPage);
/** 每一頁對應的 2D 疊加層 */
const LAYERS: Record<string, string> = { hud: 'hudLayer', bag: 'bagLayer', talk: 'talkLayer' };
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
