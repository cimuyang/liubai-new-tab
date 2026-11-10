// 壁纸与深浅色的呈现。设置面板和必应壁纸在 appearance.js 中，用到时才加载。

import { state, local } from './store.js';
import { clamp, emit } from './dom.js';

const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
export const PRESETS = [['mist', '晨雾'], ['dawn', '朝霞'], ['sage', '青岚'], ['lilac', '暮紫'], ['plain', '素']]; // 画面定义在 CSS 中
export const GRID_W = 16; // 壁纸亮度网格，用于决定各处文字的深浅
export const GRID_H = 9;

export const usesImage = () => state.appearance.wallpaper === 'image' && !!local.image;

/** 读写保存在 IndexedDB 中的壁纸图片。 */
export function file(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('liubai', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = run(open.result.transaction('files', mode).objectStore('files'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const getBlob = () => file('readonly', (s) => s.get('wallpaper')).catch(() => null);

let imageUrl = null;
async function showImage() {
  const el = document.getElementById('wall-img');
  if (!usesImage()) { el.classList.remove('on'); return; }
  if (!imageUrl) {
    const blob = await getBlob();
    if (!blob) return;
    imageUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.src = imageUrl;
    await img.decode().catch(() => {});
    el.style.backgroundImage = `url("${imageUrl}")`;
  }
  el.classList.add('on');
}

/**
 * 某个位置上的文字该用深色还是浅色。x / y 是窗口比例。
 * 预设壁纸返回空串（跟随深浅色主题）；图片壁纸按该位置附近的亮度判断。
 */
export function toneAt(x, y) {
  if (!usesImage()) return '';
  const { grid, ratio } = local.image;
  const view = innerWidth / innerHeight;
  const spanX = Math.min(1, view / ratio); // cover 裁切后，窗口看到的图片比例
  const spanY = Math.min(1, ratio / view);
  let sum = 0;
  let count = 0;
  for (let dy = -.03; dy <= .09; dy += .03) {
    for (let dx = -.1; dx <= .1; dx += .05) {
      const u = .5 + (clamp(x + dx, 0, 1) - .5) * spanX;
      const v = .5 + (clamp(y + dy, 0, 1) - .5) * spanY;
      sum += +grid[Math.min(GRID_H - 1, Math.floor(v * GRID_H)) * GRID_W + Math.min(GRID_W - 1, Math.floor(u * GRID_W))];
      count++;
    }
  }
  return sum / count / 9 * (1 - state.appearance.dim) > .6 ? 'dark' : 'light';
}

/** 把外观设置应用到页面。reload：壁纸图片已更换，需要重新读取。 */
export function applyAppearance(reload = false) {
  const a = state.appearance;
  const image = usesImage();
  if (reload && imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
  root.dataset.theme = a.theme === 'auto' ? (media.matches ? 'dark' : 'light') : a.theme;
  root.dataset.wall = image ? 'image' : PRESETS.some(([id]) => id === a.wallpaper) ? a.wallpaper : 'mist';
  if (image) root.style.setProperty('--wall', `url("${local.image.preview}") center / cover`);
  else root.style.removeProperty('--wall');
  root.style.setProperty('--dim', image ? a.dim : 0);
  root.style.setProperty('--blur', `${image ? a.blur : 0}px`);
  showImage();
  emit('tone');
}

export function initAppearance() {
  applyAppearance();
  media.addEventListener('change', () => applyAppearance());
  // 图片还在、但占位数据丢失（清除了站点数据）时重建
  if (state.appearance.wallpaper === 'image' && !local.image) {
    getBlob().then(async (blob) => blob && (await import('./appearance.js')).setImage(blob));
  }
}
