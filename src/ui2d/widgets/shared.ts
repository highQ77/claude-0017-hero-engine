/** 平滑接近目標：每秒縮小差距（時間常數 tau 秒） */
export const approach = (from: number, to: number, dt: number, tau: number) =>
  tau <= 0 ? to : to + (from - to) * Math.exp(-dt / tau);
