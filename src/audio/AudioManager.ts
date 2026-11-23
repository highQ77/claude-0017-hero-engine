import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { createLogger } from '../core/Logger';

const log = createLogger('audio');

/** 3D 音效的設定（聲音有位置，會依距離變小聲、左右聲道不同） */
export interface SpatialOptions {
  /** 開始衰減的距離 */
  refDistance?: number;
  /** 超過此距離不再衰減 */
  maxDistance?: number;
  /** 衰減速度 */
  rolloff?: number;
  /** 距離衰減的方式：inverse（預設）、linear、exponential */
  distanceModel?: DistanceModelType;
}

/** 播放音效的設定 */
export interface SoundOptions {
  /** 音量群組，預設 'sfx' */
  group?: string;
  /** 音量（0~1，預設 1） */
  volume?: number;
  /** 播放速度（同時影響音高） */
  pitch?: number;
  /** 隨機音高範圍，例如 0.1 代表 ±10%（讓重複音效不單調） */
  randomPitch?: number;
  /** 是否重複播放 */
  loop?: boolean;
  /** 淡入秒數 */
  fadeIn?: number;
  /** 從第幾秒開始播放 */
  offset?: number;
  /** 3D 空間音效設定；有給就會依位置衰減與左右聲道 */
  spatial?: SpatialOptions;
  /** 3D 音效的初始位置 */
  position?: { x: number; y: number; z: number };
}

/** 音效狀態：載入中、播放中、淡出中、已停止、播完、錯誤 */
export type SoundState = 'loading' | 'playing' | 'stopping' | 'stopped' | 'ended' | 'error';

/**
 * 一個播放中的聲音。
 * await sound.ended 會在聲音結束（播完、被停止或載入失敗）後完成。
 */
export class Sound {
  /** 播完或被停止時完成的 Promise（await sound.ended） */
  readonly ended: Promise<void>;
  private _state: SoundState = 'loading';
  private source: AudioBufferSourceNode | null = null;
  private readonly gain: GainNode;
  private readonly panner: PannerNode | null;
  private done = false;
  private resolveEnded!: () => void;
  private volume: number;
  private pitch: number;
  private loop: boolean;

  /** @internal 請用 AudioManager.play() 建立 */
  constructor(
    private readonly manager: AudioManager,
    private readonly options: SoundOptions,
    bus: GainNode,
  ) {
    this.ended = new Promise((r) => (this.resolveEnded = r));
    const ctx = manager.context;
    this.volume = options.volume ?? 1;
    const random = options.randomPitch ?? 0;
    this.pitch = (options.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * random);
    this.loop = options.loop ?? false;

    this.gain = ctx.createGain();
    this.gain.gain.value = options.fadeIn ? 0 : this.volume;
    if (options.spatial) {
      const p = (this.panner = ctx.createPanner());
      p.panningModel = 'HRTF';
      p.distanceModel = options.spatial.distanceModel ?? 'inverse';
      p.refDistance = options.spatial.refDistance ?? 1;
      p.maxDistance = options.spatial.maxDistance ?? 100;
      p.rolloffFactor = options.spatial.rolloff ?? 1;
      if (options.position) this.setPosition(options.position.x, options.position.y, options.position.z);
      this.gain.connect(p);
      p.connect(bus);
    } else {
      this.panner = null;
      this.gain.connect(bus);
    }
  }

  /** 目前的狀態 */
  get state(): SoundState {
    return this._state;
  }

  /** 正在發聲（包含淡出中） */
  get playing(): boolean {
    return this._state === 'playing' || this._state === 'stopping';
  }

  /** 是不是 3D 音效 */
  get spatial(): boolean {
    return this.panner !== null;
  }

  /** 停止；fade 秒數內淡出 */
  stop(fade = 0): void {
    if (this.done || this._state === 'stopping') return;
    if (this._state === 'loading' || !this.source) {
      this.finish('stopped');
      return;
    }
    if (fade > 0) {
      this._state = 'stopping';
      this.ramp(0, fade);
      this.source.stop(this.manager.context.currentTime + fade);
    } else {
      this._state = 'stopping';
      this.source.stop();
    }
  }

  /** 設定音量（fade：幾秒內慢慢變過去） */
  setVolume(volume: number, fade = 0): void {
    this.volume = volume;
    if (this._state === 'playing') this.ramp(volume, fade);
    else if (this._state === 'loading') this.gain.gain.value = this.options.fadeIn ? 0 : volume;
  }

  /** 目前的音量 */
  getVolume(): number {
    return this.volume;
  }

  /** 設定播放速度（1 為原速，也會改變音高） */
  setPitch(pitch: number): void {
    this.pitch = pitch;
    if (this.source) this.source.playbackRate.value = pitch;
  }

  /** 設定是否重複播放 */
  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.source) this.source.loop = loop;
  }

  /** 設定 3D 位置（只對空間音效有效） */
  setPosition(x: number, y: number, z: number): void {
    const p = this.panner;
    if (!p) return;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  /** @internal 緩衝資料就緒後開始播放 */
  _start(buffer: AudioBuffer): void {
    if (this._state !== 'loading') return;
    const ctx = this.manager.context;
    const source = (this.source = ctx.createBufferSource());
    source.buffer = buffer;
    source.loop = this.loop;
    source.playbackRate.value = this.pitch;
    source.connect(this.gain);
    source.onended = () => this.finish(this._state === 'stopping' ? 'stopped' : 'ended');
    source.start(0, this.options.offset ?? 0);
    this._state = 'playing';
    if (this.options.fadeIn) this.ramp(this.volume, this.options.fadeIn);
  }

  /** @internal */
  _fail(): void {
    if (this._state === 'loading') this.finish('error');
  }

  private ramp(target: number, seconds: number): void {
    const param = this.gain.gain;
    const now = this.manager.context.currentTime;
    param.cancelScheduledValues(now);
    if (seconds > 0) {
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + seconds);
    } else {
      param.setValueAtTime(target, now);
    }
  }

  private finish(state: SoundState): void {
    if (this.done) return;
    this.done = true;
    this._state = state;
    if (this.source) {
      this.source.onended = null;
      this.source.disconnect();
    }
    this.gain.disconnect();
    this.panner?.disconnect();
    this.manager._onSoundFinished(this);
    this.resolveEnded();
  }
}

/** 背景音樂的設定 */
export interface MusicOptions {
  /** 淡入淡出秒數，預設 1 */
  fade?: number;
  /** 音量（0~1） */
  volume?: number;
  /** 預設 true */
  loop?: boolean;
}

/** AudioManager 的設定 */
export interface AudioManagerOptions {
  /** 自訂 AudioContext（預設使用 three.js 共用的那一個） */
  context?: AudioContext;
  /** 音量群組，預設 ['music', 'sfx', 'ui', 'voice'] */
  groups?: string[];
  /** 同時發聲上限，超過時停止最舊的，預設 64 */
  maxVoices?: number;
}

interface Group {
  gain: GainNode;
  volume: number;
  muted: boolean;
}

/**
 * 音效管理：播放音效與音樂、音量群組、3D 聽者位置。
 *
 * 瀏覽器規定必須在使用者操作（點擊、按鍵）後才能發聲，
 * AudioPlugin 會自動在第一次操作時呼叫 unlock()。
 */
export class AudioManager {
  /** 瀏覽器的音訊環境（進階用途：自己接 Web Audio 節點） */
  readonly context: AudioContext;
  private readonly master: Group;
  private readonly groups = new Map<string, Group>();
  private readonly sounds = new Set<Sound>();
  private readonly order: Sound[] = [];
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer>>();
  private readonly maxVoices: number;
  private music: { url: string; sound: Sound } | null = null;
  private disposed = false;

  constructor(
    private readonly assets: AssetManager | null,
    options: AudioManagerOptions = {},
  ) {
    if (options.context) THREE.AudioContext.setContext(options.context); // 讓 three.js 的音效載入器共用
    this.context = options.context ?? (THREE.AudioContext.getContext() as AudioContext);
    this.maxVoices = options.maxVoices ?? 64;

    const masterGain = this.context.createGain();
    masterGain.connect(this.context.destination);
    this.master = { gain: masterGain, volume: 1, muted: false };
    for (const name of options.groups ?? ['music', 'sfx', 'ui', 'voice']) {
      const gain = this.context.createGain();
      gain.connect(masterGain);
      this.groups.set(name, { gain, volume: 1, muted: false });
    }
  }

  /** 是否已經可以發聲 */
  get unlocked(): boolean {
    return this.context.state === 'running';
  }

  /** 正在播放的音效數量 */
  get activeCount(): number {
    return this.sounds.size;
  }

  /** 目前的背景音樂網址（沒有時是 null） */
  get currentMusic(): string | null {
    return this.music?.url ?? null;
  }

  /** 解除瀏覽器的自動播放限制（需在使用者操作的事件中呼叫） */
  async unlock(): Promise<void> {
    if (this.context.state !== 'running' && this.context.state !== 'closed') await this.context.resume();
  }

  /** 暫停所有聲音（例如遊戲暫停、切到背景） */
  async suspend(): Promise<void> {
    if (this.context.state === 'running') await this.context.suspend();
  }

  // ───────── 音量 ─────────

  /** 設定群組音量（'master' 為總音量） */
  setVolume(group: string, volume: number, fade = 0): void {
    const g = this.group(group);
    g.volume = Math.max(0, volume);
    this.applyGroup(g, fade);
  }

  /** 群組的音量（0~1） */
  getVolume(group: string): number {
    return this.group(group).volume;
  }

  /** 設定群組靜音（例如 'music'、'sfx'、'ui'） */
  setMuted(group: string, muted: boolean): void {
    const g = this.group(group);
    g.muted = muted;
    this.applyGroup(g, 0);
  }

  /** 群組是否靜音 */
  isMuted(group: string): boolean {
    return this.group(group).muted;
  }

  /** 所有群組名稱 */
  get groupNames(): string[] {
    return [...this.groups.keys()];
  }

  // ───────── 資源 ─────────

  /** 預先載入並常駐（之後播放可立即發聲，不必等下載與解碼） */
  async preload(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.bufferOf(url)));
  }

  /** 釋放常駐的音效資料 */
  unload(url: string): void {
    if (!this.buffers.delete(url)) return;
    this.assets?.release(url, 'audio');
  }

  // ───────── 播放 ─────────

  /**
   * 播放音效。網址第一次播放時會自動載入並常駐。
   * @example
   * audio.play('sfx/jump.ogg', { randomPitch: 0.1 });
   * audio.play('sfx/explosion.ogg', { spatial: { refDistance: 2 }, position: hitPoint });
   */
  play(source: string | AudioBuffer, options: SoundOptions = {}): Sound {
    const sound = new Sound(this, options, this.group(options.group ?? 'sfx').gain);
    this.sounds.add(sound);
    this.order.push(sound);
    this.enforceVoiceLimit();

    if (typeof source !== 'string') {
      sound._start(source);
    } else {
      const cached = this.buffers.get(source);
      if (cached) {
        sound._start(cached); // 已常駐：立即播放
      } else {
        this.bufferOf(source).then(
          (buffer) => sound._start(buffer),
          (error) => {
            log.error(error);
            sound._fail();
          },
        );
      }
    }
    return sound;
  }

  /** 播放背景音樂，與目前的音樂交叉淡入淡出；同一首正在播放時不重新開始 */
  playMusic(url: string, options: MusicOptions = {}): Sound {
    const fade = options.fade ?? 1;
    if (this.music?.url === url && this.music.sound.playing) {
      this.music.sound.setVolume(options.volume ?? 1, fade);
      return this.music.sound;
    }
    this.music?.sound.stop(fade);
    const sound = this.play(url, {
      group: 'music',
      loop: options.loop ?? true,
      volume: options.volume ?? 1,
      fadeIn: fade,
    });
    this.music = { url, sound };
    return sound;
  }

  /** 停止背景音樂（fade：淡出秒數） */
  stopMusic(fade = 1): void {
    this.music?.sound.stop(fade);
    this.music = null;
  }

  /** 停止所有聲音（fade：淡出秒數） */
  stopAll(fade = 0): void {
    for (const s of [...this.sounds]) s.stop(fade);
    this.music = null;
  }

  /** 依世界矩陣設定聽者位置與朝向（-Z 為前方、+Y 為上方） */
  setListenerMatrix(matrix: THREE.Matrix4): void {
    const e = matrix.elements;
    const l = this.context.listener;
    const [px, py, pz] = [e[12], e[13], e[14]];
    const [fx, fy, fz] = normalize(-e[8], -e[9], -e[10]);
    const [ux, uy, uz] = normalize(e[4], e[5], e[6]);
    if (l.positionX) {
      l.positionX.value = px;
      l.positionY.value = py;
      l.positionZ.value = pz;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    } else {
      // Firefox 等舊介面
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** 停止所有聲音並釋放常駐資料（不會關閉共用的 AudioContext） */
  dispose(): void {
    this.disposed = true;
    this.stopAll();
    for (const url of [...this.buffers.keys()]) this.unload(url);
    this.pending.clear();
    for (const g of this.groups.values()) g.gain.disconnect();
    this.master.gain.disconnect();
  }

  /** @internal */
  _onSoundFinished(sound: Sound): void {
    this.sounds.delete(sound);
    const i = this.order.indexOf(sound);
    if (i !== -1) this.order.splice(i, 1);
    if (this.music?.sound === sound) this.music = null;
  }

  // ───────── 內部 ─────────

  private group(name: string): Group {
    if (name === 'master') return this.master;
    const g = this.groups.get(name);
    if (!g) throw new Error(`未知的音量群組「${name}」，可用的有：master、${this.groupNames.join('、')}`);
    return g;
  }

  private applyGroup(g: Group, fade: number): void {
    const target = g.muted ? 0 : g.volume;
    const param = g.gain.gain;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    if (fade > 0) {
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + fade);
    } else {
      param.setValueAtTime(target, now);
      param.value = target;
    }
  }

  private bufferOf(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) return Promise.resolve(cached);
    let p = this.pending.get(url);
    if (!p) {
      if (!this.assets) return Promise.reject(new Error('沒有 AssetManager，無法用網址播放'));
      p = this.assets.load(url, 'audio').then(
        (buffer) => {
          this.pending.delete(url);
          if (this.disposed)
            this.assets!.release(url, 'audio'); // 載入完成前已被釋放
          else this.buffers.set(url, buffer);
          return buffer;
        },
        (error) => {
          this.pending.delete(url);
          throw error;
        },
      );
      this.pending.set(url, p);
    }
    return p;
  }

  private enforceVoiceLimit(): void {
    while (this.order.length > this.maxVoices) {
      const oldest = this.order.shift()!;
      oldest.stop();
      this.sounds.delete(oldest);
    }
  }
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
