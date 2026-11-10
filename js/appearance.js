// 外观面板：主题、壁纸（预设 / 自己的图片 / 必应）。只在打开面板或「每日自动」时加载。

import { state, save, local, saveLocal } from './store.js';
import { h, pickFile, today } from './dom.js';
import { sheet, control, toast } from './ui.js';
import { PRESETS, GRID_W, GRID_H, usesImage, file, applyAppearance } from './wallpaper.js';

/** 设为壁纸：保存图片，并生成首帧占位图与亮度网格。图片只保存在本机。 */
export async function setImage(blob, credit = '') {
  const img = await createImageBitmap(blob);
  const draw = (width, height) => {
    const canvas = new OffscreenCanvas(Math.round(width), Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
  // 按屏幕的实际像素保存：再大也显示不出更多细节，却会让每个打开的标签页多占几十 MB 内存
  const scale = Math.max(screen.width / img.width, screen.height / img.height) * devicePixelRatio;
  if (scale < 1) blob = await draw(img.width * scale, img.height * scale).convertToBlob({ type: 'image/jpeg', quality: .9 });
  await file('readwrite', (s) => s.put(blob, 'wallpaper'));

  const px = draw(GRID_W, GRID_H).getContext('2d').getImageData(0, 0, GRID_W, GRID_H).data;
  let grid = '';
  for (let i = 0; i < px.length; i += 4) grid += Math.round((.2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2]) / 255 * 9);
  const small = await draw(64, 64 * img.height / img.width).convertToBlob({ type: 'image/jpeg', quality: .6 });
  const preview = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(small);
  });
  local.image = { preview, grid, ratio: img.width / img.height, credit };
  state.appearance.wallpaper = 'image';
  saveLocal('image');
  save();
  applyAppearance(true);
}

// ───────── 必应壁纸 ─────────
// 默认关闭。开启时才向浏览器申请访问 www.bing.com 的权限，关闭时归还。
// 请求不带账号信息与来源页面；地区参数固定，不读取系统设置。
const BING = 'https://www.bing.com';
const BING_ACCESS = { origins: [`${BING}/*`] };

async function bingFetch(path) {
  const url = new URL(path, BING);
  if (url.origin !== BING) throw new Error('非必应地址');
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`必应返回 ${res.status}`);
  return res;
}

/** 近期壁纸列表，每页 8 张；默认取两页（约两周）。 */
async function bingList(pages = [0, 7], count = 8) {
  const lists = await Promise.all(pages.map(async (idx) => (await (await bingFetch(`/HPImageArchive.aspx?format=js&idx=${idx}&n=${count}&mkt=zh-CN`)).json()).images));
  const seen = new Set();
  return lists.flat()
    .filter((i) => !seen.has(i.startdate) && seen.add(i.startdate))
    .map((i) => ({ base: i.urlbase, credit: `${i.title} · ${i.copyright}` }));
}

async function useBing(item) {
  const size = screen.width * devicePixelRatio > 1920 ? 'UHD' : '1920x1080';
  await setImage(await (await bingFetch(`${item.base}_${size}.jpg`)).blob(), item.credit);
}

/** 「每日自动」：每天最多联网一次；失败后一小时内不重试。 */
export async function dailyBing(force = false) {
  if (state.appearance.bing !== 'daily') return;
  if (!force && (local.bingDay === today() || Date.now() - local.bingTry < 36e5)) return;
  if (!await chrome.permissions.contains(BING_ACCESS)) { state.appearance.bing = 'off'; save(); return; } // 例如从备份恢复到新设备
  local.bingTry = Date.now();
  saveLocal('bingTry');
  try {
    await useBing((await bingList([0], 1))[0]);
    local.bingDay = today();
    local.bingTry = 0;
    saveLocal('bingDay', 'bingTry');
  } catch { /* 沿用现有壁纸 */ }
}

// ───────── 面板 ─────────
const BING_NOTES = {
  off: '关闭时，不会与必应产生任何连接。',
  manual: '只有点击「浏览近期壁纸」时才连接必应。连接不带账号信息，图片下载后保存在本机。',
  daily: '每天第一次打开时连接必应一次，换成当天的壁纸。连接不带账号信息，图片保存在本机。',
};

export function openAppearance() {
  const a = state.appearance;
  const box = h('div', { class: 'stack' });
  let gallery = null; // null 未载入 | 'loading' | 'error' | 壁纸数组
  const percent = (v) => `${Math.round(v * 100)}%`;

  /** 选了具体的壁纸，就不再让「每日自动」覆盖它。 */
  const pin = () => { if (a.bing === 'daily') a.bing = 'manual'; };
  const apply = (final) => { applyAppearance(); save(); if (final) draw(); };
  const choose = (id) => { if (a.wallpaper === id) return; a.wallpaper = id; pin(); apply(true); };

  async function setBing() {
    if (a.bing === 'off') chrome.permissions.remove(BING_ACCESS);
    else if (!await chrome.permissions.request(BING_ACCESS)) { a.bing = 'off'; toast('没有获得连接必应的权限'); }
    save();
    draw();
    if (a.bing === 'daily') { await dailyBing(true); draw(); }
  }

  async function loadGallery() {
    gallery = 'loading';
    draw();
    try {
      if (!await chrome.permissions.request(BING_ACCESS)) throw new Error('未授权');
      const items = await bingList();
      await Promise.all(items.map(async (item) => {
        item.thumb = URL.createObjectURL(await (await bingFetch(`${item.base}_320x180.jpg`)).blob());
      }));
      gallery = items;
    } catch { gallery = 'error'; }
    draw();
  }

  function galleryNode() {
    if (gallery === 'loading') return h('p', { class: 'note', text: '正在载入…' });
    if (!Array.isArray(gallery)) {
      return h('button', { class: 'btn', text: gallery ? '无法连接必应，点击重试' : '浏览近期壁纸', onclick: loadGallery });
    }
    return h('div', { class: 'gallery' }, gallery.map((item) => h('button', {
      class: `swatch${usesImage() && local.image.credit === item.credit ? ' on' : ''}`,
      title: item.credit,
      onclick: async (e) => {
        e.currentTarget.classList.add('busy');
        try { await useBing(item); pin(); save(); } catch { toast('下载失败，请稍后再试'); }
        draw();
      },
    }, h('img', { src: item.thumb, alt: '' }))));
  }

  function draw() {
    const image = usesImage();
    const swatch = (label, on, props, onclick) => h('button', { class: `swatch${on ? ' on' : ''}`, title: label, onclick, ...props });
    box.replaceChildren(...[
      control(a, { key: 'theme', label: '主题', options: [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']] }, apply),
      h('div', { class: 'swatches' },
        PRESETS.map(([id, name]) => swatch(name, !image && document.documentElement.dataset.wall === id, { 'data-wall': id }, () => choose(id))),
        local.image && swatch(local.image.credit ? '必应壁纸' : '我的图片', image, { style: `background-image: url("${local.image.preview}")` }, () => choose('image')),
        swatch('选择图片', false, { text: '＋' }, async () => {
          const picked = await pickFile('image/*');
          if (!picked) return;
          try { await setImage(picked); pin(); save(); } catch { toast('无法读取这张图片'); }
          draw();
        })),
      image && control(a, { key: 'dim', label: '暗化', min: 0, max: .7, step: .01, format: percent }, apply),
      image && control(a, { key: 'blur', label: '模糊', min: 0, max: 40 }, apply),
      image && local.image.credit && h('p', { class: 'note', text: local.image.credit }),
      h('hr'),
      control(a, { key: 'bing', label: '必应壁纸', options: [['off', '关闭'], ['manual', '手动'], ['daily', '每日自动']] }, setBing),
      h('p', { class: 'note', text: BING_NOTES[a.bing] }),
      a.bing !== 'off' && galleryNode(),
    ].filter(Boolean));
  }

  draw();
  sheet({
    title: '外观',
    body: [box],
    actions: [{ label: '完成', primary: true }],
    onClose: () => { if (Array.isArray(gallery)) for (const item of gallery) URL.revokeObjectURL(item.thumb); },
  });
}
