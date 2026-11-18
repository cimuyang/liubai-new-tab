import { h, openUrl, searchWeb, emit } from './dom.js';
import { field, toast } from './ui.js';

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
export function searchPreferences() {
  const labels = { default: '浏览器默认', google: '谷歌', bing: '必应', baidu: '百度', custom: '自定义' };
  const engine = h('select', { class: 'input', 'aria-label': '搜索引擎' },
    Object.entries(labels).map(([value, text]) => h('option', { value, text })));
  engine.value = settings.engine;
  const address = h('input', { class: 'input', type: 'url', value: settings.custom,
    placeholder: 'https://example.com/search?q={query}', 'aria-label': '自定义搜索地址' });
  const commitEngine = async () => {
    if (engine.value === 'custom' && !validTemplate(address.value.trim())) {
      address.setCustomValidity('请输入包含 {query} 的 HTTPS 搜索地址');
      address.reportValidity();
      return;
    }
    const value = engine.value, custom = address.value.trim();
    try { await update(s => { s.engine = value; if (value === 'custom') s.custom = custom; }); }
    catch { engine.value = settings.engine; toast('搜索引擎保存失败'); }
  };
  const apply = h('button', { class: 'btn', text: '应用地址', onclick: commitEngine });
  const customFields = h('div', { class: 'stack', hidden: engine.value !== 'custom' },
    field('自定义地址', address), h('p', { class: 'note', text: '用 {query} 表示搜索词。' }), apply);
  address.oninput = () => address.setCustomValidity('');
  address.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) commitEngine(); };
  engine.onchange = () => {
    customFields.hidden = engine.value !== 'custom';
    if (customFields.hidden) commitEngine(); else address.focus();
  };
  const enabled = h('input', { type: 'checkbox', class: 'switch', checked: settings.enabled });
  const clear = h('button', { class: 'link-btn', text: '清空记录', hidden: !enabled.checked,
    onclick: async () => { try { await update(s => s.history = []); toast('搜索历史已清空'); } catch { toast('清空失败'); } } });
  enabled.onchange = async () => {
    const checked = enabled.checked;
    enabled.disabled = true;
    try { await update(s => { s.enabled = checked; if (!checked) s.history = []; }); }
    catch { enabled.checked = settings.enabled; toast('搜索历史设置保存失败'); }
    enabled.disabled = false;
    clear.hidden = !enabled.checked;
  };
  return h('div', { class: 'stack search-prefs' }, field('搜索引擎', engine), customFields,
    h('label', { class: 'row' }, h('span', { class: 'row-label grow', text: '记住最近搜索' }), enabled),
    h('p', { class: 'note', text: '仅在本机保留 30 条。无痕窗口不记录，关闭即清空。' }), clear);
}
