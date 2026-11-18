/**
 * 素材面板：列出預製物件（public/prefabs）、模型與貼圖（public 底下）。
 * 拖到畫面上：模型、預製物件放在滑鼠下的位置；貼圖放到滑鼠下的物件材質上；音效加在滑鼠下的物件上
 * （空白處則新增一個音效物件）；節點圖（public/shaders/*.shader.json）拖到物件上當材質。
 * 雙擊：打開預覽小視窗（assetPreview.ts），視窗裡的按鈕放在畫面中央（貼圖、音效、節點圖用選取的物件）。
 */
import { h } from './fields';
import { FOLDER, listAssets, listFiles } from './files';

export type AssetKind = 'prefab' | 'model' | 'texture' | 'audio' | 'shader';

/** 拖曳時放在 dataTransfer 裡的資料型別 */
export const ASSET_MIME = 'application/x-s3d-asset';

export interface AssetRef {
  kind: AssetKind;
  /** 遊戲裡的網址（相對於 public），例如 models/tree.glb、prefabs/tree.xml */
  path: string;
}

const MODEL = /\.(glb|gltf)$/i;
const TEXTURE = /\.(png|jpe?g|webp)$/i;
const AUDIO = /\.(mp3|ogg|wav|m4a)$/i;
const SHADER = /\.shader\.json$/i;
const GROUPS: [AssetKind, string, string][] = [
  ['prefab', '預製物件', '📦'],
  ['model', '模型', '▲'],
  ['texture', '貼圖', '▦'],
  ['audio', '音效', '♪'],
  ['shader', '著色器', '◆'],
];

export class AssetPanel {
  private items: AssetRef[] = [];
  private filter = '';

  constructor(
    private readonly el: HTMLElement,
    /** 雙擊：打開預覽 */
    private readonly onPreview: (asset: AssetRef) => void,
  ) {}

  /** 重新讀取清單 */
  async refresh(): Promise<void> {
    try {
      const [prefabs, assets] = await Promise.all([listFiles('prefab'), listAssets()]);
      this.items = [
        ...prefabs.map((f): AssetRef => ({ kind: 'prefab', path: `${FOLDER.prefab}/${f.name}` })),
        ...assets.filter((a) => MODEL.test(a.path)).map((a): AssetRef => ({ kind: 'model', path: a.path })),
        ...assets.filter((a) => TEXTURE.test(a.path)).map((a): AssetRef => ({ kind: 'texture', path: a.path })),
        ...assets.filter((a) => AUDIO.test(a.path)).map((a): AssetRef => ({ kind: 'audio', path: a.path })),
        ...assets.filter((a) => SHADER.test(a.path)).map((a): AssetRef => ({ kind: 'shader', path: a.path })),
      ];
    } catch (error) {
      this.el.innerHTML = '';
      this.el.append(h('div', 'empty', `讀取素材失敗：${(error as Error).message}`));
      return;
    }
    this.render();
  }

  /** 某一類的網址（給屬性面板的建議清單） */
  paths(kind: AssetKind): string[] {
    return this.items.filter((i) => i.kind === kind).map((i) => i.path);
  }

  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.render();
  }

  private render(): void {
    const parts: HTMLElement[] = [];
    for (const [kind, label, icon] of GROUPS) {
      const list = this.items.filter((i) => i.kind === kind && i.path.toLowerCase().includes(this.filter));
      if (list.length === 0) continue;
      parts.push(h('div', 'asset-group', `${label}（${list.length}）`));
      for (const item of list) {
        const row = h('div', 'asset-row');
        row.draggable = true;
        row.title =
          kind === 'texture'
            ? `${item.path}\n拖到畫面上的物件：當作材質的貼圖；雙擊預覽`
            : kind === 'audio'
              ? `${item.path}\n拖到物件上：加上音效；拖到空白處：新增一個音效物件；雙擊試聽`
              : kind === 'shader'
                ? `${item.path}\n拖到畫面上的物件：當作材質（節點圖）；雙擊預覽`
                : `${item.path}\n拖到畫面上放置；雙擊預覽`;
        if (kind === 'texture') {
          const img = h('img', 'asset-thumb');
          img.src = item.path;
          img.alt = '';
          img.loading = 'lazy';
          row.append(img);
        } else row.append(h('span', 'asset-icon', icon));
        const name = item.path.slice(item.path.indexOf('/') + 1);
        row.append(h('span', 'asset-name', name));
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(ASSET_MIME, JSON.stringify(item));
          e.dataTransfer?.setData('text/plain', item.path);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });
        row.addEventListener('dblclick', () => this.onPreview(item));
        parts.push(row);
      }
    }
    if (parts.length === 0)
      parts.push(
        h(
          'div',
          'empty',
          this.filter
            ? '沒有符合的素材'
            : '沒有素材：把 .glb／.gltf 模型、貼圖、音效放進專案的 public/（例如 public/models/）',
        ),
      );
    this.el.replaceChildren(...parts);
  }
}
