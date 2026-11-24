import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { defineComponent, defineTag } from '../ecs/Component';
import { RenderKey } from '../render/keys';
import { Transform } from '../scene';
import type { AudioManager, Sound } from './AudioManager';

/**
 * 聲音來源：掛在實體上的聲音，例如營火的劈啪聲、角色腳步聲。
 * 把 playing 設為 true 就播放；不循環的聲音播完後系統會把 playing 設回 false。
 * spatial 為 true 時，聲音位置跟隨實體的 Transform。
 */
export interface AudioSourceData {
  /** 音效網址 */
  url: string;
  /** 音量群組（例如 'sfx'、'music'，可以整組調音量、靜音） */
  group: string;
  /** 音量（0~1） */
  volume: number;
  /** 播放速度（1 為原速，也會改變音高） */
  pitch: number;
  /** 是否重複播放 */
  loop: boolean;
  /** 是否播放中（設成 true 開始播放，播完自動變回 false） */
  playing: boolean;
  /** 停止時的淡出秒數 */
  fadeOut: number;
  /** 3D 空間音效（建立聲音時決定，播放中修改要重新播放才生效） */
  spatial: boolean;
  /** 在這個距離內是原本的音量（公尺） */
  refDistance: number;
  /** 超過這個距離就不再變小聲（公尺） */
  maxDistance: number;
  /** 離遠時變小聲的速度 */
  rolloff: number;
  /** 遞增可從頭重播（用 playSound 即可） */
  token: number;
  /** 由系統填寫 */
  status: 'idle' | 'loading' | 'playing' | 'error';
}

/** 3D 音效元件：聲音跟著實體的位置（離攝影機越遠越小聲） */
export const AudioSource = defineComponent<AudioSourceData>('AudioSource', () => ({
  url: '',
  group: 'sfx',
  volume: 1,
  pitch: 1,
  loop: false,
  playing: false,
  fadeOut: 0,
  spatial: true,
  refDistance: 1,
  maxDistance: 100,
  rolloff: 1,
  token: 0,
  status: 'idle',
}));

/**
 * 從頭播放（即使正在播放）
 * @param source AudioSource 元件的資料
 */
export function playSound(source: AudioSourceData): void {
  source.playing = true;
  source.token++;
}

/**
 * 聽者：3D 音效以這個實體的位置與朝向來聽。
 * 沒有任何聽者時，自動使用正在繪製的攝影機。
 */
export const AudioListener = defineTag('AudioListener');

interface Tracked {
  sound: Sound | null;
  url: string;
  token: number;
  volume: number;
  pitch: number;
  loop: boolean;
}

const _pos = new THREE.Vector3();

/** 更新 3D 音效的位置（每幀由外掛呼叫） */
export class AudioSourceController {
  private readonly tracked = new Map<Entity, Tracked>();
  private readonly off: () => void;

  /**
   * @param world ECS 世界
   * @param audio 音效管理器
   */
  constructor(
    private readonly world: World,
    private readonly audio: AudioManager,
  ) {
    this.off = world.onRemove(AudioSource, (e, src) => this.release(e, src.fadeOut));
  }

  /** 更新所有音效元件（每幀由外掛呼叫） */
  update(): void {
    this.updateListener();
    this.world.query([AudioSource]).each((e, src) => {
      let t = this.tracked.get(e);
      if (!t) {
        t = { sound: null, url: src.url, token: src.token, volume: src.volume, pitch: src.pitch, loop: src.loop };
        this.tracked.set(e, t);
      }

      // 不循環的聲音播完了
      if (t.sound && !t.sound.playing && t.sound.state !== 'loading') {
        src.status = t.sound.state === 'error' ? 'error' : 'idle';
        // 播完或載入失敗都停止（失敗時不自動重試，避免每幀重複報錯）
        if (t.sound.state === 'ended' || t.sound.state === 'error') src.playing = false;
        t.sound = null;
      }

      const urlChanged = src.url !== t.url;
      const restart = src.token !== t.token;
      const want = src.playing && src.url !== '';

      if (t.sound && (!want || urlChanged || restart)) {
        t.sound.stop(want ? 0 : src.fadeOut);
        t.sound = null;
      }
      if (want && !t.sound) {
        t.sound = this.audio.play(src.url, {
          group: src.group,
          volume: src.volume,
          pitch: src.pitch,
          loop: src.loop,
          spatial: src.spatial
            ? { refDistance: src.refDistance, maxDistance: src.maxDistance, rolloff: src.rolloff }
            : undefined,
        });
        t.volume = src.volume;
        t.pitch = src.pitch;
        t.loop = src.loop;
      }
      t.url = src.url;
      t.token = src.token;
      if (!want && src.status !== 'error') src.status = 'idle';

      const sound = t.sound;
      if (!sound) return;
      src.status = sound.state === 'loading' ? 'loading' : 'playing';
      // 只在數值改變時更新，避免每幀排程音量變化
      if (src.volume !== t.volume) sound.setVolume((t.volume = src.volume), 0.05);
      if (src.pitch !== t.pitch) sound.setPitch((t.pitch = src.pitch));
      if (src.loop !== t.loop) sound.setLoop((t.loop = src.loop));
      if (sound.spatial) {
        const transform = this.world.get(e, Transform);
        if (transform) {
          _pos.setFromMatrixPosition(transform.worldMatrix);
          sound.setPosition(_pos.x, _pos.y, _pos.z);
        }
      }
    });
  }

  /** 停止並移除所有音效元件的聲音 */
  dispose(): void {
    this.off();
    for (const e of [...this.tracked.keys()]) this.release(e, 0);
  }

  private updateListener(): void {
    const world = this.world;
    const listener =
      world.query([AudioListener, Transform]).first() ?? world.getResource(RenderKey)?.activeCamera ?? null;
    const t = listener !== null ? world.get(listener, Transform) : undefined;
    if (t) this.audio.setListenerMatrix(t.worldMatrix);
  }

  private release(e: Entity, fade: number): void {
    const t = this.tracked.get(e);
    if (!t) return;
    t.sound?.stop(fade);
    this.tracked.delete(e);
  }
}
