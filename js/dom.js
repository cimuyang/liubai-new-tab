// 基础工具：DOM 构建、图标、事件总线、指针跟踪、网址与图片处理。

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD

/** 创建元素。props 支持 class / text / on<event> 以及任意属性。 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'text') el.textContent = val;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), val);
    else if (key in el) el[key] = val;
    else el.setAttribute(key, val);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

const CLOUD = 'M7 18.5a4.2 4.2 0 0 1-.6-8.36 5.6 5.6 0 0 1 10.9-.9A4.7 4.7 0 0 1 17.3 18.5Z';
const HIGH_CLOUD = `<path d="${CLOUD}" transform="translate(0 -3)"/>`;
const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2Z"/>',
  cloud: `<path d="${CLOUD}"/>`,
  partly: '<path d="M8 2.5V4M2.5 8H4M4.1 4.1l1.1 1.1M11.9 4.1l-1.1 1.1M5 9.4a3.2 3.2 0 0 1 5.8-2.7"/><path d="M9 19.5a3.6 3.6 0 0 1-.5-7.17 4.8 4.8 0 0 1 9.3-.77A4 4 0 0 1 17.8 19.5Z"/>',
  rain: `${HIGH_CLOUD}<path d="m8.5 18.5-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>`,
  snow: `${HIGH_CLOUD}<path d="M8 19.5h.01M12 21h.01M16 19.5h.01" stroke-width="2.4"/>`,
  thunder: `${HIGH_CLOUD}<path d="m12.8 16.2-2.2 3h3l-2.2 3"/>`,
  fog: '<path d="M5 9h14M3.5 13h17M6 17h12"/>',
};
const tpl = document.createElement('template');

/** 线性图标（内置，无外部资源）。 */
export function svg(name) {
  tpl.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstChild;
}

// 模块间通信，避免循环依赖
const bus = new EventTarget();
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

/** 跟踪一次按下之后的指针移动，直到松开。 */
export function track(onMove, onEnd) {
  const end = (e) => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    onEnd?.(e);
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  return end;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const SAFE_SCHEMES = ['http:', 'https:', 'edge:', 'chrome:', 'file:', 'about:'];

/** 把输入整理成可用网址；不合法或不安全（如 javascript:）时返回 null。 */
export function normalizeUrl(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const candidates = /^([a-z][a-z0-9+.-]*:\/\/|(about|edge|chrome):)/i.test(text) ? [text] : [`https://${text}`];
  if (/^(localhost|127\.|192\.168\.|10\.)/i.test(text)) candidates.unshift(`http://${text}`);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (SAFE_SCHEMES.includes(url.protocol)) return url.href;
    } catch { /* 尝试下一个 */ }
  }
  return null;
}

/** 在当前标签页打开网址。edge:// 等内部页面不能用普通跳转打开，需交给浏览器。 */
export function openUrl(url) {
  if (/^https?:/.test(url)) location.href = url;
  else chrome.tabs.update({ url });
}

/** 弹出系统文件选择框。 */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** 把图片按 cover 方式绘制到指定尺寸的画布。 */
export function cover(img, width, height) {
  const canvas = h('canvas', { width, height });
  const scale = Math.max(width / img.width, height / img.height);
  const w = img.width * scale;
  const hgt = img.height * scale;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, (width - w) / 2, (height - hgt) / 2, w, hgt);
  return canvas;
}
