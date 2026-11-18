/**
 * 測試用的 Web Audio 替身（Node 沒有 AudioContext）。
 * 只實作引擎用到的部分，並記錄連線與排程，方便檢查。
 */

export class FakeParam {
  events: string[] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(`set ${v}@${t}`);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(`ramp ${v}@${t}`);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push(`cancel@${t}`);
    return this;
  }
}

class FakeNode {
  outputs = new Set<FakeNode>();
  disconnected = false;
  connect(node: FakeNode) {
    this.outputs.add(node);
    return node;
  }
  disconnect() {
    this.outputs.clear();
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  offset = 0;
  stopAt: number | null = null;
  start(when = 0, offset = 0) {
    this.startedAt = when;
    this.offset = offset;
  }
  stop(when = 0) {
    this.stopAt = when;
  }
  /** 模擬聲音真的結束（播完或到了 stop 的時間） */
  end() {
    this.onended?.();
  }
}

export class FakePanner extends FakeNode {
  panningModel = '';
  distanceModel = '';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
}

export class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  listener = {
    positionX: new FakeParam(),
    positionY: new FakeParam(),
    positionZ: new FakeParam(),
    forwardX: new FakeParam(),
    forwardY: new FakeParam(),
    forwardZ: new FakeParam(-1),
    upX: new FakeParam(),
    upY: new FakeParam(1),
    upZ: new FakeParam(),
  };
  createGain() {
    return new FakeGain();
  }
  createPanner() {
    return new FakePanner();
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  /** 最後建立的聲音來源 */
  get last(): FakeSource {
    return this.sources[this.sources.length - 1];
  }
}

/** 假的音效資料 */
export function fakeBuffer(name = 'buf'): AudioBuffer {
  return { name, duration: 1 } as unknown as AudioBuffer;
}
