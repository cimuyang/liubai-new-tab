// 壁纸、首帧预览与文字对比度。原图留在 IndexedDB。
import { state, local, saveLocal } from './store.js';
import { clamp, emit, on } from './dom.js';
import { contrast, luminance } from './color.js';
import { transaction } from './db.js';

const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
export const PRESETS = [['mist', '晨雾'], ['dawn', '朝霞'], ['sage', '青岚'], ['lilac', '暮紫'], ['plain', '素']];
const GRID_W = 128;
const GRID_H = 72;
const INK = luminance(20, 20, 20);

export const usesImage = () => state.appearance.wallpaper === 'image' && !!local.image?.preview;

export async function file(mode, run) {
  return (await transaction('liubai', 'files', mode, run)).result;
}
const getBlob = () => file('readonly', (store) => store.get('wallpaper')).catch(() => null);

let imageUrl;
let imageLoad;
let imageRevision = 0;

function showImage(reload) {
  const el = document.getElementById('wall-img');
  if (reload) {
    imageRevision++;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = imageLoad = null;
    el.classList.remove('on');
    el.style.removeProperty('background-image');
  }
  if (!usesImage()) { el.classList.remove('on'); return; }
  if (imageUrl) { el.classList.add('on'); return; }
  if (imageLoad) return;
  const revision = imageRevision;
  imageLoad = (async () => {
    const blob = await getBlob();
    if (!blob || revision !== imageRevision) return;
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (revision !== imageRevision || !usesImage()) { URL.revokeObjectURL(url); return; }
      imageUrl = url;
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add('on');
    } catch {
      URL.revokeObjectURL(url);
    }
  })().finally(() => { if (revision === imageRevision) imageLoad = null; });
}

export function imageGrid(img) {
  const canvas = document.createElement('canvas');
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, GRID_W, GRID_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, GRID_W, GRID_H);
  const { data } = ctx.getImageData(0, 0, GRID_W, GRID_H);
  const rgb = new Uint8Array(GRID_W * GRID_H * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) rgb.set(data.subarray(i, i + 3), j);
  return btoa(String.fromCharCode(...rgb));
}

// Draw the same centered cover and blur as the wallpaper, at analysis resolution.
let sampledImage;
let gridCanvas;
function sourceGrid() {
  if (sampledImage === local.image) return gridCanvas;
  sampledImage = local.image;
  gridCanvas = null;
  const bytes = sampledImage?.rgb && atob(sampledImage.rgb);
  const legacy = !bytes && /^[0-9]{144}$/.test(sampledImage?.grid);
  if (!legacy && bytes?.length !== GRID_W * GRID_H * 3) return null;
  const canvas = document.createElement('canvas');
  canvas.width = legacy ? 16 : GRID_W;
  canvas.height = legacy ? 9 : GRID_H;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length / 4; i++) {
    for (let c = 0; c < 3; c++) pixels.data[4 * i + c] = legacy
      ? Math.round(Number(sampledImage.grid[i]) * 255 / 9)
      : bytes.charCodeAt(3 * i + c);
    pixels.data[4 * i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return gridCanvas = canvas;
}

function inkScores() {
  const source = sourceGrid();
  if (!source || !innerWidth || !innerHeight) return null;
  const { blur, dim } = state.appearance;
  const scale = 160 / Math.max(innerWidth, innerHeight);
  const pad = Math.ceil(blur * 2 * scale);
  const w = Math.max(1, Math.round(innerWidth * scale));
  const h = Math.max(1, Math.round(innerHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w + 2 * pad;
  canvas.height = h + 2 * pad;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ratio = local.image.ratio;
  if (!(ratio > 0)) return null;
  const dw = Math.max(canvas.width, canvas.height * ratio);
  const dh = dw / ratio;
  if (blur) ctx.filter = `blur(${blur * scale}px)`;
  ctx.drawImage(source, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  ctx.filter = 'none';
  const { data } = ctx.getImageData(pad, pad, w, h);
  const samples = [];
  for (const id of ['clock', 'date', 'weather', 'links']) {
    const block = state.layout[id];
    if (!block.visible || id === 'links' && (!block.labels || block.labelColor !== 'auto')) continue;
    // Fixed regions depend on the saved layout, never on the active group's contents.
    const wide = id === 'links' ? Math.min(.38, .036 * block.columns * block.scale)
      : id === 'clock' ? .12 * block.scale : .09 * block.scale;
    const above = id === 'links' ? 0 : .045 * block.scale;
    const below = id === 'links' ? .24 * block.scale : above;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 13; col++) {
        const x = clamp(Math.round((block.x + wide * (col / 6 - 1)) * w), 0, w - 1);
        const y = clamp(Math.round((block.y - above + (above + below) * row / 6) * h), 0, h - 1);
        const i = (y * w + x) * 4;
        samples.push(luminance(data[i], data[i + 1], data[i + 2], 1 - dim));
      }
    }
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return {
    light: Math.log(contrast(1, samples[Math.floor((samples.length - 1) * .85)])),
    dark: Math.log(contrast(INK, samples[Math.floor((samples.length - 1) * .15)])),
  };
}

let inkFrame;
let previousImage;
let previousTone;
export function scheduleInk() {
  if (!state || inkFrame) return;
  inkFrame = requestAnimationFrame(() => {
    inkFrame = 0;
    const a = state.appearance;
    const fallback = root.dataset.theme === 'dark' ? 'light' : 'dark';
    let tone = a.ink === 'auto' ? fallback : a.ink;
    if (a.ink === 'auto' && usesImage()) {
      let scores;
      try { scores = inkScores(); } catch { /* An unreadable sample uses the theme. */ }
      if (scores) {
        const diff = scores.light - scores.dark;
        tone = previousImage === local.image && Math.abs(diff) < .12
          ? previousTone : diff >= 0 ? 'light' : 'dark';
      }
      previousImage = local.image;
      previousTone = tone;
    } else {
      previousImage = null;
    }
    const ink = tone === 'custom' ? a.inkColor : tone === 'light' ? '#ffffff' : '#141414';
    const lightShadow = a.inkShadow ? '0 1px 2px #0008, 0 0 8px #0003' : 'none';
    const darkShadow = a.inkShadow ? '0 1px 2px #fff7, 0 0 8px #fff3' : 'none';
    const rgb = ink.slice(1).match(/../g).map((part) => parseInt(part, 16));
    root.style.setProperty('--page-ink', ink);
    root.style.setProperty('--light-ink-shadow', lightShadow);
    root.style.setProperty('--dark-ink-shadow', darkShadow);
    root.style.setProperty('--ink-shadow', luminance(...rgb) > .32 ? lightShadow : darkShadow);
  });
}

export function applyAppearance(reload = false) {
  const a = state.appearance;
  const image = usesImage();
  root.dataset.theme = a.theme === 'auto' ? (media.matches ? 'dark' : 'light') : a.theme;
  root.dataset.wall = image ? 'image' : PRESETS.some(([id]) => id === a.wallpaper) ? a.wallpaper : 'mist';
  if (image) root.style.setProperty('--wall', `url("${local.image.preview}") center / cover`);
  else root.style.removeProperty('--wall');
  root.style.setProperty('--dim', image ? a.dim : 0);
  root.style.setProperty('--blur', `${image ? a.blur : 0}px`);
  showImage(reload);
  emit('tone');
}

async function upgradeGrid() {
  const saved = local.image;
  if (state.appearance.wallpaper !== 'image' || saved?.rgb) return;
  const blob = await getBlob();
  if (!blob || local.image !== saved || state.appearance.wallpaper !== 'image') return;
  if (!saved?.preview) {
    const { setImage } = await import('./appearance.js');
    if (local.image === saved && state.appearance.wallpaper === 'image') await setImage(blob);
    return;
  }
  const img = await createImageBitmap(blob);
  try {
    if (local.image !== saved) return;
    local.image = { preview: saved.preview, ratio: img.width / img.height, credit: saved.credit, rgb: imageGrid(img) };
    saveLocal('image');
    emit('tone');
  } finally {
    img.close();
  }
}

export function initAppearance() {
  applyAppearance();
  media.addEventListener('change', () => applyAppearance());
  on('wallpaper-file', () => applyAppearance(true));
  const upgrade = () => upgradeGrid().catch(() => {});
  if (window.requestIdleCallback) requestIdleCallback(upgrade, { timeout: 1500 });
  else setTimeout(upgrade, 100);
}
