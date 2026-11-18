#!/usr/bin/env node
/**
 * 把 EXR（例如 Blender 烘焙的光照貼圖）轉成 Radiance .hdr（RGBE，行程壓縮）。
 * 引擎的資源載入支援 .hdr（assets.load），檔案也比未壓縮的 EXR 小很多。
 *
 *   node tools/exr-to-hdr.mjs <檔案或資料夾>...   每個 .exr 旁邊產生同名的 .hdr
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

/** 一個分量的一列做 RLE（Radiance 新格式） */
function rleChannel(src, out) {
  const n = src.length;
  let i = 0;
  while (i < n) {
    // 找下一段長度 ≥ 4 的重複
    let runStart = i;
    let runLen = 0;
    while (runStart < n) {
      runLen = 1;
      while (runStart + runLen < n && runLen < 127 && src[runStart + runLen] === src[runStart]) runLen++;
      if (runLen >= 4) break;
      runStart += runLen;
    }
    if (runLen < 4) runStart = n;
    // 前面不重複的部分（每段最多 128）
    while (i < runStart) {
      const len = Math.min(128, runStart - i);
      out.push(len);
      for (let k = 0; k < len; k++) out.push(src[i + k]);
      i += len;
    }
    if (runStart < n) {
      out.push(128 + runLen, src[runStart]);
      i = runStart + runLen;
    }
  }
}

function toRGBE(r, g, b, out, o) {
  const v = Math.max(r, g, b);
  if (v < 1e-32) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const e = Math.ceil(Math.log2(v + 1e-30) + 1e-9);
  let scale = 256 / 2 ** e;
  if (v * scale >= 256) scale /= 2; // 浮點誤差保護
  const ee = v * scale >= 256 ? e + 1 : e;
  out[o] = Math.min(255, Math.floor(r * scale));
  out[o + 1] = Math.min(255, Math.floor(g * scale));
  out[o + 2] = Math.min(255, Math.floor(b * scale));
  out[o + 3] = ee + 128;
}

function convert(file) {
  const buf = readFileSync(file);
  const loader = new EXRLoader().setDataType(THREE.FloatType);
  const { width, height, data } = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const stride = data.length / (width * height); // 3 或 4
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'ascii');
  const body = [];
  const rgbe = new Uint8Array(width * 4);
  const ch = [0, 1, 2, 3].map(() => new Uint8Array(width));
  let max = 0;
  // EXRLoader 的資料是由下往上（配合 flipY），Radiance -Y 是由上往下
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * stride;
      const r = Math.max(0, data[p]);
      const g = Math.max(0, data[p + 1]);
      const b = Math.max(0, data[p + 2]);
      max = Math.max(max, r, g, b);
      toRGBE(r, g, b, rgbe, x * 4);
      for (let c = 0; c < 4; c++) ch[c][x] = rgbe[x * 4 + c];
    }
    body.push(2, 2, width >> 8, width & 255);
    for (let c = 0; c < 4; c++) rleChannel(ch[c], body);
  }
  const outFile = file.replace(/\.exr$/i, '.hdr');
  writeFileSync(outFile, Buffer.concat([header, Buffer.from(body)]));
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(
    `${file} → ${outFile}（${width}×${height}，最亮 ${max.toFixed(2)}，${mb(buf.length)} MB → ${mb(statSync(outFile).size)} MB）`,
  );
}

const args = process.argv.slice(2);
if (!args.length) {
  console.log('用法：node tools/exr-to-hdr.mjs <檔案或資料夾>...');
  process.exit(1);
}
for (const a of args) {
  if (statSync(a).isDirectory()) {
    for (const f of readdirSync(a)) if (extname(f).toLowerCase() === '.exr') convert(join(a, f));
  } else convert(a);
}
