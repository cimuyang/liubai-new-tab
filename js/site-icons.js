// 只由用户触发。每次运行仅访问明确授权的网站及其声明的图标来源。
import { describeIcon } from './icon-image.js';
import { iconQuality } from './icons.js';
import { state } from './store.js';

const MAX_ICON_BYTES = 1_250_000;
const text = new TextDecoder();

function publicUrl(value, base) {
  try {
    const url = new URL(value, base);
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || host.endsWith('.')
      || !host.includes('.') || /^[\d.]+$/.test(host)
      || /\.(?:localhost|local|lan|home|internal|intranet|onion)$/i.test(host)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function siteOf(value) {
  const url = publicUrl(value);
  return url && new URL('/', url);
}

export function canUseIconService(value) {
  const host = siteOf(value)?.hostname;
  return !!host && !/\.(?:test|example|invalid|corp|home\.arpa)$/i.test(host);
}

export const canFetchSiteIcon = (url) => !!siteOf(url);

async function read(url, max, signal, truncate = false) {
  try {
    const response = await fetch(url, {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal,
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (size < max) {
        const { value, done } = await reader.read();
        if (done) return new Blob(chunks, { type: response.headers.get('content-type') || '' });
        const remaining = max - size;
        if (value.length > remaining && !truncate) return null;
        chunks.push(value.subarray(0, remaining));
        size += value.length;
      }
      return truncate ? new Blob(chunks, { type: response.headers.get('content-type') || '' }) : null;
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch {
    return null;
  }
}

function sizeHint(sizes) {
  if (typeof sizes !== 'string') return 48;
  if (/\bany\b/i.test(sizes)) return 256;
  const values = [...sizes.matchAll(/(\d+)x(\d+)/gi)].map(([, w, h]) => Math.min(+w, +h));
  return Math.min(512, Math.max(0, ...values) || 48);
}

async function candidates(site, origins, pending, signal) {
  const icons = new Map();
  const asset = (value, base) => {
    const url = publicUrl(value, base);
    if (!url) return null;
    if (origins.has(url.origin)) return url;
    if (pending.size < 4) pending.add(url.origin);
    return null;
  };
  const add = (url, base, sizes) => {
    if (typeof url !== 'string' || !url.trim() || icons.size >= 48) return;
    const icon = asset(url, base);
    if (icon) icons.set(icon.href, Math.max(icons.get(icon.href) || 0, /\.svg$/i.test(icon.pathname) ? 512 : sizeHint(sizes)));
  };
  const page = await read(site, 512 * 1024, AbortSignal.any([signal, AbortSignal.timeout(4000)]), true);
  if (page) {
    // template 的内容不会运行脚本、加载图片，也不会进入当前页面。
    const template = document.createElement('template');
    template.innerHTML = await page.text();
    const declaredBase = template.content.querySelector('base[href]')?.getAttribute('href');
    const base = (declaredBase && publicUrl(declaredBase, site)) || site;
    let manifest;
    for (const link of template.content.querySelectorAll('link[href][rel]')) {
      const rel = link.rel.toLowerCase().split(/\s+/);
      const href = link.getAttribute('href');
      if (rel.some((type) => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'].includes(type))) {
        add(href, base, link.getAttribute('sizes'));
      }
      if (!manifest && rel.includes('manifest')) manifest = asset(href, base);
    }
    if (manifest) {
      try {
        const body = await read(manifest, 128 * 1024, AbortSignal.any([signal, AbortSignal.timeout(2500)]));
        if (!body) throw new Error('未读到网站清单');
        const { icons: listed } = JSON.parse(await body.text());
        if (Array.isArray(listed)) {
          for (const icon of listed.slice(0, 40)) {
            if (!icon?.purpose || icon.purpose !== 'monochrome') add(icon?.src, manifest, icon?.sizes);
          }
        }
      } catch { /* 仍可尝试站点声明的图标和常见路径 */ }
    }
  }
  const best = [...icons].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([url]) => url);
  return [...new Set([...best, new URL('/apple-touch-icon.png', site).href, new URL('/favicon.ico', site).href])];
}

async function readIcon(url, signal) {
  let body = await read(url, MAX_ICON_BYTES, AbortSignal.any([signal, AbortSignal.timeout(3500)]));
  if (!body) return null;
  const header = new Uint8Array(await body.slice(0, 1024).arrayBuffer());
  if (header[0] === 0 && header[1] === 0 && header[2] === 1 && header[3] === 0) {
    body = await largestIcoFrame(body);
    if (!body) return null;
  } else if (/<svg(?:\s|>)/i.test(text.decode(header)) && !/<html(?:\s|>)/i.test(text.decode(header))) {
    body = body.slice(0, body.size, 'image/svg+xml');
  } else if (/^image\/(?:png|jpeg|gif|webp|avif)(?:;|$)/i.test(body.type)) {
    body = body.slice(0, body.size, body.type.split(';')[0]);
  } else if (header[0] === 137 && text.decode(header.slice(1, 4)) === 'PNG') {
    body = body.slice(0, body.size, 'image/png');
  } else {
    return null;
  }
  return describeIcon(body);
}

// ICO files can contain several independent images. Decode the largest frame explicitly.
async function largestIcoFrame(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 6) return null;
  const count = Math.min(view.getUint16(4, true), Math.floor((buffer.byteLength - 6) / 16));
  let best;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const edge = Math.min(view.getUint8(entry) || 256, view.getUint8(entry + 1) || 256);
    const size = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (size && offset >= 6 + count * 16 && offset + size <= buffer.byteLength && (!best || edge > best.edge)) {
      best = { entry, edge, size, offset };
    }
  }
  if (!best) return null;
  const frame = buffer.slice(best.offset, best.offset + best.size);
  if (new Uint8Array(frame).slice(0, 4).join() === '137,80,78,71') return new Blob([frame], { type: 'image/png' });
  const header = new Uint8Array(22);
  header.set(new Uint8Array(buffer, 0, 6));
  header[4] = 1;
  header[5] = 0;
  header.set(new Uint8Array(buffer, best.entry, 16), 6);
  new DataView(header.buffer).setUint32(18, header.length, true);
  return new Blob([header, frame], { type: 'image/x-icon' });
}

async function fetchCandidates(site, origins, cancelled) {
  const pending = new Set();
  const signal = AbortSignal.any([cancelled, AbortSignal.timeout(12_000)]);
  const urls = await candidates(site, origins, pending, signal);
  const icons = [];
  for (let i = 0; i < urls.length && !signal.aborted; i += 3) {
    const results = await Promise.all(urls.slice(i, i + 3).map((url) => readIcon(url, signal).catch(() => null)));
    for (const icon of results) {
      if (icon && !icons.some((entry) => entry.data === icon.data)) icons.push(icon);
    }
  }
  icons.sort((a, b) => iconQuality(b) - iconQuality(a));
  return { icons: icons.slice(0, 4), origins: [...pending] };
}

let running = false;
export async function fetchSiteIcons(values, cancelled, extraOrigins = [], source = 'site', progress) {
  if (running) return { status: 'busy' };
  const service = source === 'service';
  const eligible = service ? values.filter(canUseIconService) : values;
  const sites = [...new Map(eligible.map(siteOf).filter(Boolean).map((site) => [site.origin, site])).values()];
  if (!sites.length) return { status: 'unsupported' };
  const verified = extraOrigins.filter((origin) => publicUrl(origin)?.origin === origin);
  const origins = new Set(service ? ['https://icon.horse'] : [...sites.map((site) => site.origin), ...verified]);
  const patterns = [...origins].map((origin) => origin + '/*');
  const access = { origins: patterns };
  const existing = patterns.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => true));
  running = true;
  let granted = false;
  try {
    granted = await chrome.permissions.request(access);
    if (!granted) return { status: 'denied' };
    const results = new Map();
    for (let i = 0; i < sites.length && !cancelled.aborted; i += 3) {
      await Promise.all(sites.slice(i, i + 3).map(async (site) => {
        let result;
        try {
          if (service) {
            const url = new URL('/icon/' + encodeURIComponent(site.hostname), 'https://icon.horse');
            const icon = await readIcon(url, cancelled);
            result = { icons: icon && icon.size >= 64 ? [icon] : [], origins: [] };
          } else result = await fetchCandidates(site, origins, cancelled);
        } catch {
          result = { icons: [], origins: [] };
        }
        results.set(site.origin, result);
        progress?.(results.size, sites.length);
      }));
    }
    return cancelled.aborted ? { status: 'cancelled' } : { status: 'done', results };
  } catch {
    return { status: 'failed' };
  } finally {
    if (granted) {
      const before = await Promise.all(existing);
      const temporary = patterns.filter((origin, i) => !before[i]
        && !(origin === 'https://www.bing.com/*' && state.appearance.bing !== 'off'));
      if (temporary.length) await chrome.permissions.remove({ origins: temporary }).catch(() => {});
    }
    running = false;
  }
}

export function siteResult(result, value) {
  return result.results?.get(siteOf(value)?.origin);
}
