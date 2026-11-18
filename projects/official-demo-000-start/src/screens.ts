/**
 * 疊加的介面檔（public/ui 的 XML）：標題、設定、背包、排行榜、劇情對話、手機版面。
 * 由 UIScreenManager 載入；XML 裡的 screen.open／screen.close／screen.back 是它內建的處理函式。
 */
import { type UICooldown, type UIDialogue, UIScreenManager, type UISelect, type UISlot } from '@engine/ui2d';
import { audio, engine, ui } from './engine';
import { jumpAll } from './gameplay';
import { antialias } from './visuals';

export const screens = new UIScreenManager(ui).registerAll({
  hud: 'ui/scene.xml',
  title: { url: 'ui/title.xml', title: '標題畫面' },
  settings: { url: 'ui/settings.xml', title: '設定', modal: true },
  inventory: { url: 'ui/inventory.xml', title: '背包', modal: true },
  leaderboard: { url: 'ui/leaderboard.xml', title: '排行榜', modal: true },
  dialogue: { url: 'ui/dialogue.xml', title: '劇情對話' },
  mobile: { url: 'ui/mobile.xml', title: '手機版面' },
});

// ───────── 背包：資料是唯一的來源，拖曳時交換資料再重畫 ─────────

interface Item {
  name: string;
  iconName: string;
  rarity: string;
  count: number;
  desc: string;
}
const item = (name: string, iconName: string, rarity: string, count: number, desc: string): Item => ({
  name,
  iconName,
  rarity,
  count,
  desc,
});

/** 裝備欄（eq0～eq3） */
const equipment: (Item | null)[] = [
  item('鐵劍', 'sword', 'epic', 1, '攻擊 +12'),
  item('木盾', 'shield', 'rare', 1, '防禦 +5'),
  item('火球術', 'fire', 'legendary', 1, '冷卻 3 秒'),
  item('回復藥水', 'potion', 'uncommon', 5, '回復 50 生命'),
];
/** 物品格（bag0～bag9） */
const bag: (Item | null)[] = [
  item('鐵劍', 'sword', 'epic', 1, '攻擊 +12'),
  item('木盾', 'shield', 'rare', 1, '防禦 +5'),
  item('回復藥水', 'potion', 'uncommon', 8, '回復 50 生命'),
  item('寶石', 'gem', 'legendary', 2, '可以賣很多錢'),
  item('閃電卷軸', 'bolt', 'rare', 3, '召喚落雷'),
  item('火把', 'fire', 'common', 5, '照亮洞穴'),
  item('鑰匙', 'lock', 'epic', 1, '打開神秘的門'),
  item('地圖', 'map', 'common', 1, '森林的地圖'),
  null,
  null,
];

/** 格子 id → 它對應的資料位置 */
function slotRef(id: string | null): { list: (Item | null)[]; index: number } | null {
  const m = /^(eq|bag)(\d+)$/.exec(id ?? '');
  if (!m) return null;
  const list = m[1] === 'eq' ? equipment : bag;
  const index = Number(m[2]);
  return index < list.length ? { list, index } : null;
}

function renderInventory(): void {
  equipment.forEach((it, i) => {
    const slot = ui.get<UISlot>(`eq${i}`);
    if (!slot) return;
    slot.setItem(it && { iconName: it.iconName, count: it.count > 1 ? it.count : undefined, rarity: it.rarity });
    slot.set('tooltipTitle', it?.name ?? null).set('tooltip', it?.desc ?? null);
  });
  ui.setItems(
    'bag',
    bag.map((it, index) => ({
      index,
      name: it?.name ?? '',
      iconName: it?.iconName ?? '',
      rarity: it?.rarity ?? '',
      count: it && it.count > 1 ? it.count : '',
      desc: it?.desc ?? '',
    })),
  );
}

// ───────── 劇情對話 ─────────

const LINES: Record<string, string> = {
  accept: '太好了！森林入口在[b]東邊[/b]，請帶著這把 [icon=sword color=#b072ff] [color=#b072ff]鐵劍[/color]。',
  reward: '完成後可以得到 [color=#ffd75e][b]200[/b][/color] [icon=coin color=#ffd75e] 金幣，還有村子的[i]感謝[/i]。',
  leave: '好吧……如果改變心意，隨時回來找我。',
};
let talkFinished = false;

// ───────── 安裝 ─────────

export function installScreens(): void {
  screens.onChange((c) => {
    if (c.type !== 'open') return;
    if (c.name === 'inventory') renderInventory();
    if (c.name === 'settings') {
      const select = ui.get<UISelect>('settingsAa');
      if (select) select.value = antialias();
    }
    if (c.name === 'dialogue') talkFinished = false;
    if (c.name === 'mobile') ui.toast('手機版面：拖曳左下的搖桿移動方塊', { icon: 'target', duration: 2.5 });
  });

  ui.setHandlers({
    inventoryDrop: (e) => {
      const from = slotRef((e.source as UISlot | undefined)?.id ?? null);
      const to = slotRef(e.target.id);
      if (!from || !to || (from.list === to.list && from.index === to.index)) return;
      [from.list[from.index], to.list[to.index]] = [to.list[to.index], from.list[from.index]];
      renderInventory();
      audio.play('sounds/pop.wav', { group: 'ui', volume: 0.4, pitch: 1.3 });
    },
    dialogueChoose: (e) => {
      const talk = ui.get<UIDialogue>('talk');
      talk?.say(LINES[String(e.value)] ?? '……', { speaker: '村長' });
      talkFinished = e.value !== 'reward';
      if (e.value === 'reward')
        // 說完獎勵再問一次（遊戲時間：暫停時也會等）
        engine.timers.after(2.5, () =>
          talk?.say('那麼，你願意幫忙嗎？', {
            choices: [
              { value: 'accept', label: '交給我吧！' },
              { value: 'leave', label: '我再考慮一下' },
            ],
          }),
        );
    },
    dialogueNext: () => {
      if (!talkFinished) return;
      screens.close('dialogue');
      ui.toast('任務已加入清單', { icon: 'flag', color: '#9acd32' });
    },
    leaderboardSelect: (e) => {
      const row = e.item as { name?: string; score?: string };
      ui.toast(`${row.name ?? '玩家'}：${row.score ?? '-'} 分`, { icon: 'trophy', color: '#ffd75e', duration: 1.6 });
    },
    // 手機版面的技能格：有冷卻就等；閃電、大招讓物件跳起來
    mobileSkill: (e) => {
      const slot = e.target;
      const cd = slot.children.find((c) => c.type === 'UICooldown') as UICooldown | undefined;
      if (cd && !cd.ready) return;
      cd?.start(slot.id === 'skill2' ? 5 : 2);
      if (slot.id === 'skill1' || slot.id === 'skill2') jumpAll();
      ui.toast(slot.get('tooltip') ?? '技能', { icon: slot.get('iconName'), duration: 1.2 });
    },
  });
}
