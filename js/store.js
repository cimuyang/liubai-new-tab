// 数据。
// state：你的内容与设置，结构与备份文件完全一致。
// local：只属于这台设备、可重建的数据（图标与天气缓存、当前分组等），不进入备份。
// localStorage 供首帧同步读取，chrome.storage.local 保存持久副本和每日自动备份。

import { normalizeUrl, today } from './dom.js';

const KEY = 'liubai';
const LOCAL = 'liubai-local';
const BACKUPS = 'liubai-backups';
const BACKUP_DAYS = 7;

/** 各组件的默认布局。x / y 是窗口比例（0–1），scale 是相对默认尺寸的倍数。 */
export const defaultLayout = () => ({
  clock: { visible: true, x: .5, y: .17, scale: 1, hour24: true, seconds: false, weight: 300 },
  date: { visible: true, x: .5, y: .275, scale: 1, format: 'long', lunar: false },
  search: { visible: true, x: .5, y: .375, scale: 1, width: 30 },
  weather: { visible: false, x: .91, y: .08, scale: 1, city: null, unit: 'C', range: true },
  links: { visible: true, x: .5, y: .465, scale: 1, columns: 8, align: 'left', gap: 1.3, radius: 26, icon: 0, labels: true, newTab: false },
  tabs: { visible: true, x: .5, y: .93, scale: 1 },
});

const list = (v) => (Array.isArray(v) ? v : []);

/** 把任意来源的数据（存储、备份文件）整理成完整、安全的 state。 */
export function normalize(raw) {
  let src = raw && typeof raw === 'object' ? raw : {};
  if (src.blocks) src = fromV1(src);
  const pick = (defaults, from) => Object.fromEntries(Object.keys(defaults).map((key) => [key, from?.[key] ?? defaults[key]])); // 只保留已知字段
  const base = defaultLayout();
  const layout = (l) => pick(base, Object.fromEntries(Object.keys(base).map((id) => [id, pick(base[id], l?.[id])])));
  const groups = list(src.groups).filter((g) => g && typeof g === 'object').map((g) => ({
    name: String(g.name || '未命名'),
    links: list(g.links)
      .map((l) => ({ name: String(l?.name || ''), url: typeof l?.url === 'string' && normalizeUrl(l.url), ...(l?.icon ? { icon: String(l.icon) } : {}) }))
      .filter((l) => l.url),
  }));
  return {
    version: 2,
    appearance: pick({ theme: 'auto', wallpaper: 'mist', dim: .15, blur: 0, bing: 'off' }, src.appearance),
    layout: layout(src.layout),
    layouts: list(src.layouts).filter((s) => s?.name).map((s) => ({ name: String(s.name), layout: layout(s.layout) })),
    groups: groups.length ? groups : [{ name: '常用', links: [] }],
  };
}

/** 1.0 版数据 → 当前结构（一次性迁移）。 */
function fromV1(old) {
  const layout = (blocks) => Object.fromEntries(Object.entries(blocks || {}).map(([id, b]) => [id, {
    ...b, visible: b.on, scale: b.s,
    ...(id === 'clock' && { hour24: b.h24 }),
    ...(id === 'search' && { width: b.w }),
    ...(id === 'links' && { columns: b.cols, newTab: b.newtab }),
  }]));
  const icon = (i) => (i?.type === 'custom' ? i.data : i?.type === 'letter' ? 'letter' : '');
  return {
    appearance: { theme: old.theme, wallpaper: old.wallpaper?.type === 'image' ? 'image' : 'mist', dim: old.wallpaper?.dim, blur: old.wallpaper?.blur },
    layout: layout(old.blocks),
    layouts: list(old.snapshots).map((s) => ({ name: s.name, layout: layout(s.blocks) })),
    groups: list(old.groups).map((g) => ({
      name: g.name,
      links: list(old.links).filter((l) => l.group === g.id).map((l) => ({ name: l.name, url: l.url, icon: icon(l.icon) })),
    })),
  };
}

export let state = null;
export const local = { active: 0, icons: {}, weather: null, image: null, bingDay: '', bingTry: 0, hinted: false };

const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const listeners = [];
let timer = null;

export async function load() {
  const raw = read(KEY) ?? (await chrome.storage.local.get(KEY))[KEY];
  state = normalize(raw);
  Object.assign(local, read(LOCAL));
  if (raw?.blocks) { // 清理 1.0 版留下的键
    local.active = Math.max(0, list(raw.groups).findIndex((g) => g.id === raw.active));
    localStorage.removeItem('liubai-boot');
    localStorage.removeItem('liubai-icons');
    chrome.storage.local.remove('liubai-icons');
    flush();
    saveLocal('active');
  }
}

export function replaceState(next) {
  state = normalize(next);
  flush();
}

export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 120);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  // 超出配额时移除同步副本，下次启动改读持久副本，避免读到旧数据
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { localStorage.removeItem(KEY); }
  chrome.storage.local.set({ [KEY]: state });
}

/** 只写入指定的键：同时开着多个标签页时，不会用自己内存里的旧值盖掉别的页面刚写入的数据。 */
export function saveLocal(...keys) {
  const stored = read(LOCAL) || {};
  for (const key of keys) stored[key] = local[key];
  try { localStorage.setItem(LOCAL, JSON.stringify(stored)); } catch { localStorage.removeItem(LOCAL); }
}

/** 其他标签页修改了数据时回调。 */
export function onExternalChange(fn) { listeners.push(fn); }

addEventListener('storage', (e) => {
  if ((e.key !== KEY && e.key !== LOCAL) || !e.newValue) return;
  const { active, ...shared } = read(LOCAL) || {}; // 当前所在的分组，各标签页互不影响
  const image = local.image?.preview;
  Object.assign(local, shared);
  if (e.key === KEY) state = normalize(read(KEY));
  else if (shared.image?.preview === image) return; // 只是缓存有更新，无需重绘
  for (const fn of listeners) fn();
});
addEventListener('pagehide', () => { if (timer) flush(); });

/** 每天第一次打开时保存一份 state，保留最近 7 天。 */
export async function autoBackup() {
  const all = await listBackups();
  if (all[today()]) return;
  all[today()] = state;
  for (const day of Object.keys(all).sort().slice(0, -BACKUP_DAYS)) delete all[day];
  await chrome.storage.local.set({ [BACKUPS]: all });
}

export const listBackups = async () => (await chrome.storage.local.get(BACKUPS))[BACKUPS] || {};
