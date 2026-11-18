import { describe, expect, test } from 'vitest';
import { DEFAULT_PROJECT } from '../tools/current-project.js';
import { listProjects, nameError, removeError } from '../tools/project-files.js';

// node hero create／remove 與入口頁（/portal）共用的規則
describe('專案名稱與刪除規則（tools/project-files.js）', () => {
  test('專案名稱：小寫英文、數字、連字號，以英文或數字開頭', () => {
    for (const ok of ['my-game', 'game2', '3d-demo', 'official-demo-000-start']) expect(nameError(ok), ok).toBeNull();
    for (const bad of ['', 'My-Game', 'my game', '-game', 'my_game', '../x', 'a'.repeat(65)])
      expect(nameError(bad), bad).not.toBeNull();
  });

  test('預設專案存在，而且不能刪除', () => {
    expect(listProjects()).toContain(DEFAULT_PROJECT);
    expect(removeError(DEFAULT_PROJECT)).toMatch('不能刪除');
  });

  test('不存在或名稱不合法的專案不能刪除', () => {
    expect(removeError('zz-no-such-project')).toMatch('找不到專案');
    expect(removeError('../src')).toMatch('不合法');
  });

  test('列表只有真的專案（有 index.html），依名稱排序', () => {
    const list = listProjects();
    expect(list).toEqual([...list].sort());
    expect(list.every((n) => nameError(n) === null)).toBe(true);
  });
});
