// 入口：组装各组件，绑定全局交互。
// 外观面板、导入导出、城市表等不常用的部分，用到时才加载。

import { load, state, local, onExternalChange, autoBackup } from './store.js';
import { on, track, today } from './dom.js';
import { menu } from './ui.js';
import { register, renderAll, enterEdit, exitEdit, isEditing, onStagePointerDown } from './layout.js';
import { createClock, createDate, createSearch, createWeather } from './blocks.js';
import { createLinks } from './links.js';
import { initAppearance, applyAppearance } from './wallpaper.js';

await load();
initAppearance();

const stage = document.getElementById('stage');
const search = createSearch();
const links = createLinks();

register('clock', createClock());
register('date', createDate());
register('weather', createWeather());
register('links', links.links);
register('tabs', links.tabs);
register('search', search); // 最后注册，搜索建议浮在其他组件之上
renderAll();

const openAppearance = async () => (await import('./appearance.js')).openAppearance();
const openData = async () => (await import('./data.js')).openData();

// ───────── 模块间事件 ─────────
on('appearance', openAppearance);
on('bookmarks', async () => (await import('./data.js')).importBookmarks());
on('edit', enterEdit);

/** state 被整体替换（恢复备份、导入、其他标签页的改动）后，全部重绘。 */
function reload() {
  links.reset();
  applyAppearance(true);
  renderAll();
}
on('data', () => { reload(); links.loadIcons(); });
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

addEventListener('keydown', (e) => {
  if (isEditing() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input') || document.querySelector('.scrim, .menu')) return;
  if (e.key === 'ArrowLeft') links.step(-1);
  else if (e.key === 'ArrowRight') links.step(1);
  // 直接打字即开始搜索（Process 是输入法按键）
  else if (((e.key.length === 1 && e.key !== ' ') || e.key === 'Process') && state.layout.search.visible) search.input.focus();
});

document.addEventListener('dragstart', (e) => e.preventDefault());

// ───────── 空闲时的后台工作 ─────────
requestIdleCallback(() => {
  links.loadIcons(); // 读取浏览器本地的图标
  autoBackup();
  // 仅在「每日自动」开启、且今天还没换过壁纸时联网
  if (state.appearance.bing === 'daily' && local.bingDay !== today()) import('./appearance.js').then((m) => m.dailyBing());
});
