/** 動畫元件的場景檔存讀規則：Animator（AnimationPlugin 安裝時登記） */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { Animator } from './Animator';

/** Animator：{ play: '片段名稱', loop, speed, fade, paused }（自訂片段 clips 不能存，用 Model 附帶的動畫） */
export const animatorCodec = plainCodec(Animator, {
  nullable: ['play'],
  skip: ['clips', 'token', 'current', 'time', 'duration', 'finished'],
});

/** 動畫模組提供的所有存讀規則 */
export const animationCodecs: readonly ComponentCodec<never>[] = [animatorCodec] as unknown as ComponentCodec<never>[];
