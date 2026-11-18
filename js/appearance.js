// 外观面板：主题、壁纸（预设 / 自己的图片 / 必应）。只在打开面板或「每日自动」时加载。

import { state, save, local, saveLocal } from './store.js';
import { h, pickFile, today } from './dom.js';
import { sheet, control, toast } from './ui.js';
import { PRESETS, imageGrid, usesImage, file, applyAppearance } from './wallpaper.js';

/** 设为壁纸：保存图片，并生成首帧占位图与亮度网格。图片只保存在本机。 */
export async function setImage(blob, credit = '', valid = () => true) {
  const img = await createImageBitmap(blob).catch(() => { throw new Error('无法解码这张图片，请选择其他图片'); });
  try {
    const draw = (width, height) => {
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    };
    const scale = Math.max(screen.width / img.width, screen.height / img.height) * devicePixelRatio;
    if (scale < 1) blob = await draw(img.width * scale, img.height * scale).convertToBlob({ type: 'image/jpeg', quality: .9 });
    const previewScale = Math.min(1, 640 / img.width, 960 / img.height);
    const small = await draw(img.width * previewScale, img.height * previewScale).convertToBlob({ type: 'image/jpeg', quality: .6 });
    const preview = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(small);
    });
    const key = 'wallpaper-' + crypto.randomUUID();
    const meta = { key, previewVersion: 2, preview, rgb: imageGrid(img), ratio: img.width / img.height, credit };
    return await navigator.locks.request('liubai-wallpaper', async () => {
      if (!valid()) return false;
      const previous = local.image?.key || 'wallpaper';
      await file('readwrite', store => store.put(blob, key));
      try {
        if (!valid()) return false;
        localStorage.setItem('liubai-device-image', JSON.stringify(meta));
        local.image = meta;
      } finally {
        if (local.image !== meta) await file('readwrite', store => store.delete(key));
      }
      state.appearance.wallpaper = 'image';
      save(true);
      applyAppearance(true);
      await file('readwrite', store => store.delete(previous)).catch(() => {});
      return true;
    }).catch(() => { throw new Error('无法保存壁纸，请检查本机存储空间后重试'); });
  } finally {
    img.close();
  }
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
  const revision = ++selectionRevision;
  const image = local.image, kind = state.appearance.wallpaper, mode = state.appearance.bing;
  const valid = () => revision === selectionRevision && local.image === image && state.appearance.wallpaper === kind && state.appearance.bing === mode;
  const size = screen.width * devicePixelRatio > 1920 ? 'UHD' : '1920x1080';
  const blob = await (await bingFetch(`${item.base}_${size}.jpg`)).blob();
  if (!valid()) return;
  return setImage(blob, item.credit, valid);
}

/** 「每日自动」：每天最多联网一次；失败后一小时内不重试。 */
export async function dailyBing(force = false) {
  if (state.appearance.bing !== 'daily') return;
  if (!force && (local.bingDay === today() || Date.now() - local.bingTry < 36e5)) return;
  const revision = selectionRevision;
  if (!await chrome.permissions.contains(BING_ACCESS)) { state.appearance.bing = 'off'; save(); return; } // 例如从备份恢复到新设备
  local.bingTry = Date.now();
  saveLocal('bingTry');
  try {
    const item = (await bingList([0], 1))[0];
    if (revision !== selectionRevision || state.appearance.bing !== 'daily') return;
    if (!await useBing(item)) return;
    local.bingDay = today();
    local.bingTry = 0;
    saveLocal('bingDay', 'bingTry');
  } catch (error) { if (force) toast(error.message || '暂时无法更新必应壁纸'); }
}

// ───────── 面板 ─────────
const BING_NOTES = {
  off: '关闭时，不会与必应产生任何连接。',
  manual: '只有点击「浏览近期壁纸」时才连接必应。连接不带账号信息，图片下载后保存在本机。',
  daily: '每天第一次打开时连接必应一次，换成当天的壁纸。连接不带账号信息，图片保存在本机。',
};

let selectionRevision = 0;

export function openAppearance() {
  const a = state.appearance;
  const box = h('div', { class: 'stack' });
  let closed = false;
  const thumbnails = new Set();
  let gallery = null; // null 未载入 | 'loading' | 'error' | 壁纸数组
  const percent = (v) => `${Math.round(v * 100)}%`;

  /** 选了具体的壁纸，就不再让「每日自动」覆盖它。 */
  const pin = () => { selectionRevision++; if (a.bing === 'daily') a.bing = 'manual'; };
  const apply = () => { applyAppearance(); save(); };
  const choose = (id) => { pin(); a.wallpaper = id; apply(); draw(); };

  async function setBing() {
    ++selectionRevision;
    if (a.bing === 'off') await chrome.permissions.remove(BING_ACCESS).catch(() => {});
    else if (!await chrome.permissions.request(BING_ACCESS).catch(() => false)) { a.bing = 'off'; toast('没有获得连接必应的权限'); }
    save();
    draw();
    if (a.bing === 'daily') { await dailyBing(true); draw(); }
  }

  async function loadGallery() {
    gallery = 'loading';
    draw();
    try {
      if (!await chrome.permissions.request(BING_ACCESS).catch(() => false)) throw new Error('未授权');
      const items = await bingList();
      if (closed || a.bing === 'off') return;
      gallery = items.length ? items : 'error';
      draw();
    } catch { gallery = 'error'; for (const url of thumbnails) URL.revokeObjectURL(url); thumbnails.clear(); }
    draw();
  }

  function galleryNode() {
    if (gallery === 'loading') return h('p', { class: 'note', text: '正在载入…' });
    if (!Array.isArray(gallery)) {
      return h('button', { class: 'btn', text: gallery ? '无法连接必应，点击重试' : '浏览近期壁纸', onclick: loadGallery });
    }
    return h('div', { class: 'gallery' }, gallery.map(item => {
      // Keep each tile while other thumbnails load, preserving hover and focus.
      if (item.tile) {
        item.tile.classList.toggle('on', usesImage() && local.image.credit === item.credit);
        return item.tile;
      }
      const tile = item.tile = h('button', { class: 'swatch busy', title: item.credit, disabled: true });
      const preview = async () => {
        tile.disabled = true;
        tile.classList.add('busy');
        try {
          const blob = await (await bingFetch(item.base + '_320x180.jpg')).blob();
          if (closed) return;
          item.thumb = URL.createObjectURL(blob);
          thumbnails.add(item.thumb);
          tile.replaceChildren(h('img', { src: item.thumb, alt: '' }));
        } catch { tile.textContent = '重试'; }
        finally { tile.disabled = false; tile.classList.remove('busy'); }
      };
      tile.onclick = async () => {
        if (!item.thumb) return preview();
        tile.classList.add('busy');
        try {
          if (await useBing(item)) { pin(); save(); }
        } catch (error) { toast(error.message || '壁纸下载失败'); }
        finally { tile.classList.remove('busy'); draw(); }
      };
      preview();
      return tile;
    }));

  }

  function draw() {
    if (closed) return;
    const image = usesImage();
    const swatch = (label, on, props, onclick) => h('button', { class: `swatch${on ? ' on' : ''}`, title: label, onclick, ...props });
    box.replaceChildren(...[
      control(a, { key: 'theme', label: '主题', options: [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']] }, apply),
      control(a, { key: 'ink', label: '页面字色', options: [['auto', '自动'], ['light', '浅色'], ['dark', '深色'], ['custom', '自定义']] }, () => { apply(); draw(); }),
      a.ink === 'custom' && h('label', { class: 'row icon-color' }, h('span', { class: 'row-label', text: '自定义字色' }),
        h('input', { type: 'color', value: a.inkColor, oninput: (e) => { a.inkColor = e.target.value; apply(false); } })),
      control(a, { key: 'inkShadow', label: '文字阴影' }, apply),
      h('div', { class: 'swatches' },
        PRESETS.map(([id, name]) => swatch(name, !image && document.documentElement.dataset.wall === id, { 'data-wall': id }, () => choose(id))),
        local.image && swatch(local.image.credit ? '必应壁纸' : '我的图片', image, { style: `background-image: url("${local.image.preview}")` }, () => choose('image')),
        swatch('选择图片', false, { text: '＋' }, async () => {
          const picked = await pickFile('image/*');
          if (!picked) return;
          try {
            const revision = ++selectionRevision;
            if (await setImage(picked, '', () => revision === selectionRevision)) { pin(); save(); }
          } catch (error) { toast(error.message || '无法设置壁纸'); }
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
    onClose: () => { closed = true; for (const url of thumbnails) URL.revokeObjectURL(url); thumbnails.clear(); },
  });
}
