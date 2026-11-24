import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { AssetPlugin } from '../assets/AssetPlugin';
import { AudioManager, type AudioManagerOptions } from './AudioManager';
import { AudioSourceController } from './AudioSource';
import { AudioKey } from './keys';
import { registerSceneCodecs } from '../scene/SceneFile';
import { audioCodecs } from './sceneCodecs';
export { AudioKey } from './keys';

/** 同步聲音位置的優先度（render 階段，在變換計算之後、繪製之前） */
export const AUDIO_PRIORITY = 800;

/** AudioPlugin 的設定 */
export interface AudioPluginOptions extends AudioManagerOptions {
  /** 引擎暫停時一併暫停所有聲音，預設 true */
  pauseWithEngine?: boolean;
}

/**
 * 音效外掛：音效、音樂、音量群組、3D 空間音效。需先安裝 EcsPlugin 與 AssetPlugin。
 */
export class AudioPlugin implements Plugin {
  readonly name = 'audio';
  readonly dependencies = ['ecs', 'assets'] as const;
  private _audio: AudioManager | null = null;
  private controller: AudioSourceController | null = null;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  private cleanup: (() => void)[] = [];
  /** 取消登記場景檔存讀規則 */
  private offCodecs: () => void = () => {};

  /**
   * @param options AudioContext、音量群組、同時播放的上限、遊戲暫停時是否一起暫停
   */
  constructor(private readonly options: AudioPluginOptions = {}) {}

  /** 音效管理器（也可以用 world.requireResource(AudioKey) 取得） */
  get audio(): AudioManager {
    if (!this._audio) throw new Error('AudioPlugin 尚未安裝');
    return this._audio;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    const assets = engine.getPlugin<AssetPlugin>('assets')!.assets;
    this.ecs = ecs;
    this.world = ecs.world;

    const audio = (this._audio = new AudioManager(assets, this.options));
    ecs.world.setResource(AudioKey, audio);
    this.offCodecs = registerSceneCodecs(ecs.world, audioCodecs);
    const controller = (this.controller = new AudioSourceController(ecs.world, audio));
    ecs.addSystem({ name: 'audio', phase: 'render', priority: AUDIO_PRIORITY, run: () => controller.update() });

    if (this.options.pauseWithEngine ?? true) {
      let resumeOnStart = false;
      this.cleanup.push(
        engine.addListener('pause', () => {
          resumeOnStart = audio.unlocked;
          void audio.suspend();
        }),
        engine.addListener('resume', () => {
          if (resumeOnStart) void audio.unlock();
        }),
      );
    }

    // 瀏覽器要求使用者操作後才能發聲：第一次點擊或按鍵時解鎖
    if (typeof window !== 'undefined') {
      const events = ['pointerdown', 'keydown', 'touchend'] as const;
      const unlock = () => {
        if (engine.state === 'paused') return;
        void audio.unlock().then(() => {
          if (audio.unlocked) for (const type of events) window.removeEventListener(type, unlock, true);
        });
      };
      for (const type of events) window.addEventListener(type, unlock, true);
      this.cleanup.push(() => {
        for (const type of events) window.removeEventListener(type, unlock, true);
      });
    }
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    for (const fn of this.cleanup.splice(0)) fn();
    this.ecs?.removeSystem('audio');
    this.controller?.dispose();
    this._audio?.dispose();
    if (this.world?.getResource(AudioKey) === this._audio) this.world?.removeResource(AudioKey);
    this._audio = null;
    this.controller = null;
    this.ecs = this.world = null;
  }
}
