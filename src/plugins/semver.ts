/**
 * 精簡版語意化版本（semver）：比較版本、判斷是否符合範圍。
 * 支援的範圍寫法：*、1.2.3、=1.2.3、>1.2.3、>=1.2.3、<2.0.0、<=2.0.0、^1.2.3、~1.2.3，
 * 以空白表示「且」，以 || 表示「或」。可以省略後段：^0.1 等於 ^0.1.0。
 */

/** 拆開的版本號，例如 1.2.3-beta → { major: 1, minor: 2, patch: 3, prerelease: 'beta' } */
export interface Version {
  /** 主版本：不相容的改動 */
  major: number;
  /** 次版本：新增功能 */
  minor: number;
  /** 修訂：修正錯誤 */
  patch: number;
  /** 預先發行標記（beta、rc.1…）；正式版是空字串 */
  prerelease: string;
}

/**
 * @param v 版本字串，例如 '1.2.3-beta'
 */
export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.]+))?$/.exec(v.trim());
  if (!m) return null;
  return { major: +m[1], minor: +(m[2] ?? 0), patch: +(m[3] ?? 0), prerelease: m[4] ?? '' };
}

/**
 * @param v 版本字串
 */
export function isValidVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v.trim());
}

/**
 * a < b 回傳負數，相等為 0
 * @param a 第一個版本
 * @param b 第二個版本
 */
export function compareVersions(a: string | Version, b: string | Version): number {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y)
    throw new Error(
      `版本格式錯誤：${String(typeof a === 'string' ? a : '')} ${String(typeof b === 'string' ? b : '')}`,
    );
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  // 有預發行標記的版本比較舊（1.0.0-beta < 1.0.0）
  if (x.prerelease === y.prerelease) return 0;
  if (!x.prerelease) return 1;
  if (!y.prerelease) return -1;
  return x.prerelease < y.prerelease ? -1 : 1;
}

function satisfiesComparator(v: Version, comp: string): boolean {
  if (comp === '*' || comp === '' || comp === 'x') return true;
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(comp);
  if (!m) throw new Error(`版本範圍格式錯誤：${comp}`);
  const op = m[1] ?? '=';
  const target = parseVersion(m[2]);
  if (!target) throw new Error(`版本範圍格式錯誤：${comp}`);
  const c = compareVersions(v, target);
  switch (op) {
    case '=':
      return c === 0;
    case '>':
      return c > 0;
    case '>=':
      return c >= 0;
    case '<':
      return c < 0;
    case '<=':
      return c <= 0;
    case '~': // 同一個 minor
      return c >= 0 && v.major === target.major && v.minor === target.minor;
    case '^': // 不改變最左邊非 0 的那一位
      if (c < 0) return false;
      if (target.major > 0) return v.major === target.major;
      if (target.minor > 0) return v.major === 0 && v.minor === target.minor;
      return v.major === 0 && v.minor === 0 && v.patch === target.patch;
  }
  return false;
}

/**
 * @param version 版本，例如 '1.4.0'
 * @param range 範圍，例如 '^1.2.0'、'>=1.0.0 <2.0.0'、'^1.0.0 || ^2.0.0'
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) throw new Error(`版本格式錯誤：${version}`);
  return range.split('||').some((group) =>
    group
      .trim()
      .split(/\s+/)
      .every((comp) => satisfiesComparator(v, comp.trim())),
  );
}
