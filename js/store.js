// 用户设置由扩展存储统一持久化。首帧只同步读取少量外观信息。
import { clamp, emit, initials, normalizeUrl, shortText, today } from './dom.js';
import { transaction } from './db.js';
import { validSlot } from './link-positions.js';

const KEY = 'liubai';
const LEGACY_LOCAL = 'liubai-local';
const DEVICE = 'liubai-device-';
const BACKUPS = 'liubai-backups';
export const DATA_VERSION = 4;

export const defaultLayout = () => ({
  clock: { visible: true, x: .5, y: .17, scale: 1, hour24: true, seconds: false, weight: 200 },
  date: { visible: true, x: .5, y: .275, scale: 1, format: 'long', lunar: false },
  search: { visible: true, x: .5, y: .375, scale: 1, width: 30 },
  weather: { visible: false, x: .91, y: .08, scale: 1, city: null, unit: 'C', range: true },
  links: {
    visible: true, x: .5, y: .465, scale: 1, columns: 8, align: 'center', gap: 1.3, radius: 26,
    arrangement: 'auto', icon: 0, labels: true, newTab: false, iconBackground: 'solid', labelColor: 'auto',
  },
  tabs: { visible: true, x: .5, y: .93, scale: 1, wheel: true },
});

const list = (v) => Array.isArray(v) ? v : [];
const string = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const choice = (v, options, fallback) => options.includes(v) ? v : fallback;
const number = (v, min, max, fallback) => Number.isFinite(v) ? clamp(v, min, max) : fallback;
const color = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
export const isIconImage = (v) => typeof v === 'string' && v.length <= 700_000
  && /^data:image\/(?:png|webp|jpeg|gif|avif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/]+={0,2}$/i.test(v);

export function normalizeLink(value) {
  const url = typeof value?.url === 'string' && value.url.length <= 8192 && normalizeUrl(value.url);
  if (!url) return null;
  const name = string(value.name, 256);
  const oldLetter = value.icon === 'letter';
  const icon = oldLetter || value.icon === 'text' ? 'text' : isIconImage(value.icon) ? value.icon : '';
  const text = shortText(value.iconText) || (oldLetter ? initials(name, url) : '');
  const bg = color(value.iconBg);
  const fg = color(value.iconFg);
  const fill = icon.startsWith('data:') && color(value.iconFill);
  return {
    name, url,
    ...(validSlot(value.slot) && { slot: value.slot }),
    ...(icon && { icon }),
    ...(text && { iconText: text }),
    ...(bg && { iconBg: bg }),
    ...(fg && { iconFg: fg }),
    ...(fill && { iconFill: fill }),
    ...(icon.startsWith('data:') && value.iconFit === 'contain' && { iconFit: 'contain' }),
  };
}

function normalizeLayout(raw) {
  const result = defaultLayout();
  for (const [id, block] of Object.entries(result)) {
    const source = raw?.[id];
    for (const key of Object.keys(block)) {
      if (typeof block[key] === 'boolean' && typeof source?.[key] === 'boolean') block[key] = source[key];
    }
    block.x = number(source?.x, 0, 1, block.x);
    block.y = number(source?.y, 0, 1, block.y);
    block.scale = number(source?.scale, .4, 3, block.scale);
  }
  result.clock.weight = choice(raw?.clock?.weight, [200, 300, 400, 500, 600, 700], result.clock.weight);
  result.clock.weight = result.clock.weight <= 300 ? 200 : result.clock.weight <= 500 ? 400 : 600;
  result.date.format = choice(raw?.date?.format, ['long', 'full', 'short'], 'long');
  result.search.width = number(raw?.search?.width, 16, 60, 30);
  result.weather.unit = choice(raw?.weather?.unit, ['C', 'F'], 'C');
  const city = raw?.weather?.city;
  if (string(city?.name, 64) && Math.abs(city.lat) <= 90 && Math.abs(city.lon) <= 180
    && Number.isFinite(city.lat) && Number.isFinite(city.lon)) {
    result.weather.city = { name: string(city.name, 64), lat: Math.round(city.lat * 10) / 10, lon: Math.round(city.lon * 10) / 10 };
  }
  const links = raw?.links;
  Object.assign(result.links, {
    arrangement: choice(links?.arrangement, ['auto', 'fixed'], 'auto'),
    columns: Math.round(number(links?.columns, 2, 14, 8)),
    align: choice(links?.align, ['left', 'center', 'right'], result.links.align),
    gap: number(links?.gap, .4, 4, 1.3),
    radius: number(links?.radius, 0, 50, 26),
    icon: links?.icon ? number(links.icon, .2, .9, 0) : 0,
    iconBackground: choice(links?.iconBackground, ['glass', 'solid'], result.links.iconBackground),
    labelColor: choice(links?.labelColor, ['auto', 'light', 'dark'], 'auto'),
  });
  return result;
}

export function normalize(raw) {
  const src = raw?.blocks ? fromV1(raw) : raw;
  const a = src?.appearance;
  const groups = list(src?.groups).filter((group) => group && typeof group === 'object').map((group) => ({
    name: string(group.name, 64) || '未命名',
    links: list(group.links).map(normalizeLink).filter(Boolean),
  }));
  return {
    version: DATA_VERSION,
    appearance: {
      ink: choice(a?.ink, ['auto', 'light', 'dark', 'custom'], 'auto'),
      inkColor: color(a?.inkColor) || '#ffffff',
      inkShadow: a?.inkShadow !== false,
      theme: choice(a?.theme, ['auto', 'light', 'dark'], 'auto'),
      wallpaper: choice(a?.wallpaper, ['mist', 'dawn', 'sage', 'lilac', 'plain', 'image'], 'mist'),
      dim: number(a?.dim, 0, .7, .15),
      blur: number(a?.blur, 0, 40, 0),
      bing: choice(a?.bing, ['off', 'manual', 'daily'], 'off'),
    },
    layout: normalizeLayout(src?.layout),
    layouts: list(src?.layouts).filter((item) => string(item?.name, 64))
      .map((item) => ({ name: string(item.name, 64), layout: normalizeLayout(item.layout) })),
    groups: groups.length ? groups : [{ name: '常用', links: [] }],
  };
}

function fromV1(old) {
  const layout = (blocks) => Object.fromEntries(Object.entries(blocks || {}).map(([id, b]) => [id, {
    ...b, visible: b?.on, scale: b?.s,
    ...(id === 'clock' && { hour24: b?.h24 }),
    ...(id === 'search' && { width: b?.w }),
    ...(id === 'links' && { columns: b?.cols, newTab: b?.newtab }),
  }]));
  return {
    appearance: { theme: old.theme, wallpaper: old.wallpaper?.type === 'image' ? 'image' : 'mist', dim: old.wallpaper?.dim, blur: old.wallpaper?.blur },
    layout: layout(old.blocks),
    layouts: list(old.snapshots).filter(Boolean).map((s) => ({ name: s.name, layout: layout(s.blocks) })),
    groups: list(old.groups).filter(Boolean).map((g) => ({
      name: g.name,
      links: list(old.links).filter((l) => l && l.group === g.id).map((l) => ({
        name: l.name, url: l.url, icon: l.icon?.type === 'custom' ? l.icon.data : l.icon?.type === 'letter' ? 'letter' : '',
      })),
    })),
  };
}

export let state;
export let legacyIcons;
export let recoveryDraft;
export const local = { active: 0, weather: null, image: null, bingDay: '', bingTry: 0, hinted: false };
const listeners = [];
let baseline;
let timer;
let writing;
let replacing = false;
let pending = false;
let syncNeeded = false;
let syncing = false;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function writeDevice(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 同步首帧缓存可重建 */ }
}

function removeDevice(key) {
  try { localStorage.removeItem(key); } catch { /* 存储不可用 */ }
}

export function saveLocal(...keys) {
  for (const key of keys) writeDevice(DEVICE + key, local[key]);
}

export function clearLegacyLocal() {
  legacyIcons = null;
  removeDevice(LEGACY_LOCAL);
  saveLocal(...Object.keys(local));
}

const readSettings = async () => (await chrome.storage.local.get(KEY))[KEY];
const locked = (name, work) => navigator.locks ? navigator.locks.request(name, work) : work();
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const notify = () => listeners.forEach((fn) => fn());

function adopt(next) {
  if (!same(state.appearance, next.appearance)) Object.assign(state.appearance, next.appearance);
  for (const key of ['layout', 'layouts', 'groups']) {
    if (!same(state[key], next[key])) state[key] = next[key];
  }
}

export async function load() {
  const legacy = read(LEGACY_LOCAL);
  legacyIcons = legacy?.icons;
  for (const key of Object.keys(local)) {
    local[key] = read(DEVICE + key) ?? legacy?.[key] ?? local[key];
  }
  if (!Number.isInteger(local.active)) local.active = 0;

  const oldSettings = read(KEY);
  let raw = oldSettings;
  let loadFailed = false;
  try {
    raw = await readSettings();
    if ((!raw || raw.version < DATA_VERSION || raw.blocks) && (oldSettings || raw)) {
      raw = await locked(KEY, async () => {
        const stored = await readSettings();
        if (stored?.version >= DATA_VERSION) return stored;
        const legacyState = oldSettings || stored;
        if (legacyState?.blocks) {
          local.active = Math.max(0, list(legacyState.groups).findIndex((group) => group?.id === legacyState.active));
          saveLocal('active');
        }
        const next = normalize(legacyState);
        await chrome.storage.local.set({ [KEY]: next });
        return next;
      });
    }
    removeDevice(KEY);
  } catch {
    loadFailed = true;
    raw ??= oldSettings;
  }
  baseline = normalize(raw);
  state = structuredClone(baseline);
  writeDevice(DEVICE + 'look', state.appearance);
  if (legacy && !Object.keys(legacyIcons || {}).length) clearLegacyLocal();
  return { loadFailed };
}

// 设置以单个属性为单位合并。链接分组和布局预设是有序集合，冲突时保留已经写入的版本。
function mergeChanges(base, draft, stored) {
  const next = structuredClone(stored);
  let conflict = false;
  const apply = (before, proposed, current, target, key) => {
    if (same(before[key], proposed[key])) return;
    if (!same(before[key], current[key]) && !same(proposed[key], current[key])) {
      conflict = true;
      return;
    }
    target[key] = proposed[key];
  };
  for (const key of ['groups', 'layouts']) apply(base, draft, stored, next, key);
  for (const key of Object.keys(base.appearance)) {
    apply(base.appearance, draft.appearance, stored.appearance, next.appearance, key);
  }
  for (const [id, block] of Object.entries(base.layout)) {
    for (const key of Object.keys(block)) apply(block, draft.layout[id], stored.layout[id], next.layout[id], key);
  }
  return { next, conflict };
}

export function save(immediate = false) {
  pending = true;
  clearTimeout(timer);
  if (immediate) return flush();
  timer = setTimeout(flush, 90);
}

function assertWritable(raw) {
  if (raw?.version > DATA_VERSION) throw new Error('这些设置来自较新版本的留白');
}

function flush() {
  clearTimeout(timer);
  if (writing || replacing || !pending) return writing;
  pending = false;
  const draft = structuredClone(state);
  const base = baseline;
  let failed = false;
  writing = locked(KEY, async () => {
    const raw = await readSettings();
    assertWritable(raw);
    const stored = normalize(raw ?? base);
    const result = mergeChanges(base, draft, stored);
    if (!raw || !same(stored, result.next)) await chrome.storage.local.set({ [KEY]: result.next });
    return result;
  }).then(({ next, conflict }) => {
    const edits = state;
    const rebased = mergeChanges(draft, edits, next);
    const recovery = conflict || rebased.conflict ? structuredClone(edits) : null;
    baseline = next;
    writeDevice(DEVICE + 'look', next.appearance);
    if (!same(rebased.next, edits)) {
      adopt(rebased.next);
      notify();
    }
    if (recovery) {
      recoveryDraft = recovery;
      emit('save-issue', { draft: recovery, conflict: true });
    }
  }).catch(() => {
    failed = true;
    pending = true;
    emit('save-issue', { draft: state, conflict: false });
  }).finally(() => {
    writing = null;
    if (!replacing && pending && !failed) flush();
    else syncExternal();
  });
  return writing;
}

export async function replaceState(input) {
  replacing = true;
  try {
    await writing;
    const next = normalize(input);
    await locked(KEY, async () => {
      assertWritable(await readSettings());
      await chrome.storage.local.set({ [KEY]: next });
    });
    clearTimeout(timer);
    pending = false;
    baseline = next;
    state = structuredClone(next);
    writeDevice(DEVICE + 'look', next.appearance);
  } finally {
    replacing = false;
    if (pending) flush();
    else syncExternal();
  }
}

export function onExternalChange(fn) { listeners.push(fn); }

async function syncExternal() {
  if (!state || writing || replacing || pending || syncing || !syncNeeded) return;
  syncNeeded = false;
  syncing = true;
  try {
    const next = normalize(await readSettings());
    if (writing || replacing || pending) {
      syncNeeded = true;
    } else if (!same(next, baseline)) {
      baseline = next;
      adopt(structuredClone(next));
      writeDevice(DEVICE + 'look', next.appearance);
      notify();
    }
  } catch { /* 下次保存或收到变更时再读 */ }
  finally {
    syncing = false;
    if (syncNeeded) syncExternal();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEY]) return;
  syncNeeded = true;
  syncExternal();
});

addEventListener('storage', (e) => {
  if (!state || !e.key?.startsWith(DEVICE)) return;
  const key = e.key.slice(DEVICE.length);
  if (key === 'active' || !Object.hasOwn(local, key)) return;
  local[key] = read(e.key);
  if (key === 'image') emit('wallpaper-file');
});
addEventListener('pagehide', flush);

const backupStore = (mode, run) => transaction(BACKUPS, 'days', mode, run);
const legacyBackups = async () => (await chrome.storage.local.get(BACKUPS))[BACKUPS] || {};

export async function autoBackup() {
  const day = today();
  await locked(BACKUPS, async () => {
    const old = await legacyBackups();
    await backupStore('readwrite', (store) => {
      for (const [key, data] of Object.entries(old)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) store.put(data, key);
      }
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const days = new Set(request.result);
        if (!days.has(day)) store.put(baseline, day);
        days.add(day);
        for (const key of [...days].sort().slice(0, -7)) store.delete(key);
      };
    });
    if (Object.keys(old).length) await chrome.storage.local.remove(BACKUPS);
  });
}

export async function listBackups() {
  const old = await legacyBackups();
  const { keys, values } = await backupStore('readonly', (store) => ({
    keys: store.getAllKeys(), values: store.getAll(),
  })).catch(() => ({}));
  if (keys) keys.result.forEach((day, i) => { old[day] = values.result[i]; });
  return old;
}
