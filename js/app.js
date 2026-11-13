// 入口：组装各组件，绑定全局交互。
// 外观面板、导入导出、城市表等不常用的部分，用到时才加载。

import { load, state, local, onExternalChange, autoBackup } from './store.js';
import { on, track, today } from './dom.js';
import { menu, toast } from './ui.js';
import { register, renderAll, enterEdit, exitEdit, isEditing, onStagePointerDown } from './layout.js';
import { createClock, createDate, createSearch, createWeather } from './blocks.js';
import { createLinks } from './links.js';
import { initAppearance, applyAppearance } from './wallpaper.js';
import { migrateIcons, primeIcons } from './icons.js';

const { loadFailed } = await load();
initAppearance();

const stage = document.getElementById('stage');
const search = createSearch();
const links = createLinks();
await primeIcons(state.groups[local.active]?.links || []).catch(() => {});

register('clock', createClock());
register('date', createDate());
register('weather', createWeather());
register('links', links.links);
register('tabs', links.tabs);
register('search', search); // 最后注册，搜索建议浮在其他组件之上
renderAll();
if (loadFailed) toast('暂时无法读取本地设置，请重新打开标签页再试');

const openAppearance = async () => (await import('./appearance.js')).openAppearance();
const openData = async () => (await import('./data.js')).openData();

// ───────── 模块间事件 ─────────
on('appearance', openAppearance);
on('bookmarks', async () => (await import('./data.js')).importBookmarks());
on('edit', enterEdit);
on('notice', toast);
on('save-issue', ({ draft, conflict }) => {
  toast(conflict ? '另一标签页先修改了同一项。本页有改动未保存。' : '无法保存到浏览器存储。本页仍保留改动。',
    9000, { label: '导出改动', onClick: async () => (await import('./data.js')).exportBackup(draft) });
});

/** state 被整体替换（恢复备份、导入、其他标签页的改动）后，全部重绘。 */
function reload() {
  links.reset();
  applyAppearance();
  renderAll();
  requestAnimationFrame(() => links.loadIcons());
}
on('data', reload);
onExternalChange(() => { exitEdit(); reload(); });

// ───────── 全局交互 ─────────
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input')) return; // 输入框保留系统菜单（粘贴等）
  e.preventDefault();
  if (!stage.contains(e.target)) return;
  menu([
    { label: '添加链接', onClick: links.addLink },
    '-',
    { label: '编辑布局', onClick: () => enterEdit(e.target.closest('.block')?.dataset.id) },
    { label: '外观', onClick: openAppearance },
    { label: '导入与导出', onClick: openData },
  ], { x: e.clientX, y: e.clientY });
});

stage.addEventListener('pointerdown', (e) => {
  onStagePointerDown(e);
  // 长按空白处进入编辑模式；期间移动或松开则取消
  if (isEditing() || e.button !== 0 || e.target !== stage) return;
  const timer = setTimeout(() => { cancel(); enterEdit(); }, 550);
  const cancel = track((ev) => { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) cancel(); }, () => clearTimeout(timer));
});

const hasControls = (target) => links.dragging() || isEditing() || target.closest?.('input, textarea, select, [contenteditable]')
  || document.querySelector('.scrim, .menu');
const groupKeys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || hasControls(e.target)) return;
  if (Object.hasOwn(groupKeys, e.key)) {
    if (!e.repeat && links.step(groupKeys[e.key])) e.preventDefault();
    return;
  }
  if (((e.key.length === 1 && e.key !== ' ') || e.key === 'Process') && state.layout.search.visible) search.input.focus();
});

let wheelAt = 0;
let wheelTravel = 0;
let wheelUsed = false;
document.addEventListener('wheel', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || hasControls(e.target)
    || document.activeElement?.matches('input, textarea, select, [contenteditable]')
    || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || !links.wheelAllowed(e.target)) return;
  const now = performance.now();
  if (now - wheelAt > 180) { wheelTravel = 0; wheelUsed = false; }
  wheelAt = now;
  if (e.cancelable) e.preventDefault();
  if (wheelUsed) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const movement = e.deltaY * unit;
  if (Math.sign(movement) !== Math.sign(wheelTravel)) wheelTravel = 0;
  wheelTravel += movement;
  if (Math.abs(wheelTravel) >= 36) wheelUsed = links.step(Math.sign(wheelTravel));
}, { passive: false });

let returnTimer;
function refreshOnReturn() {
  if (document.hidden) return;
  clearTimeout(returnTimer);
  returnTimer = setTimeout(() => links.loadIcons(true), 180);
}
document.addEventListener('visibilitychange', refreshOnReturn);
addEventListener('focus', refreshOnReturn);

document.addEventListener('dragstart', (e) => e.preventDefault());

// ───────── 空闲时的后台工作 ─────────
function idleWork() {
  const allLinks = state.groups.flatMap((g) => g.links);
  migrateIcons(allLinks).then(() => Promise.all([links.loadIcons(), primeIcons(allLinks)])).catch(() => {});
  autoBackup().catch(() => {});
  // 仅在「每日自动」开启、且今天还没换过壁纸时联网
  if (state.appearance.bing === 'daily' && local.bingDay !== today()) import('./appearance.js').then((m) => m.dailyBing()).catch(() => {});
}
if (window.requestIdleCallback) requestIdleCallback(idleWork, { timeout: 1200 });
else setTimeout(idleWork, 120);
