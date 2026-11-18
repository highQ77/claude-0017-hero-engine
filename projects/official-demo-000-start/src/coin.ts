/**
 * 腳本：金幣。會旋轉；被方塊或球碰到（或被點擊）就收集，3 秒後重生。
 * 示範腳本的生命週期、觸發區事件、滑鼠事件、補間、音效、粒子與等待。
 * （寫在預製物件 prefabs/coin.xml 的 ScriptList 裡；levels.ts 用 scripts.register 登記名稱）
 */
import type { Entity } from '@engine/ecs';
import { Quaternion, Vector3 } from '@engine/math';
import { Collider } from '@engine/physics';
import { Script } from '@engine/scripts';
import { CoinCollected, Player, Toy } from './components';
import { burst, floatText, sparks } from './fx';

const UP = new Vector3(0, 1, 0);

export class Coin extends Script {
  value = 1;
  private collected = false;
  private readonly spin = new Quaternion();

  onUpdate(dt: number) {
    this.transform.rotation.multiply(this.spin.setFromAxisAngle(UP, dt * 2.5));
  }

  onTriggerEnter(other: Entity) {
    if (this.world.has(other, Player) || this.world.has(other, Toy)) void this.collect();
  }

  onClick() {
    void this.collect();
  }

  // 滑鼠移上去：稍微放大，告訴玩家「這個可以點」
  onPointerEnter() {
    if (!this.collected) this.scaleTo(1.3, 0.15);
  }

  onPointerExit() {
    if (!this.collected) this.scaleTo(1, 0.2);
  }

  private scaleTo(s: number, duration: number) {
    const scale = this.transform.scale;
    this.tweens.killTweensOf(scale);
    return this.tweens.to(scale, { x: s, y: s, z: s }, { duration, easing: 'backOut', entity: this.entity });
  }

  private async collect() {
    if (this.collected) return;
    this.collected = true;
    this.emit(CoinCollected, { value: this.value });
    const p = this.transform.position;
    this.audio.play('sounds/pop.wav', { pitch: 1.8, volume: 0.7 });
    burst(this.world, p, sparks(25, 0xfff3a0, 0xffb000));
    floatText(this.world, p, `+${this.value}`);
    this.remove(Collider); // 收集後暫時不再觸發
    this.tweens.killTweensOf(this.transform.scale);
    await this.tweens.to(
      this.transform.scale,
      { x: 0, y: 0, z: 0 },
      { duration: 0.25, easing: 'backIn', entity: this.entity },
    ).finished;
    await this.wait(3); // 腳本被銷毀（例如切換場景）時，下面不會執行
    this.add(Collider, { shape: 'cylinder', radius: 0.3, halfHeight: 0.3, sensor: true });
    await this.scaleTo(1, 0.4).finished;
    this.collected = false;
  }
}
