/** 進階介面元件：網頁（真正的 HTML：iframe 或一段 HTML，放在介面的排版裡） */
import { UIElement, type Attrs } from '../elements';
import { num, roundRectPath } from '../draw';

/**
 * 網頁元件：在 2D 介面的排版位置顯示真正的網頁（瀏覽器自己畫的 HTML）。
 * 文字可以選取、輸入框可以打中文、可以捲動、播影片。
 *
 * - src：網址，用 iframe 顯示（和其他元件的 src 一樣，以介面檔所在的資料夾為準：
 *   public/ui/scene.xml 裡寫 '../pages/help.html' 是 public/pages/help.html；別的網站要允許被嵌入）；
 *   html：直接給一段 HTML（和遊戲同一份文件）
 * - 網頁在畫布下面，介面在它的位置挖洞露出網頁：之後畫的元件（對話框、通知、下拉選單）照樣蓋在網頁上面，
 *   3D 畫面在網頁的位置變透明
 * - 滑鼠移到露出的網頁上時交給網頁；被其他元件蓋住的地方照常給介面
 * - radius：圓角；background：網頁的背景色（CSS 顏色，預設白色）
 * - 需要 UIPlugin（疊在 3D 畫面上的介面）才會顯示；在列表（UIScrollView）裡會被列表的範圍裁切
 *
 * @example
 * <UIWeb id="help" src="../pages/help.html" width="480" height="320" radius="8"/>
 * <UIWeb id="form" html="&lt;input placeholder='名字'&gt;" width="300" height="80"/>
 * // 程式：ui.require<UIWeb>('form').element?.querySelector('input')
 */
export class UIWeb extends UIElement {
  /** 網頁的外層元素（外掛建立；沒有網頁環境、或還沒顯示過時是 null） */
  element: HTMLDivElement | null = null;
  /** src 用的 iframe（沒有 src 時是 null） */
  iframe: HTMLIFrameElement | null = null;

  override defaults(): Attrs {
    return { width: '400', height: '300', background: '#ffffff' };
  }

  /** 網頁接收滑鼠：hitTest 會找到它，滑鼠移到這裡時外掛把事件交給網頁 */
  override get interactive(): boolean {
    return this.attrs.pointerEvents !== 'none';
  }

  /** 網頁網址（iframe） */
  get src(): string {
    return this.attrs.src ?? '';
  }

  /** 直接給的 HTML */
  get html(): string {
    return this.attrs.html ?? '';
  }

  /**
   * 畫的時候把自己範圍裡、在它之前畫的東西（上層元件的背景等）清掉：畫布在這裡透明，露出下面的網頁。
   * 之後才畫的元件會照常畫在上面
   * @param ctx 介面的 2D 繪圖 context
   * @param x 元件左邊
   * @param y 元件上邊
   * @param width 元件寬
   * @param height 元件高
   */
  override paintContent(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    roundRectPath(ctx, x, y, width, height, num(this.attrs.radius, 0));
    ctx.fill();
    ctx.restore();
  }
}
