import { contrast, luminance } from './color.js';

const MAX_EDGE = 512;

function nativeEdge(canvas, ctx) {
  const edge = canvas.width;
  if (edge !== canvas.height || edge < 32) return Math.max(edge, canvas.height);
  const { data } = ctx.getImageData(0, 0, edge, edge);
  const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  // Chromium 在整数倍放大时使用最近邻。只有整张图都符合重复像素块才判为放大图。
  let native = edge;
  for (const factor of [2, 4, 8, 16]) {
    if (edge % factor || edge / factor < 16) break;
    let repeated = true;
    for (let y = 0; y < edge && repeated; y++) {
      for (let x = 0; x < edge; x++) {
        const first = (y - y % factor) * edge + x - x % factor;
        if (pixels[y * edge + x] !== pixels[first]) { repeated = false; break; }
      }
    }
    if (!repeated) break;
    native = edge / factor;
  }
  return native;
}

function palette(image) {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const colors = new Map();
  let coverage = 0;
  let edges = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const alpha = pixels[i + 3] / 255;
      if (alpha < .35) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      const color = colors.get(key) || { r: 0, g: 0, b: 0, count: 0, edge: 0 };
      color.r += r * alpha;
      color.g += g * alpha;
      color.b += b * alpha;
      color.count += alpha;
      coverage += alpha;
      if (x === 0 || x === size - 1 || y === 0 || y === size - 1) {
        color.edge += alpha;
        edges += alpha;
      }
      colors.set(key, color);
    }
  }
  if (coverage < 3) return null;
  const swatches = [...colors.values()].sort((a, b) => b.count - a.count);
  const border = swatches.reduce((best, color) => color.edge > best.edge ? color : best);
  const hasBorder = edges > (size * 4 - 4) * .7 && border.edge > edges * .65;
  const color = hasBorder ? border : swatches[0];
  const tone = [color.r, color.g, color.b].map((v) => Math.round(v / color.count));
  let fill = tone;
  if (!hasBorder && coverage < size * size * .95) {
    // 透明标志需要与底色拉开亮度，避免同色的笔画消失。
    const ink = luminance(...tone);
    const target = ink > .3 ? 0 : 255;
    for (const amount of [.35, .55, .75, .9]) {
      fill = tone.map((v) => Math.round(v + (target - v) * amount));
      if (contrast(ink, luminance(...fill)) >= 3) break;
    }
  }
  return { tint: tone.join(' '), fill: fill.join(' '), fullBleed: hasBorder && coverage > size * size * .97 };
}

export async function describeIcon(blob, browserResized = false) {
  if (!blob?.size) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const edge = Math.max(img.naturalWidth, img.naturalHeight);
    if (edge < 8 || edge > 8192 || img.naturalWidth * img.naturalHeight > 16_000_000) return null;
    const vector = blob.type === 'image/svg+xml';
    const scale = vector ? MAX_EDGE / edge : Math.min(1, MAX_EDGE / edge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: browserResized });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const colors = palette(canvas);
    if (!colors) return null;
    const size = browserResized ? nativeEdge(canvas, ctx) : Math.max(canvas.width, canvas.height);
    let output = canvas;
    if (size < Math.max(canvas.width, canvas.height)) {
      output = document.createElement('canvas');
      output.width = output.height = size;
      const down = output.getContext('2d');
      down.imageSmoothingEnabled = false;
      down.drawImage(canvas, 0, 0, size, size);
    }
    let data = output.toDataURL('image/png');
    if (data.length > 180_000) {
      const compact = output.toDataURL('image/webp', .94);
      if (compact.length < data.length) data = compact;
    }
    if (data.length > 700_000) return null;
    return { data, size, vector, ...colors };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
