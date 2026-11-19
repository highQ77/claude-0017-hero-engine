/**
 * 元件庫的「預覽」：每個元件在彈出視窗裡實際運行的示範。
 * xml：預覽用的內容（不給就用元件庫插入的 XML）
 * wide：內容橫向撐滿（表格、版面類）
 * run：示範腳本（讓數值變化、自動播放），回傳清除函式
 */
import type { UI2D } from '../../ui2d/UI2D';
import type { UIElement } from '../../ui2d/elements';
import type {
  UIBadge,
  UICanvas,
  UICooldown,
  UIDialogue,
  UIJoystick,
  UIMinimap,
  UIProgressBar,
  UISlot,
} from '../../ui2d/widgets';
import type { UIRichText } from '../../ui2d/richtext';
import type { UILabel } from '../../ui2d/elements';

export interface ComponentDemo {
  xml?: string;
  wide?: boolean;
  /** 預覽區的提示（例如「試著拖曳」） */
  hint?: string;
  run?(ui: UI2D, log: (message: string) => void): () => void;
}

/** 找第一個某種類型的元件 */
function first<T extends UIElement>(ui: UI2D, type: string): T | null {
  let found: UIElement | null = null;
  ui.root?.walk((e) => {
    if (!found && e.type === type) found = e;
  });
  return found as T | null;
}

const every = (ms: number, fn: () => void): (() => void) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

const progressDemo: ComponentDemo = {
  hint: '數值每秒自動變化：減少時有淡色殘影，增加時平滑填滿',
  run(ui) {
    const bar = first<UIProgressBar>(ui, 'UIProgressBar');
    let down = true;
    return every(1300, () => {
      if (!bar) return;
      const v = bar.value;
      bar.value = down ? Math.max(5, v - 20 - Math.random() * 25) : Math.min(100, v + 30 + Math.random() * 30);
      if (bar.value <= 15) down = false;
      else if (bar.value >= 95) down = true;
      else down = Math.random() < 0.6;
    });
  },
};

export const COMPONENT_DEMOS: Record<string, ComponentDemo> = {
  進度條: progressDemo,
  圓形進度: progressDemo,
  多樣式文字: {
    wide: true,
    hint: '標記：[b] [i] [u] [color=#f55] [size=22] [bg=#333] [icon=fire] [br]；示範打字機效果',
    xml: `<UIRichText fontSize="18">造成 [b][color=#ff6b6b]120[/color][/b] 點 [icon=fire color=#ffb347] [color=#ffb347]火焰傷害[/color]，[br]
      並獲得 [icon=coin color=#ffd75e] [b]30[/b] 金幣與 [bg=rgba(154,205,50,0.25)] 稀有 [/bg] [i]寶箱[/i]。</UIRichText>`,
    run(ui) {
      const r = first<UIRichText>(ui, 'UIRichText');
      let n = 0;
      return every(45, () => {
        if (!r) return;
        n = n > r.length + 30 ? 0 : n + 1;
        r.revealed = n;
        ui.invalidate(r);
      });
    },
  },
  提示訊息: {
    hint: '每隔一段時間顯示一則提示；也可以按按鈕',
    xml: '<UILayout gap="12" align="center"><UILabel color="#b8c0ae" fontSize="13">提示會出現在上方</UILabel><UIButton text="顯示提示" onClick="demoToast"/><UIToast placement="top"/></UILayout>',
    run(ui) {
      const messages: [string, string, string][] = [
        ['獲得金幣 ×10', 'coin', '#ffd75e'],
        ['存檔完成', 'check', '#9acd32'],
        ['體力不足', 'bolt', '#ffb347'],
        ['發現新地區', 'map', '#4f9dff'],
      ];
      let i = 0;
      const show = () => {
        const [text, icon, color] = messages[i++ % messages.length];
        ui.toast(text, { icon, color, duration: 2 });
      };
      ui.setHandler('demoToast', show);
      show();
      return every(1800, show);
    },
  },
  冷卻遮罩: {
    hint: '冷卻每 3 秒重新開始；點擊物品格也會重新開始',
    xml: '<UISlot iconName="fire" rarity="legendary" width="72" height="72" onClick="demoCooldown"><UICooldown/></UISlot>',
    run(ui, log) {
      const cd = first<UICooldown>(ui, 'UICooldown');
      cd?.on('ready', () => log('ready（冷卻完成）'));
      ui.setHandler('demoCooldown', () => cd?.start(3));
      cd?.start(3);
      return every(3600, () => cd?.start(3));
    },
  },
  角標: {
    hint: '數字每秒增加，超過 99 顯示 99+，歸零時自動隱藏',
    xml: '<UILayout dir="h" gap="24" align="center"><UIButton text="任務"><UIBadge id="b1" value="1"/></UIButton><UIButton text="信件"><UIBadge dot="true"/></UIButton></UILayout>',
    run(ui) {
      const badge = ui.get<UIBadge>('b1');
      let n = 1;
      return every(700, () => {
        n = n >= 120 ? 0 : n < 8 ? n + 1 : n + 23;
        badge?.setValue(n);
      });
    },
  },
  物品格: {
    hint: '把物品拖到另一格交換位置；滑鼠停在物品上會出現說明',
    xml: `<UILayout dir="h" gap="10">
      <UISlot id="s1" iconName="sword" count="1" rarity="epic" onDrop="demoDrop" tooltipTitle="鐵劍" tooltip="傷害 +12"/>
      <UISlot id="s2" iconName="potion" count="12" rarity="uncommon" onDrop="demoDrop" tooltipTitle="回復藥水" tooltip="回復 50 生命"/>
      <UISlot id="s3" iconName="shield" rarity="rare" onDrop="demoDrop" tooltipTitle="木盾" tooltip="防禦 +5"/>
      <UISlot id="s4" onDrop="demoDrop"/>
    </UILayout>`,
    run(ui, log) {
      ui.setHandler('demoDrop', (e) => {
        const from = e.source as UISlot;
        const to = e.target as UISlot;
        const pick = (s: UISlot) => {
          const a = s.attrs;
          return a.icon || a.iconName
            ? { iconName: a.iconName, count: a.count ? Number(a.count) : undefined, rarity: a.rarity }
            : null;
        };
        const fromItem = pick(from);
        const toItem = pick(to);
        for (const s of [from, to]) for (const k of ['tooltip', 'tooltipTitle']) delete s.raw[k];
        to.setItem(fromItem);
        from.setItem(toItem);
        log(`onDrop：${from.id} → ${to.id}`);
      });
      return () => {};
    },
  },
  對話框: {
    wide: true,
    hint: '點對話框跳過打字、進入下一句；有選項時點選項',
    xml: '<UIDialogue speaker="村長" autoplay="true" speed="30" onNext="demoNext" onChoose="demoChoose">歡迎來到村子，[b]勇者[/b]！最近森林裡出現了[color=#ff6b6b]奇怪的怪物[/color]……</UIDialogue>',
    run(ui) {
      const d = first<UIDialogue>(ui, 'UIDialogue');
      const lines = [
        () =>
          d?.say('你願意幫我們調查嗎？', {
            choices: [
              { value: 'yes', label: '交給我吧！' },
              { value: 'no', label: '我考慮一下' },
            ],
          }),
        () => d?.say('（對話結束，重新開始示範）'),
      ];
      let step = 0;
      ui.setHandler('demoNext', () => {
        if (step === 0) lines[0]();
        else {
          step = -1;
          d?.say('歡迎來到村子，[b]勇者[/b]！最近森林裡出現了[color=#ff6b6b]奇怪的怪物[/color]……');
        }
        step++;
      });
      ui.setHandler('demoChoose', (e) => {
        d?.say(
          e.value === 'yes'
            ? '太好了！請帶著這個 [icon=sword color=#b072ff] [b]鐵劍[/b]。'
            : '好吧，[i]需要時再來找我[/i]。',
          { speaker: '村長' },
        );
        step = 1;
      });
      return () => {};
    },
  },
  虛擬搖桿: {
    hint: '拖曳圓鈕，下方顯示 x、y 數值（-1～1）',
    xml: '<UILayout gap="12" align="center"><UIJoystick width="130" height="130" onInput="demoStick"/><UILabel id="stickValue" fontSize="13" color="#b8c0ae">x 0.00　y 0.00</UILabel></UILayout>',
    run(ui) {
      ui.setHandler('demoStick', (e) => {
        const v = e.value as { x: number; y: number };
        ui.get<UILabel>('stickValue')?.setText(`x ${v.x.toFixed(2)}　y ${v.y.toFixed(2)}`);
      });
      void first<UIJoystick>(ui, 'UIJoystick');
      return () => {};
    },
  },
  小地圖: {
    hint: '示範：玩家原地轉向，敵人（紅）繞圈、任務目標（星）貼在邊緣',
    xml: '<UILayout dir="h" gap="24" align="center"><UIMinimap width="150" height="150" range="20"/><UIMinimap width="150" height="150" range="20" rotate="true" shape="square"/></UILayout>',
    run(ui) {
      const maps: UIMinimap[] = [];
      ui.root?.walk((e) => e.type === 'UIMinimap' && maps.push(e as UIMinimap));
      let t = 0;
      return every(50, () => {
        t += 0.05;
        const markers = [
          ...Array.from({ length: 3 }, (_, i) => {
            const a = t * 0.6 + (i * Math.PI * 2) / 3;
            return {
              x: Math.cos(a) * 9,
              z: Math.sin(a) * 9,
              color: '#ff5a5a',
              shape: 'arrow' as const,
              heading: a + Math.PI,
              size: 5,
            };
          }),
          ...Array.from({ length: 6 }, (_, i) => ({
            x: Math.cos(i) * 5,
            z: Math.sin(i * 1.7) * 5,
            color: '#ffd75e',
            size: 3,
          })),
          { x: 30, z: -25, color: '#4f9dff', shape: 'star' as const, pin: true, size: 6 },
        ];
        for (const m of maps) {
          m.setView(0, 0, t * 0.4);
          m.setMarkers(markers);
        }
      });
    },
  },
  圖片背景: {
    wide: true,
    hint: '同一張框圖用九宮格放大縮小都不變形；按鈕滑鼠移入、按下會換圖',
    xml: `<UILayout dir="h" gap="14" align="stretch" height="200">
      <UILayout flex="1" padding="20" gap="8" bgImage="frame.svg" bgSlice="16">
        <UILabel fontSize="16" fontWeight="bold" color="#c8f07a">九宮格</UILabel>
        <UILabel fontSize="12" color="#b8c0ae">bgSlice="16"</UILabel>
        <UIButton text="移入換圖" bgImage="frame.svg" hoverBgImage="frame-hover.svg" bgSlice="16" background="transparent" hoverBackground="transparent" pressedBackground="transparent" radius="10" color="#c8f07a"/>
      </UILayout>
      <UILayout flex="1" padding="16" justify="end" bgImage="banner.svg" bgFit="cover" radius="12">
        <UILabel fontSize="16" fontWeight="bold" textShadow="0 1 4 rgba(0,0,0,0.8)">cover 填滿</UILabel>
      </UILayout>
      <UILayout flex="1" padding="16" justify="end" bgImage="pattern.svg" bgFit="tile" radius="12" border="1 rgba(154,205,50,0.3)">
        <UILabel fontSize="16" fontWeight="bold">tile 重複</UILabel>
      </UILayout>
    </UILayout>`,
  },
  開關: { hint: '點擊切換，onChange 會記錄在下方' },
  勾選框: { hint: '點擊切換，onChange 會記錄在下方' },
  單選按鈕: { hint: '同一組只能選一個' },
  下拉選單: { hint: '點擊展開選項' },
  水平滑桿: { hint: '拖曳圓點，滑鼠移上去會顯示數值' },
  垂直滑桿: { hint: '上下拖曳，下方是最小值' },
  視窗: { wide: true, hint: '拖曳標題列移動視窗，按 ✕ 關閉（關閉後按「重新播放」）' },
  分頁: { wide: true, hint: '點分頁標籤切換' },
  頁面堆疊: { wide: true, hint: '點上方按鈕切換頁面，或在內容區左右滑動' },
  表格: { wide: true, hint: '點標題排序，點資料列選取' },
  捲動區: {
    wide: true,
    hint: '用滾輪或拖曳捲動',
    xml:
      '<UIScrollView height="150" scroll="v" padding="10" background="rgba(255,255,255,0.04)" radius="10">' +
      Array.from({ length: 12 }, (_, i) => `<UILabel>第 ${i + 1} 行：捲動區可以放任意內容</UILabel>`).join('') +
      '</UIScrollView>',
  },
  垂直列表: { wide: true, hint: '用滾輪或拖曳捲動' },
  水平列表: { wide: true, hint: '用滾輪或拖曳左右捲動' },
  格狀列表: { wide: true, hint: '依 columns 自動排成格子' },
  垂直排版: {
    hint: '子元件由上到下排列；示範自動切換 align（水平方向的對齊）',
    xml: `<UILayout gap="10" align="center">
      <UILabel id="layoutCaption" fontSize="13" color="#b8c0ae">align="stretch"</UILabel>
      <UILayout id="layoutBox" dir="v" gap="8" padding="12" width="260" align="stretch"
                background="rgba(154,205,50,0.07)" border="1 rgba(154,205,50,0.45)" radius="10">
        <UILabel fontSize="14" color="#141a07" fontWeight="bold" background="#9acd32" padding="8 14" radius="8">項目 1</UILabel><UILabel fontSize="14" color="#141a07" fontWeight="bold" background="#b4e05a" padding="8 14" radius="8">第二個項目</UILabel><UILabel fontSize="14" color="#141a07" fontWeight="bold" background="#7fd6c2" padding="8 14" radius="8">3</UILabel>
      </UILayout>
    </UILayout>`,
    run(ui) {
      const values = ['stretch', 'start', 'center', 'end'];
      let i = 0;
      return every(1400, () => {
        const v = values[++i % values.length];
        ui.get('layoutBox')?.set('align', v);
        ui.get<UILabel>('layoutCaption')?.setText(`align="${v}"`);
      });
    },
  },
  水平排版: {
    wide: true,
    hint: '子元件由左到右排列；示範自動切換 justify（主軸上的分布）',
    xml: `<UILayout gap="10">
      <UILabel id="layoutCaption" fontSize="13" color="#b8c0ae" textAlign="center">justify="start"</UILabel>
      <UILayout id="layoutBox" dir="h" gap="8" padding="12" align="center" justify="start"
                background="rgba(154,205,50,0.07)" border="1 rgba(154,205,50,0.45)" radius="10">
        <UILabel fontSize="14" color="#141a07" fontWeight="bold" background="#9acd32" padding="8 14" radius="8">A</UILabel><UILabel fontSize="14" color="#141a07" fontWeight="bold" background="#b4e05a" padding="8 14" radius="8">BB</UILabel><UILabel fontSize="14" color="#141a07" fontWeight="bold" background="#7fd6c2" padding="8 14" radius="8">CCC</UILabel>
      </UILayout>
    </UILayout>`,
    run(ui) {
      const values = ['start', 'center', 'end', 'between', 'around', 'evenly'];
      let i = 0;
      return every(1400, () => {
        const v = values[++i % values.length];
        ui.get('layoutBox')?.set('justify', v);
        ui.get<UILabel>('layoutCaption')?.setText(`justify="${v}"`);
      });
    },
  },
  按鈕: { hint: '滑鼠移入、按下都有不同外觀；點擊會記錄 onClick', xml: '<UIButton text="按鈕" onClick="clicked"/>' },
  畫布: {
    hint: '程式用 getContext() 取得 ctx，以 Canvas 2D 的寫法繪圖（底層是 WebGL）：漸層、路徑、半透明描邊、文字',
    xml: '<UICanvas id="canvas" width="320" height="200" radius="10"/>',
    run(ui, log) {
      const canvas = first<UICanvas>(ui, 'UICanvas');
      if (!canvas) return () => {};
      let ctx: ReturnType<UICanvas['getContext']>;
      try {
        ctx = canvas.getContext();
      } catch (error) {
        log(`無法建立 WebGL：${(error as Error).message}`);
        return () => {};
      }
      log(`getContext() → ${ctx.isWebGL2 ? 'WebGL 2' : 'WebGL 1'}，${canvas.width}×${canvas.height}`);
      let t = 0;
      const draw = () => {
        t += 0.04;
        ctx.clearRect(0, 0, 320, 200);
        const g = ctx.createLinearGradient(0, 0, 320, 0);
        g.addColorStop(0, '#9acd32');
        g.addColorStop(1, '#7fd6c2');
        ctx.lineWidth = 3;
        ctx.strokeStyle = g;
        ctx.beginPath();
        for (let x = 0; x <= 320; x += 4) {
          const y = 100 + Math.sin(x / 30 + t) * 40 * Math.cos(t * 0.5);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,179,71,0.55)';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(40 + i * 60, 100 + Math.sin(t * 2 + i) * 50, 14, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText('UICanvas · WebGL2D', 12, 24);
      };
      return every(33, draw);
    },
  },
};
