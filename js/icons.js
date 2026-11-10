// 网站图标：只读取浏览器在你访问网站时存下的本地图标，自身不发出任何网络请求。
// 读到的图标连同主色存入本机缓存，之后每次打开都同步可用，切换分组不会重新加载。

import { h, hostOf } from './dom.js';
import { local, saveLocal } from './store.js';

const FRESH = 14 * 864e5; // 已有图标每两周刷新一次
const RETRY = 6e5; // 浏览器里还没有的图标，十分钟后再查

const letterOf = (link) => [...(link.name || hostOf(link.url) || '?').trim()][0].toUpperCase();

/** 图标节点：自定义图片 → 本地缓存的网站图标（底色取其主色） → 首字母。 */
export function iconNode(link, cls = 'tile-icon') {
  const box = h('span', { class: cls });
  const hit = !link.icon && local.icons[hostOf(link.url)];
  if (link.icon?.startsWith('data:image/')) {
    box.append(h('img', { class: 'full', src: link.icon, alt: '' }));
  } else if (hit?.d) {
    box.append(h('img', { src: hit.d, alt: '' }));
    box.classList.add('tint');
    box.style.setProperty('--tint', hit.c);
    box.style.setProperty('--n', hit.w);
  } else {
    box.append(h('span', { class: 'letter', text: letterOf(link) }));
  }
  return box;
}

async function favicon(pageUrl) {
  try {
    const res = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch { return null; }
}

/** 图标字节 → { d: data URL, w: 像素宽度, c: 主色 }。主色按饱和度加权，忽略透明像素。 */
async function describe(bytes) {
  const blob = new Blob([bytes], { type: 'image/png' });
  const img = await createImageBitmap(blob);
  const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const sum = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = px.subarray(i, i + 4);
    const weight = a * (Math.max(r, g, b) - Math.min(r, g, b) + 16);
    sum[0] += r * weight; sum[1] += g * weight; sum[2] += b * weight;
    total += weight;
  }
  const d = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  return { d, w: img.width, c: total ? sum.map((v) => Math.round(v / total)).join(' ') : '128 128 128' };
}

/**
 * 为缺少图标（或图标已过期）的链接读取浏览器的本地图标，并清除已不再使用的缓存。
 * 浏览器对没访问过的网站返回通用占位图，这里通过字节比对将其排除。
 * @returns 图标有更新的主机名
 */
export async function refreshIcons(links) {
  const now = Date.now();
  const hosts = new Map();
  for (const link of links) {
    if (!link.icon && /^https?:/.test(link.url)) hosts.set(hostOf(link.url), link.url);
  }
  let dirty = false;
  for (const host of Object.keys(local.icons)) {
    if (!hosts.has(host)) { delete local.icons[host]; dirty = true; }
  }
  const due = [...hosts].filter(([host]) => {
    const hit = local.icons[host];
    return !hit || now - hit.t > (hit.d ? FRESH : RETRY);
  });
  const blank = due.length && await favicon('https://never-visited.liubai.invalid/');
  const changed = [];
  if (blank) {
    for (const [host, url] of due) {
      let found = null;
      for (const page of new Set([url, `${new URL(url).origin}/`])) {
        const bytes = await favicon(page);
        if (!bytes || (bytes.length === blank.length && bytes.every((v, i) => v === blank[i]))) continue;
        found = await describe(bytes);
        break;
      }
      if (found) changed.push(host);
      local.icons[host] = { ...(found ?? local.icons[host] ?? { d: '' }), t: now }; // 查不到时保留旧图标
      dirty = true;
    }
  }
  if (dirty) saveLocal('icons');
  return changed;
}
