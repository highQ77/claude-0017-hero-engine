# 編輯器

開發時用的工具，每個編輯器一個資料夾（不屬於遊戲執行期的引擎，打包遊戲時不會包含）：

| 資料夾           | 編輯器                                                                                    | 頁面                                                       |
| ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ui-editor/`     | 2D 介面（XML）編輯器                                                                      | `ui-editor/index.html`，開發時在 `/ui-editor.html`         |
| `s3d-editor/`    | 3D 場景編輯器（場景檔 `public/scenes/*.xml`）                                             | `s3d-editor/index.html`，開發時在 `/s3d-editor.html`       |
| `shader-editor/` | 著色器編輯器（節點式，節點圖檔 `public/shaders/*.shader.json`）                           | `shader-editor/index.html`，開發時在 `/shader-editor.html` |
| `se-editor/`     | 音效編輯器（Tone.js 合成，存成 `public/sounds/*.sfx.json` 與 `.wav`）                     | `se-editor/index.html`，開發時在 `/se-editor.html`         |
| `portal/`        | 入口頁：列出專案，點一下切換；也能新增、刪除專案（同 `node hero select／create／remove`） | `portal/index.html`，開發時在 `/portal.html`               |

3D 場景編輯器工具列的 📁 選單可以切換專案（`tools/project.ts` 的 `/__projects`：開發伺服器換成那個專案後重新啟動，只影響這次執行）。入口頁 `portal/` 用同一個 API 並加上 `save: true`，同時寫進 `.selected-project`（等同 `node hero select`）；專案說明（專案名稱下面那一行）可以在入口頁編輯，存在專案 `src/main.ts` 開頭註解的第一行（`/__projects/summary`）；新增、刪除專案用 `/__projects/create`、`/__projects/remove`，檔案操作和 `node hero create／remove` 共用 `tools/project-files.js`（刪除一樣要輸入專案名稱確認；預設專案不能刪，刪除這次執行正在用的專案時會先切換到預設專案）。

著色器編輯器移植自 Shader Composer：節點定義與編譯器放在引擎的 `src/shaders/graph`（遊戲用 `loadShaderGraph` 載入同一份檔案），預覽用 three.js 與引擎的 `ShaderLibrary`，讀寫檔案透過 `tools/shader-files-plugin.ts`。

UI 編輯器和 3D 場景編輯器開在同一個瀏覽器時會即時同步：UI 編輯器的每個修改（還沒存檔也會）都會顯示在 3D 場景編輯器的 UI 層（`ui-sync.ts`、`s3d-editor/uilayer.ts`）。3D 場景編輯器的「編輯 UI」用 `/ui-editor.html?file=檔名` 打開指定的介面檔。

所有編輯器（含入口頁）的外觀一致：共用的色票、按鈕、輸入框、下拉選單、分段按鈕、面板標題、分頁、捲軸，以及頁首的標誌與編輯器切換列（專案／UI／3D 場景／著色器／音效；「專案」回到入口頁）都在 `shared/theme.css`。開發伺服器把它放進每個頁面的 `<!-- editor-theme -->` 位置（在頁面自己的 `<style>` 之前），各編輯器的 `index.html` 只寫自己特有的樣式。共用的程式小工具（`h`、`request`、`storage`…）也在 `shared/`。

不要用瀏覽器原生的 `alert`／`confirm`／`prompt`：改用 `shared/dialog.ts` 的 `showAlert`、`showConfirm`、`showPrompt`（外觀一致；`showPrompt` 可以傳 `validate` 在框裡直接顯示錯誤；危險動作傳 `danger: true`）。

新增編輯器：

1. 在這裡建立資料夾，例如 `scene-editor/`：頁面是 `scene-editor/index.html`，程式入口是 `scene-editor/editor.ts`（頁面用 `<script type="module" src="./editor.ts">` 載入）。
   頁面的 `<head>` 裡要有 `<!-- editor-theme -->`（共用外觀放在這裡），頁首放 `.brand`（標誌）與 `.editor-nav`（切換列）。
2. 在 `tools/project.ts` 的 `EDITORS` 加上資料夾名稱，每個專案的開發伺服器就會有這個頁面（例如 `/scene-editor.html`）。
   要讀寫專案檔案時，比照 `tools/ui-files-plugin.ts`、`tools/scene-files-plugin.ts` 寫一個開發伺服器外掛（共用的小工具在 `tools/dev-http.ts`）。
3. 編輯器的面板、輸入欄位自己用 DOM 寫，不使用 lil-gui（lil-gui 只用在遊戲執行時的除錯面板）。

編輯器可以引用引擎的任何模組；引擎的模組不能引用編輯器（`tests/module-deps.test.ts` 不檢查 `editors/`，但引擎模組引用這裡會被當成不允許的相依）。
