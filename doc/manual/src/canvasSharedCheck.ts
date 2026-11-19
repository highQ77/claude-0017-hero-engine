/**
 * UICanvas 共用模式的回歸檢查（canvas-shared-check.html，check-examples.mjs --run 會執行）：
 * 手冊 UICanvas 一章的每個範例，用 WebGL2D 獨立模式（自己的 WebGL）與共用模式（借用 three.js 的 WebGL 2）各畫一次，
 * 逐像素比較。每個範例之間 three.js 會畫一個有貼圖、混合、深度的場景，確認兩邊不會互相弄亂 GL 狀態。
 */
import * as THREE from 'three';
import WebGL2D, { type WebGL2DRenderingContext } from '@engine/ui2d/canvas2d/webgl2d.js';

const W = 320;
const H = 200;
const PR = 2;

const files = import.meta.glob('../chapters/135-ui-canvas.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function dedent(text: string): string {
  const lines = text.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

interface Ex {
  title: string;
  code: string;
}
const examples: Ex[] = [];
for (const html of Object.values(files))
  for (const m of html.matchAll(
    /<script type="text\/plain" class="example" data-lang="canvas"([^>]*)>([\s\S]*?)<\/script>/g,
  ))
    examples.push({ title: /data-title="([^"]*)"/.exec(m[1])?.[1] ?? '', code: dedent(m[2]) });

// 範例共用素材（和手冊相同）
const tile = document.createElement('canvas');
tile.width = tile.height = 20;
{
  const t = tile.getContext('2d')!;
  t.fillStyle = '#fde68a';
  t.fillRect(0, 0, 20, 20);
  t.fillStyle = '#b45309';
  t.fillRect(0, 0, 10, 10);
  t.fillRect(10, 10, 10, 10);
}
const sampleImage = document.createElement('canvas');
sampleImage.width = 160;
sampleImage.height = 100;
{
  const s = sampleImage.getContext('2d')!;
  const g = s.createLinearGradient(0, 0, 0, 100);
  g.addColorStop(0, '#60a5fa');
  g.addColorStop(1, '#dbeafe');
  s.fillStyle = g;
  s.fillRect(0, 0, 160, 100);
  s.fillStyle = '#4b5563';
  s.beginPath();
  s.moveTo(0, 80);
  s.lineTo(45, 30);
  s.lineTo(80, 70);
  s.lineTo(160, 85);
  s.lineTo(160, 100);
  s.lineTo(0, 100);
  s.fill();
}

// 獨立模式
const ownCanvas = document.createElement('canvas');
ownCanvas.width = W * PR;
ownCanvas.height = H * PR;
const own = WebGL2D.getContext(ownCanvas, { pixelRatio: PR });

// three.js 與共用模式
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(200, 150);
const gl = renderer.getContext() as WebGL2RenderingContext;
const fake = { width: W * PR, height: H * PR } as unknown as HTMLCanvasElement;
const shared = new WebGL2D.WebGL2DRenderingContext(fake, {
  pixelRatio: PR,
  external: { gl, onEnd: () => renderer.resetState() },
} as never) as WebGL2DRenderingContext;

// 會改動很多 GL 狀態的 three.js 場景：貼圖（FLIP_Y、premultiply）、透明混合、深度、背面剔除
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 10);
cam.position.z = 3;
const tex = new THREE.CanvasTexture(sampleImage);
tex.premultiplyAlpha = true;
scene.add(
  new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: tex })),
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5, side: THREE.BackSide }),
  ),
  new THREE.AmbientLight(0xffffff, 1),
);
let frame = 0;
function disturb(): void {
  frame++;
  scene.rotation.y = frame;
  tex.needsUpdate = true;
  renderer.render(scene, cam);
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...a: string[]
) => (...args: unknown[]) => Promise<unknown>;

async function run(ctx: WebGL2DRenderingContext, canvas: HTMLCanvasElement, code: string): Promise<void> {
  const fn = new AsyncFunction(
    'ctx',
    'canvas',
    'uicanvas',
    'UICanvas',
    'Path2D',
    'log',
    'sampleImage',
    'tile',
    `"use strict";\n${code}`,
  );
  const uicanvas = {
    getContext: () => ctx,
    canvas,
    width: W,
    height: H,
    pixelRatio: PR,
    update() {},
    // 共用模式沒有自己的 canvas：讀回像素再轉成圖片（和 UICanvas 共用模式的做法相同）
    toDataURL: (type?: string) => {
      const img = ctx.getImageData(0, 0, W * PR, H * PR);
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
      return c.toDataURL(type);
    },
  };
  const UICanvasLike = {
    Path2D: WebGL2D.Path2D,
    contextOf: WebGL2D.getContext,
    contextOfHiDPI: WebGL2D.getContextHiDPI,
    install: WebGL2D.install,
    RenderingContext: WebGL2D.WebGL2DRenderingContext,
  };
  await fn(ctx, canvas, uicanvas, UICanvasLike, WebGL2D.Path2D, () => {}, sampleImage, tile);
}

/** 平均每個通道的差異（0～255）與差異最大的像素 */
function diff(a: ImageData, b: ImageData): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / a.data.length, max };
}

/**
 * 預期無法比較的範例：
 * - 針對「真的 canvas 元素」的 API（共用模式沒有自己的 canvas）
 * - 影片：兩次執行抓到的畫面不同
 */
const SKIP: Record<string, string> = {
  'UICanvas.contextOf(canvas, options?)': '針對 canvas 元素的 API',
  'UICanvas.install()': '針對 canvas 元素的 API',
  'drawImage(video, …)：繪製影片': '影片畫面隨時間改變',
};

interface Result {
  title: string;
  mean: number;
  max: number;
  error: string | null;
  skipped?: string;
}

async function main(): Promise<Result[]> {
  const results: Result[] = [];
  for (const ex of examples) {
    if (SKIP[ex.title]) {
      results.push({ title: ex.title, mean: NaN, max: NaN, error: null, skipped: SKIP[ex.title] });
      continue;
    }
    let error: string | null = null;
    let a: ImageData | null = null;
    let b: ImageData | null = null;
    try {
      own.reset();
      await run(own, ownCanvas, ex.code);
      a = own.getImageData(0, 0, W * PR, H * PR);
    } catch (e) {
      error = `獨立模式：${(e as Error).message}`;
    }
    disturb();
    try {
      shared.reset();
      await run(shared, fake, ex.code);
      disturb();
      b = shared.getImageData(0, 0, W * PR, H * PR);
    } catch (e) {
      error = `${error ? `${error}；` : ''}共用模式：${(e as Error).message}`;
    }
    const glError = gl.getError();
    if (glError) error = `${error ? `${error}；` : ''}GL 錯誤 0x${glError.toString(16)}`;
    const d = a && b ? diff(a, b) : { mean: NaN, max: NaN };
    results.push({ title: ex.title, ...d, error });
  }
  return results;
}

const results = await main();
const bad = results.filter((r) => !r.skipped && (r.error || !(r.mean < 0.5)));
document.getElementById('out')!.innerHTML =
  `<p class="${bad.length ? 'bad' : 'ok'}">${results.length} 個範例，${bad.length} 個有差異或錯誤，${results.filter((r) => r.skipped).length} 個略過</p><table><tr><th>範例</th><th>平均差異</th><th>最大差異</th><th>錯誤</th></tr>` +
  results
    .map(
      (r) =>
        `<tr class="${!r.skipped && (r.error || !(r.mean < 0.5)) ? 'bad' : ''}"><td>${r.title}</td><td>${r.mean.toFixed(3)}</td><td>${r.max}</td><td>${r.error ?? r.skipped ?? ''}</td></tr>`,
    )
    .join('') +
  '</table>';
(window as unknown as { __sharedCheck: Result[] }).__sharedCheck = results;
