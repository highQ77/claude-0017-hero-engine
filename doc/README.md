# Hero Engine 文件

```
doc/
├── index.html              入口（轉到使用手冊）
├── vite.config.ts          文件網站的設定（含執行 TypeScript 範例的伺服器外掛、API 參考的資料；npm run dev 時掛在 /doc）
├── public/                 範例用的圖片、音效（網址從根目錄起算：ui/coin.png、sounds/pop.wav）
├── manual/                 使用手冊
│   ├── index.html
│   ├── runner.html         TypeScript 範例的執行環境（預覽框 iframe）
│   ├── chapters/           章節（依檔名排序；90-api.html 是 API 參考的總覽）
│   ├── api-examples/       API 參考每個 API 的範例（<模組>.md，見下方「API 參考」）
│   └── src/
│       ├── main.ts         分頁（說明文件／API）、目錄、章節切換、搜尋
│       ├── api.ts          自動產生「API 參考」（每個模組一章、內文自動連結、搜尋 API 名稱）
│       ├── example.ts      範例區塊（編輯器 + 執行結果）
│       ├── canvasExample.ts  UICanvas 繪圖範例（頁面內執行、原生 Canvas 2D 對照）
│       ├── canvasSharedCheck.ts  UICanvas 共用模式檢查（canvas-shared-check.html：每個繪圖範例和獨立模式逐像素比較）
│       ├── editor.ts       程式碼編輯器（textarea 疊在高亮的 pre 上）
│       ├── highlight.ts    語法高亮（TypeScript、終端機；XML 沿用 UI 編輯器的 highlightXml）
│       ├── reference.ts    自動產生「UI 元件參考」
│       ├── runner.ts       預覽框裡執行範例、轉送 console 輸出
│       └── style.css
└── scripts/
    └── check-examples.mjs  檢查所有範例
```

## 指令

```sh
npm run dev                                # 使用手冊在 http://localhost:5173/doc（所有範例都能執行；入口頁 /portal 的「文件」也能打開）
node doc/scripts/check-examples.mjs        # 型別檢查所有 TypeScript 範例
node doc/scripts/check-examples.mjs --run  # 另外用 Chrome（無畫面模式）實際執行每個範例
node doc/scripts/check-examples.mjs --run --url=http://localhost:5173/doc  # 改用開著的 npm run dev 執行
node doc/scripts/check-examples.mjs --api-only           # 只檢查 API 參考（略過章節的範例）
node doc/scripts/check-examples.mjs --api-only --run-api # 另外用 Chrome 實際執行每個 API 的範例
node doc/scripts/check-examples.mjs --run-api --api-module=core,scene  # 只執行這些模組的 API 範例
node doc/scripts/check-examples.mjs --api-todo           # 列出所有還沒有範例的 API
```

## API 參考

手冊分兩個分頁：「說明文件」（`chapters/` 的章節）與「API」。API 分頁的內容是開啟手冊時從引擎原始碼自動產生的，不用手寫：

- 資料：`tools/api-model.mjs` 用 TypeScript 編譯器分析 `src/<模組>/index.ts` 匯出的東西（和 `node hero api` 產生 `tips/api.txt` 共用），`vite.config.ts` 把結果做成虛擬模組 `virtual:engine-api`；開發時引擎原始碼改了會重新分析、重新整理頁面。
- 每個模組一章：總表 → 類別、函式、常數、介面、型別 → 每個 API 的簽名、說明、`@param`／`@returns`、`@example`（範例方塊；XML 開頭的範例用 XML 顯示）、成員、原始碼位置。
- 說明文件內文裡的 `<code>名稱</code>`、`<code>名稱.成員</code>` 會自動連到 API 參考（名稱不確定時不連）；搜尋框也會先列出符合的 API。
- **每個 API 都有可以執行、編輯的範例**，寫在 `api-examples/<模組>.md`（`scene/` 這種路徑的 `/` 換成 `-`，例如 `packages-perf-monitor.md`）：

  ````md
  ## Transform
  說明文字（可以多行，會顯示在範例上面）。

  ```ts
  spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
  engine.start();
  ```
  ````

  - 標題是 API 名稱；同一個名稱可以寫好幾段（顯示成好幾個範例）。
  - import 會自動補上：範例所屬模組的匯出 → `engine.ts`（`engine`、`world`、`ui`…）→ 第一個定義它的模組 → `THREE`。`create`、`math`、`define` 這類好幾個模組都有的分類用總入口 `@engine` 的完整版。`lil-gui`、套件（`@engine/packages/…`）等要自己寫 import。
  - 有 `engine.start(` 的範例顯示 300px 高的畫面；其他只顯示主控台。也可以在 ```` ```ts height=400 ```` 或 ```` ```ts console ```` 指定。
  - 原始碼註解裡的 `@example` 仍然會顯示（收在「程式片段」裡，只能閱讀）。
- 範例檢查（`check-examples.mjs`）很嚴格：**有 API 沒有範例、或範例沒通過型別檢查就算失敗**。新增 API 時記得在 `api-examples/` 補上範例，再用 `--run-api --api-module=模組` 在 Chrome 裡確認能執行。
- 範例用的素材放在 `doc/public/`（例如 `models/robot.gltf`：三個方塊零件與 Idle、Wave、Spin 三段動畫）。

## 開發伺服器上的 /doc

`npm run dev`（`node hero dev`）時，`tools/project.ts` 的 `docServerPlugin` 用中介層模式建立手冊自己的 Vite 伺服器（設定就是這裡的 `vite.config.ts`，`base` 改成 `/doc/`），`/doc/` 底下的請求都交給它；熱更新共用同一個連接埠（WebSocket 路徑 `/doc/`）。第一次打開 `/doc` 才建立，切換專案（開發伺服器重新啟動）時一起重建。`/doc` 會轉到 `/doc/manual/`。

所以手冊裡的網址要用**相對路徑**，不要從 `/` 開始：

- 範例的素材寫 `models/robot.gltf`、`ui/coin.png`（預覽框有 `<base>` 指到文件網站的根目錄），不要寫 `/models/…`；`uiXml.register` 的鍵也一樣（`'ui/forest/hud.xml'`）。
- 手冊程式裡的伺服器網址也是相對的（例如 `runner.ts` 的 `fetch('__doc/run')`），`vite.config.ts` 的外掛用 `server.config.base` 組出完整網址。
- 預先打包套件的快取放在 `node_modules/.vite-doc`（和遊戲專案的 `node_modules/.vite` 分開，否則會互相覆蓋）。

手冊只在開發伺服器上提供，不另外打包。範例檢查（`check-examples.mjs --run`）沒給 `--url` 時，會用同一份 `vite.config.ts` 另開一個暫時的伺服器（網址從根目錄起算），檢查完就關掉。

## 新增章節

在 `manual/chapters/` 加一個 HTML 檔，檔名開頭的數字決定順序，檔名其餘部分是網址（`17-save.html` → `#/save`）：

```html
<!-- group: 遊戲邏輯 -->
<h1>存檔</h1>
<p class="lead">一句話說明這一章。</p>

<h2>小節標題</h2>
<p>……</p>
```

- 第一行的 `<!-- group: … -->` 是目錄的分組（同一組的章節要相鄰）。
- `<h1>` 是章節標題；`<h2>` 會自動產生 id，出現在目錄裡，可以用 `#/章節/小節` 連結。
- 提示框：`<div class="tip">`、`<div class="note">`、`<div class="warn">`。
- 連到其他章節：`<a href="#/ui2d">2D 介面</a>`。

## 範例

範例寫在 `<script type="text/plain" class="example">` 裡，裡面的 `<`、`>`、`&` 不用跳脫，縮排會自動對齊：

```html
<script type="text/plain" class="example" data-lang="ts" data-title="旋轉的方塊" data-height="320">
import { Engine } from '@engine/core';
const engine = new Engine();
engine.start();
</script>
```

| 屬性 | 說明 |
| --- | --- |
| `data-lang` | `ts`（預設）、`xml`、`sh`、`text`、`canvas`（UICanvas 繪圖範例） |
| `data-title` | 標題列的文字 |
| `data-height` | 預覽高度（像素）：XML 預設 240、TypeScript 預設 320 |
| `data-run="false"` | 程式片段：可以編輯，但沒有執行按鈕（也不做檢查） |
| `data-readonly` | 不能編輯（終端機指令、資料夾結構） |

- **TypeScript 範例**要能獨立執行：和遊戲專案一樣 `import '@engine/...'`、`'three'`，在預覽框（iframe）裡執行，每次執行都是全新的環境。圖片、音效放在 `doc/public/`。
- **XML 範例**直接在頁面裡用 UI2D 排版，邊打邊更新；圖片與 `<UIComponent>`、`<UIImport>` 的檔案從 `doc/public/ui/` 讀取。XML 裡的 `onClick` 等事件會自動接到輸出區。
- **UICanvas 範例**（`data-lang="canvas"`，`chapters/135-ui-canvas.html`）直接在頁面裡執行（`src/canvasExample.ts`）：所有範例共用一個 `<UICanvas>`，可用 `ctx`、`uicanvas`、`canvas`、`UICanvas`、`Path2D`、`log`、`sampleImage`、`tile`；旁邊是原生 Canvas 2D 的對照，`data-native="false"` 時沒有。
- 新增範例後執行 `node doc/scripts/check-examples.mjs --run` 確認沒有錯誤。

## UI 元件參考

`manual/chapters/13-ui-reference.html` 裡的 `<div data-generate="ui-reference"></div>` 會換成 `src/reference.ts` 產生的內容，資料來自 UI 編輯器的 `PALETTE`、`ATTRIBUTE_HINTS`（`src/editors/ui-editor/model.ts`）與 `ATTR_DOCS`（`codeAssist.ts`）。編輯器新增元件後手冊會自動更新；個別元件的範例要調整（高度、改寫範例、補充說明）時改 `reference.ts` 的 `TWEAKS`。

## 引擎新增套件時

`vite.config.ts` 的 `optimizeDeps.include` 列出引擎用到的第三方套件（three.js 的 examples 模組、Rapier、Yoga）。執行範例時才遇到沒列出的套件，Vite 會重新整理頁面，所以引擎新增套件時要一起加上。
