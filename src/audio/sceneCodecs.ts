/** 音效元件的場景檔存讀規則：AudioSource（AudioPlugin 安裝時登記） */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { AudioSource } from './AudioSource';

/** AudioSource：{ url: 'sounds/fire.mp3', group, volume, pitch, loop, playing（載入後自動播放）, fadeOut, spatial, … } */
export const audioSourceCodec = plainCodec(AudioSource, { skip: ['token', 'status'] });

/** 音效模組提供的所有存讀規則 */
export const audioCodecs: readonly ComponentCodec<never>[] = [audioSourceCodec] as unknown as ComponentCodec<never>[];
