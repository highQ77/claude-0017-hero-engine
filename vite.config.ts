import { defineProject } from './tools/project';
import { projectDir, projectExists, selectedProject } from './tools/current-project.js';

// 要開發／編譯哪個遊戲專案：node hero select 名稱（或環境變數 PROJECT=名稱）
const name = selectedProject();
if (!projectExists(name))
  throw new Error(`找不到專案「${name}」（projects/${name}/index.html）。用 node hero select 選擇專案`);
export default defineProject(projectDir(name));
