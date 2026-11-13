// 自动图标读浏览器的本地缓存。联网取图只能从链接编辑窗口发起。
import { emit, h, hostOf, initials, shortText } from './dom.js';
import { rgb, textColor } from './color.js';
import { clearLegacyLocal, isIconImage, legacyIcons } from './store.js';
import { transaction } from './db.js';
import { describeIcon } from './icon-image.js';

const FRESH = 14 * 86_400_000;
const RETRY = 60_000;
const MAX_ENTRIES = 512;
const cache = new Map();
const defaultIcons = new Map();
const pending = new Map();
const queue = [];
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('liubai-icons') : null;
let running = 0;
let writes = 0;

const db = (mode, run) => transaction('liubai-icons', 'icons', mode, run, 't');

export function iconKey(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.hash = url.username = url.password = '';
    return url.href;
  } catch {
    return '';
  }
}

function oldIcon(url) {
  const hit = legacyIcons?.[hostOf(url)];
  if (!isIconImage(hit?.d)) return null;
  const tint = /^\d{1,3} \d{1,3} \d{1,3}$/.test(hit.c) ? hit.c : '128 128 128';
  const ink = tint.split(' ').map((v) => Math.min(255, Number(v)));
  const target = textColor(...ink) === '#fff' ? 255 : 0;
  const fill = ink.map((v) => Math.round(v * .25 + target * .75)).join(' ');
  return { data: hit.d, tint, fill, size: 32, source: 'legacy', t: 0 };
}

export function automaticIcon(url) {
  const hit = cache.get(iconKey(url));
  return hit?.data ? hit : oldIcon(url);
}

const fallbackColors = ['#3960a1', '#296c60', '#8b4a72', '#76512c', '#494d8c', '#3c647e'];

function fallbackColor(link) {
  const label = hostOf(link.url) || link.name || '?';
  let value = 0;
  for (const char of label) value = (value * 31 + char.codePointAt(0)) >>> 0;
  return fallbackColors[value % fallbackColors.length];
}

export function iconNode(link, cls = 'tile-icon') {
  const box = h('span', { class: cls, 'aria-hidden': 'true' });
  const image = link.icon?.startsWith('data:image/') ? link.icon : '';
  const hit = !link.icon ? automaticIcon(link.url) : null;
  const text = shortText(link.iconText) || initials(link.name, link.url);

  function showText() {
    const background = link.iconBg || fallbackColor(link);
    box.classList.remove('tint');
    box.classList.add('text-tile');
    box.classList.toggle('custom-bg', !!link.iconBg);
    box.style.setProperty('--fill', background);
    box.style.setProperty('--on-fill', textColor(...rgb(background)));
    if (link.iconFg) box.style.setProperty('--text-ink', link.iconFg);
    if (shortText(text, 1) !== text) box.classList.add(shortText(text, 2) === text ? 'two-chars' : 'short-word');
    box.replaceChildren(h('span', { class: 'letter', text }));
  }

  if (image || hit?.data) {
    const img = h('img', { src: image || hit.data, alt: '', decoding: 'async' });
    if (image) {
      img.className = link.iconFit === 'contain' ? 'contained' : 'full';
      if (link.iconFill) {
        box.classList.add('image-fill');
        box.style.setProperty('--fill', link.iconFill);
      }
    } else {
      box.classList.add('tint');
      box.style.setProperty('--tint', hit.tint);
      box.style.setProperty('--fill', `rgb(${hit.fill})`);
      box.style.setProperty('--native', hit.size);
      box.classList.toggle('full-bleed', !!hit.fullBleed);
    }
    if (link.iconBg) {
      box.classList.add('custom-bg');
      box.style.setProperty('--fill', link.iconBg);
    }
    img.addEventListener('error', showText, { once: true });
    box.append(img);
  } else {
    showText();
  }
  return box;
}

function remember(key, hit) {
  const previous = automaticIcon(key)?.data;
  cache.delete(key);
  cache.set(key, hit);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  if (automaticIcon(key)?.data !== previous) emit('icon', key);
}

async function readCache(keys) {
  if (!keys.length) return;
  const reads = await db('readonly', (store) => keys.map((key) => store.get(key))).catch(() => null);
  keys.forEach((key, i) => {
    const hit = reads?.[i]?.result || oldIcon(key);
    if (hit && !cache.has(key)) remember(key, hit);
  });
}

channel?.addEventListener('message', async ({ data: key }) => {
  if (typeof key !== 'string') return;
  const request = await db('readonly', (store) => store.get(key)).catch(() => null);
  if (request?.result) remember(key, request.result);
});

function prune() {
  return db('readwrite', (store) => {
    let seen = 0;
    const cursor = store.index('t').openCursor(null, 'prev');
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      if (++seen > MAX_ENTRIES) cursor.result.delete();
      cursor.result.continue();
    };
  }).catch(() => {});
}

export async function migrateIcons(links) {
  if (!legacyIcons) return;
  const keys = [...new Set(links.map((link) => !link.icon && iconKey(link.url)).filter(Boolean))];
  try {
    await db('readwrite', (store) => {
      for (const key of keys.slice(0, MAX_ENTRIES)) {
        const hit = oldIcon(key);
        if (!hit) continue;
        const request = store.get(key);
        request.onsuccess = () => { if (!request.result?.data) store.put(hit, key); };
      }
    });
    clearLegacyLocal();
  } catch { /* 缓存不可用时仍可显示原图 */ }
}

export function iconQuality(icon) {
  if (!icon?.data) return 0;
  return icon.size + (icon.vector ? 64 : 0) + (icon.source === 'site' ? 4 : 0);
}

function bestOf(old, candidate, replace) {
  if (!old?.data) return candidate;
  if (!candidate?.data) return old;
  return (replace && candidate.size >= old.size || iconQuality(candidate) > iconQuality(old)) ? candidate : old;
}

async function keep(key, icon, source, requested, replace = false) {
  const t = Date.now();
  const candidate = icon ? { ...icon, source } : null;
  const record = (old) => ({ ...bestOf(old, candidate, replace), t, requested: Math.max(old?.requested || 0, requested) });
  let result = record(cache.get(key));
  try {
    await db('readwrite', (store) => {
      const request = store.get(key);
      request.onsuccess = () => {
        result = record(request.result || cache.get(key));
        store.put(result, key);
      };
    });
    remember(key, result);
    channel?.postMessage(key);
    if (++writes % 24 === 1) prune();
    return { cached: !!result.data, saved: true, used: result.data === icon?.data };
  } catch {
    remember(key, result);
    return { cached: !!result.data, saved: false, used: result.data === icon?.data };
  }
}

export function useSiteIcon(url, icon) {
  return keep(iconKey(url), icon, 'site', 0, true);
}

async function favicon(page, size) {
  try {
    const endpoint = new URL(chrome.runtime.getURL('/_favicon/'));
    endpoint.searchParams.set('pageUrl', page);
    endpoint.searchParams.set('size', size);
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function placeholder(size) {
  const key = size + ':' + matchMedia('(prefers-color-scheme: dark)').matches;
  if (!defaultIcons.has(key)) defaultIcons.set(key, favicon('https://liubai-no-favicon.invalid/', size));
  const bytes = await defaultIcons.get(key);
  if (!bytes) defaultIcons.delete(key);
  return bytes;
}

function pagesFor(key, known) {
  const url = new URL(key);
  const pages = new Set([key]);
  url.search = '';
  pages.add(url.href);
  pages.add(url.origin + '/');
  if (url.protocol === 'http:' && !url.port) {
    const secure = new URL(url);
    secure.protocol = 'https:';
    pages.add(secure.href);
    pages.add(secure.origin + '/');
  }
  for (const related of known.slice(0, 3)) pages.add(related);
  if (url.hostname.startsWith('www.') || /^[^.]+\.[^.]+$/.test(url.hostname) && !/^[\d.]+$/.test(url.hostname)) {
    url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : 'www.' + url.hostname;
    pages.add(url.href);
    pages.add(url.origin + '/');
  }
  return pages;
}

async function findIcon(key, size, known) {
  for (const n of new Set([size, 64, 32])) {
    const blank = await placeholder(n);
    let available = false;
    let best = null;
    for (const page of pagesFor(key, known)) {
      const bytes = await favicon(page, n);
      if (!bytes?.length) continue;
      available = true;
      if (blank && bytes.length === blank.length && bytes.every((v, i) => v === blank[i])) continue;
      const found = await describeIcon(new Blob([bytes], { type: 'image/png' }), true);
      if (found && iconQuality(found) > iconQuality(best)) best = found;
      if (best?.size >= Math.min(size, 128)) return best;
    }
    if (available) return best;
  }
  return null;
}

function next() {
  while (running < 4 && queue.length) {
    const { key, size, known, resolve, priority } = queue.shift();
    running++;
    findIcon(key, size, known).then((icon) => keep(key, icon, 'browser', size, priority)).then(resolve, () => resolve(null)).finally(() => {
      running--;
      pending.delete(key);
      next();
    });
  }
}

function request(key, size, known, priority) {
  if (pending.has(key)) return pending.get(key);
  const promise = new Promise((resolve) => {
    const task = { key, size, known, resolve, priority };
    if (priority) queue.unshift(task); else queue.push(task);
  });
  pending.set(key, promise);
  next();
  return promise;
}

export function primeIcons(links) {
  const keys = [...new Set(links.filter((link) => !link.icon)
    .map((link) => iconKey(link.url)).filter((key) => key && !cache.has(key)))];
  return readCache(keys.slice(0, MAX_ENTRIES));
}

export async function refreshIcons(links, { pixels = 64, force = false, revisit = false, knownLinks = links } = {}) {
  const keys = [...new Set(links.map((link) => !link.icon && iconKey(link.url)).filter(Boolean))];
  await readCache(keys.filter((key) => !cache.has(key)));
  if (!keys.length) return;
  const origins = new Map();
  for (const link of knownLinks) {
    const key = iconKey(link.url);
    if (!key) continue;
    const origin = new URL(key).origin;
    if (!origins.has(origin)) origins.set(origin, new Set());
    const pages = origins.get(origin);
    if (pages.size < 4) pages.add(key);
  }
  const size = pixels <= 64 ? 64 : pixels <= 128 ? 128 : 256;
  const now = Date.now();
  const jobs = [];
  for (const key of keys) {
    const hit = cache.get(key);
    if (!force && hit) {
      const sharp = hit.size >= Math.min(size, 128);
      if (hit.source === 'site' && sharp) continue;
      const wait = hit.data && sharp ? FRESH : revisit && !hit.data ? 0 : RETRY;
      if (hit.requested >= size && now - hit.t < wait) continue;
    }
    const related = [...(origins.get(new URL(key).origin) || [])].filter((page) => page !== key);
    jobs.push(request(key, size, related, force));
  }
  await Promise.all(jobs);
}
