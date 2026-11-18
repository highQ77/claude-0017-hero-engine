import { playSound } from './AudioSource';
export { AudioManager, Sound } from './AudioManager';
export type { SoundOptions, SoundState, SpatialOptions, MusicOptions, AudioManagerOptions } from './AudioManager';
export { AudioSource, AudioListener, AudioSourceController } from './AudioSource';
export type { AudioSourceData } from './AudioSource';
export { AudioPlugin, AudioKey, AUDIO_PRIORITY } from './AudioPlugin';
export { audioSourceCodec } from './sceneCodecs';
export type { AudioPluginOptions } from './AudioPlugin';

// ───────── 小工具函式（依用途分類）─────────

/** 播放：動畫、觸發器、音效、粒子爆發（audio 模組的部分；總入口 hero.play 有全部） */
export const play = {
  /** 播放 AudioSource 元件的聲音 */
  sound: playSound,
} as const;
