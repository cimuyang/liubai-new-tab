import { h, openUrl, searchWeb, emit } from './dom.js';
import { sheet, toast } from './ui.js';

const KEY = 'liubai-search';
const defaults = { enabled: false, engine: 'default', custom: '', history: [] };
let settings = { ...defaults };
const engines = { google: 'https://www.google.com/search?q={query}', bing: 'https://www.bing.com/search?q={query}', baidu: 'https://www.baidu.com/s?wd={query}' };
const lock = (fn) => navigator.locks ? navigator.locks.request(KEY, fn) : fn();
async function read() {
  const value = (await chrome.storage.local.get(KEY))[KEY] || {};
  return { ...defaults, ...value, enabled: value.enabled === true, engine: ['default', 'google', 'bing', 'baidu', 'custom'].includes(value.engine) ? value.engine : 'default', custom: typeof value.custom === 'string' ? value.custom.slice(0, 8192) : '', history: Array.isArray(value.history) ? value.history.filter(x => typeof x === 'string' && x.length <= 2048).slice(0, 30) : [] };
}
async function update(fn) {
  await lock(async () => { const next = await read(); fn(next); await chrome.storage.local.set({ [KEY]: next }); settings = next; emit('search-settings'); });
}
export async function loadSearchSettings() { try { settings = await read(); emit('search-settings'); } catch {} }
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[KEY]) loadSearchSettings(); });
export function recentSearches(query) {
  if (!settings.enabled || chrome.extension?.inIncognitoContext) return [];
  return settings.history.filter(x => x.toLowerCase().includes(query.toLowerCase()) && x !== query).slice(0, 6);
}
export async function deleteSearch(query) {
  await update(s => s.history = s.history.filter(x => x !== query));
}
export async function runSearch(query) {
  query = query.trim();
  if (!query) return;
  try {
    if (settings.enabled && !chrome.extension?.inIncognitoContext) await update(s => {
      if (s.enabled && !chrome.extension?.inIncognitoContext) s.history = [query.slice(0, 2048), ...s.history.filter(x => x !== query)].slice(0, 30);
    });
  } catch { /* A storage failure must never prevent searching. */ }
  const template = engines[settings.engine] || (settings.engine === 'custom' && settings.custom);
  if (template && validTemplate(template)) return openUrl(template.replaceAll('{query}', encodeURIComponent(query)));
  return searchWeb(query);
}
function validTemplate(value) {
  try { const u = new URL(value.replaceAll('{query}', 'test')); return value.includes('{query}') && u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
export async function openSearchSettings() {
  await loadSearchSettings();
  const engine = h('select', { class: 'input', 'aria-label': '搜索引擎' }, Object.entries({ default: '浏览器默认', google: '谷歌', bing: '必应', baidu: '百度', custom: '自定义' }).map(([value, text]) => h('option', { value, text })));
  engine.value = settings.engine;
  const custom = h('input', { class: 'input', value: settings.custom, placeholder: 'https://example.com/search?q={query}', 'aria-label': '自定义搜索地址' });
  custom.hidden = engine.value !== 'custom';
  engine.addEventListener('change', () => custom.hidden = engine.value !== 'custom');
  const enabled = h('input', { type: 'checkbox', checked: settings.enabled });
  sheet({ title: '搜索设置', body: [engine, custom,
    h('p', { class: 'note', text: '自定义地址使用 HTTPS，以 {query} 代表搜索词。' }),
    h('label', { class: 'row' }, enabled, '记住最近搜索'),
    h('p', { class: 'note', text: '默认关闭。开启后仅在本机保留最近 30 条；无痕窗口不记录。关闭并保存会删除已有记录。搜索历史不包含在备份中。' }),
    h('button', { class: 'btn', text: '清空搜索历史', onclick: async () => { try { await update(s => s.history = []); toast('搜索历史已清空'); } catch { toast('清空失败，请重试'); } } })],
    actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async close => {
      if (engine.value === 'custom' && !validTemplate(custom.value.trim())) { toast('请输入包含 {query} 的有效 HTTPS 地址'); return; }
      try { await update(s => { s.engine = engine.value; s.custom = custom.value.trim(); s.enabled = enabled.checked; if (!s.enabled) s.history = []; }); close(); } catch { toast('无法保存搜索设置'); }
    } }] });
}
