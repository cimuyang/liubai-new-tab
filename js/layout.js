// 布局系统：每个组件是一个可自由摆放的块。
// 位置以窗口比例保存（窗口变化时自动适应），大小是相对默认尺寸的倍数。
// 编辑模式下可拖动、缩放，带吸附、对齐线与等距提示，支持撤销和多套布局。

import { state, save, local, saveLocal, defaultLayout } from './store.js';
import { h, svg, clamp, on, emit, track } from './dom.js';
import { menu, closeMenu, control, prompt, toast } from './ui.js';
import { toneAt } from './wallpaper.js';

const root = document.documentElement;
const stage = document.getElementById('stage');
const layer = document.getElementById('layer');
const SNAP = 6; // 吸附距离（像素）
const defs = {}; // id → { el, title, anchor, render, options }
const ids = () => Object.keys(defs);
const rectOf = (id) => defs[id].el.getBoundingClientRect();

let editing = false;
let selected = null;
let history = [];
let cursor = 0;
let ui = null; // 编辑模式的界面元素

export const isEditing = () => editing;

/** 注册组件。def: { el, title, anchor?: 'top', render(), options(block, update) → 控件描述或节点 } */
export function register(id, def) {
  defs[id] = def;
  def.el.classList.add('block');
  def.el.dataset.id = id;
  stage.append(def.el);
  sizer.observe(def.el);
}

/** 按锚点定位，并对齐到物理像素：不使用 transform，文字和图标才能保持锐利。 */
function position(id) {
  const { el, anchor } = defs[id];
  const block = state.layout[id];
  const r = el.getBoundingClientRect();
  const snap = (v) => `${Math.round(v * devicePixelRatio) / devicePixelRatio}px`;
  el.style.left = snap(block.x * innerWidth - r.width / 2);
  el.style.top = snap(block.y * innerHeight - (anchor === 'top' ? 0 : r.height / 2));
}

function place(id) {
  const { el } = defs[id];
  const block = state.layout[id];
  el.hidden = !block.visible;
  el.style.setProperty('--s', block.scale);
  el.dataset.tone = toneAt(block.x, block.y);
  position(id);
}

const placeAll = () => { ids().forEach(place); frame(); };
const sizer = new ResizeObserver((entries) => {
  for (const entry of entries) position(entry.target.dataset.id);
  frame();
});
const syncPixel = () => root.style.setProperty('--dpx', `${1 / devicePixelRatio}px`);
syncPixel();
addEventListener('resize', () => { syncPixel(); placeAll(); });
on('tone', placeAll);

// 编辑模式下，组件只能被选中和拖动：拦下点击、右键和键盘焦点，避免误打开链接或触发搜索
for (const type of ['click', 'auxclick', 'dblclick', 'contextmenu']) {
  stage.addEventListener(type, (e) => { if (editing) { e.preventDefault(); e.stopPropagation(); } }, true);
}
stage.addEventListener('focusin', (e) => { if (editing) e.target.blur(); });

/** 按当前状态重绘全部组件。 */
export function renderAll() {
  for (const id of ids()) {
    defs[id].render();
    place(id);
  }
  if (!editing) return;
  if (selected && !state.layout[selected].visible) selected = null;
  inspect();
  frame();
  syncToolbar();
}

// ───────── 历史记录 ─────────
function commit() {
  const snap = JSON.stringify(state.layout);
  if (snap !== history[cursor]) {
    history.length = ++cursor;
    history.push(snap);
  }
  save();
  syncToolbar();
  emit('layout');
}

function travel(step) {
  if (!history[cursor + step]) return;
  cursor += step;
  state.layout = JSON.parse(history[cursor]);
  save();
  renderAll();
  emit('layout');
}

/** 套用一组布局；天气城市属于内容而非布局，予以保留。 */
function applyLayout(next) {
  const { city } = state.layout.weather;
  const base = defaultLayout();
  for (const id of Object.keys(base)) state.layout[id] = { ...base[id], ...next[id] };
  state.layout.weather.city = city;
  selected = null;
  renderAll();
  commit();
}

// ───────── 进入 / 退出 ─────────
export function enterEdit(selectId) {
  if (!editing) {
    editing = true;
    closeMenu();
    document.activeElement.blur();
    root.classList.add('editing');
    history = [JSON.stringify(state.layout)];
    cursor = 0;
    buildChrome();
    if (!local.hinted) {
      local.hinted = true;
      saveLocal('hinted');
      toast('拖动以移动 · 拖动圆点缩放 · 按 Esc 完成', 4200);
    }
  }
  select(selectId || null);
}

export function exitEdit() {
  if (!editing) return;
  editing = false;
  selected = null;
  closeMenu();
  root.classList.remove('editing', 'moving', 'tuning');
  for (const el of Object.values(ui)) el.remove();
  ui = null;
  removeEventListener('keydown', onKey);
}

function select(id) {
  selected = id;
  inspect();
  dock();
  frame();
}

// ───────── 编辑界面 ─────────
function buildChrome() {
  const button = (text, onclick, cls) => h('button', { class: cls, text, onclick });
  const undo = h('button', { class: 'icon', title: '撤销', onclick: () => travel(-1) }, svg('undo'));
  const redo = h('button', { class: 'icon', title: '重做', onclick: () => travel(1) }, svg('redo'));
  const sel = h('div', { class: 'sel', hidden: true }, h('i'), h('i'), h('i'), h('i'));
  for (const handle of sel.children) handle.addEventListener('pointerdown', startScale);
  const insp = h('div', { class: 'insp panel', hidden: true });
  // 调节滑块时收起选中框的圆点，画面更安静
  insp.addEventListener('pointerdown', (e) => {
    if (e.target.type !== 'range') return;
    root.classList.add('tuning');
    track(() => {}, () => root.classList.remove('tuning'));
  });
  ui = {
    toolbar: h('div', { class: 'toolbar panel' },
      button('组件', (e) => menu(componentItems, e.currentTarget)),
      button('外观', () => emit('appearance')),
      button('布局', (e) => menu(layoutItems, e.currentTarget)),
      h('span', { class: 'bar-sep' }), undo, redo,
      button('完成', exitEdit, 'done')),
    undo, redo, sel, insp,
    guideV: h('div', { class: 'guide v', hidden: true }),
    guideH: h('div', { class: 'guide h', hidden: true }),
    gapA: h('div', { class: 'guide gap', hidden: true }),
    gapB: h('div', { class: 'guide gap', hidden: true }),
  };
  layer.append(ui.toolbar, sel, insp, ui.guideV, ui.guideH, ui.gapA, ui.gapB);
  addEventListener('keydown', onKey);
  syncToolbar();
}

function syncToolbar() {
  ui.undo.disabled = cursor === 0;
  ui.redo.disabled = cursor >= history.length - 1;
}

const componentItems = () => ids().map((id) => ({
  label: defs[id].title,
  checked: state.layout[id].visible,
  keep: true,
  onClick: () => {
    const block = state.layout[id];
    block.visible = !block.visible;
    defs[id].render();
    place(id);
    select(block.visible ? id : selected === id ? null : selected);
    commit();
  },
}));

const copyLayout = () => JSON.parse(JSON.stringify(state.layout));
const layoutItems = () => [
  {
    label: '保存当前布局',
    onClick: () => prompt({
      title: '保存布局',
      value: `布局 ${state.layouts.length + 1}`,
      label: '保存',
      onSubmit: (name) => { state.layouts.push({ name, layout: copyLayout() }); save(); toast(`已保存「${name}」`); },
    }),
  },
  state.layouts.length && '-',
  ...state.layouts.map((item) => ({
    label: item.name,
    items: [
      { label: '套用', onClick: () => applyLayout(item.layout) },
      { label: '用当前布局覆盖', onClick: () => { item.layout = copyLayout(); save(); toast(`已更新「${item.name}」`); } },
      { label: '删除', danger: true, onClick: () => { state.layouts = state.layouts.filter((s) => s !== item); save(); } },
    ],
  })),
  '-',
  { label: '恢复默认布局', onClick: () => applyLayout({ weather: { visible: state.layout.weather.visible } }) },
];

/** 重建属性面板的内容。面板的位置由 dock() 决定，调节过程中保持不动。 */
function inspect() {
  ui.insp.hidden = !selected;
  if (!selected) return;
  const def = defs[selected];
  const block = state.layout[selected];
  /** 位置或大小变了：重新摆放。final 为 false 表示滑块拖动中，不计入撤销历史。 */
  const move = (final = true) => { place(selected); frame(); if (final) commit(); else save(); };
  /** 组件自己的选项变了：先重绘内容，再摆放。 */
  const update = (final) => { def.render(); move(final); };
  const scale = { key: 'scale', label: '大小', min: .4, max: 3, step: .01, format: (v) => `${Math.round(v * 100)}%` };
  ui.insp.replaceChildren(
    h('div', { class: 'insp-head' }, h('b', { text: def.title }), h('button', { class: 'link-btn', text: '隐藏', onclick: hideSelected })),
    ...def.options(block, update).map((item) => (item instanceof Node ? item : control(block, item, update))),
    control(block, scale, move),
  );
}

/** 属性面板停靠在离选中组件较远的一侧。只在选中或移动结束时决定一次。 */
function dock() {
  if (!selected) return;
  const r = rectOf(selected);
  ui.insp.dataset.side = innerWidth - r.right >= r.left ? 'right' : 'left';
}

/** 让选中框贴合选中的组件。 */
function frame() {
  if (!ui) return;
  ui.sel.hidden = !selected;
  if (!selected) return;
  const r = rectOf(selected);
  const pad = 10;
  Object.assign(ui.sel.style, {
    left: `${r.left - pad}px`, top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });
}

function hideSelected() {
  state.layout[selected].visible = false;
  place(selected);
  select(null);
  commit();
}

// ───────── 拖动、吸附与等距 ─────────
function showGuides(x, y, gaps = []) {
  ui.guideV.hidden = x == null;
  ui.guideH.hidden = y == null;
  if (x != null) ui.guideV.style.left = `${Math.round(x)}px`;
  if (y != null) ui.guideH.style.top = `${Math.round(y)}px`;
  [ui.gapA, ui.gapB].forEach((el, i) => {
    el.hidden = !gaps[i];
    if (gaps[i]) Object.assign(el.style, { left: `${gaps[i].x}px`, top: `${gaps[i].from}px`, height: `${gaps[i].to - gaps[i].from}px` });
  });
}

/** 在一组参考线中找出离某些点最近、且在吸附距离内的一条。 */
function nearest(points, targets) {
  let best = null;
  for (const p of points) {
    for (const t of targets) {
      const d = t - p;
      if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
  }
  return best;
}

/**
 * 等距吸附：让被拖动的组件与上下相邻组件的间距相等。
 * @param r 被拖动组件当前的矩形  @param others 其他组件的矩形
 * @returns { top, gaps } 吸附后的顶边位置与两段间距的标记，或 null
 */
function equalGap(r, others) {
  const column = others.filter((o) => o.left < r.right && o.right > r.left);
  const above = column.filter((o) => o.bottom <= r.top + SNAP).sort((a, b) => b.bottom - a.bottom);
  const below = column.filter((o) => o.top >= r.bottom - SNAP).sort((a, b) => a.top - b.top);
  const x = Math.round(r.left + r.width / 2);
  const options = [];
  if (above[0] && below[0]) { // 夹在两个组件正中
    const top = (above[0].bottom + below[0].top - r.height) / 2;
    options.push({ top, gaps: [{ x, from: above[0].bottom, to: top }, { x, from: top + r.height, to: below[0].top }] });
  }
  if (above[1]) { // 延续上方两个组件之间的间距
    const top = above[0].bottom + above[0].top - above[1].bottom;
    options.push({ top, gaps: [{ x, from: above[1].bottom, to: above[0].top }, { x, from: above[0].bottom, to: top }] });
  }
  if (below[1]) { // 延续下方两个组件之间的间距
    const top = below[0].top - (below[1].top - below[0].bottom) - r.height;
    options.push({ top, gaps: [{ x, from: top + r.height, to: below[0].top }, { x, from: below[0].bottom, to: below[1].top }] });
  }
  return options.find((o) => Math.abs(o.top - r.top) <= SNAP && o.gaps.every((g) => g.to > g.from)) || null;
}

/** 舞台上的按下事件：选中并拖动组件（仅编辑模式）。 */
export function onStagePointerDown(e) {
  if (!editing || e.button !== 0) return;
  const el = e.target.closest('.block');
  if (!el) { select(null); return; }
  e.preventDefault();
  const id = el.dataset.id;
  if (id !== selected) select(id);

  const block = state.layout[id];
  const start = { x: block.x, y: block.y };
  const r = el.getBoundingClientRect();
  const others = ids().filter((other) => other !== id && state.layout[other].visible).map(rectOf);
  // 可吸附的参考线：窗口中线、安全边距、其他组件的边缘与中线
  const margin = Math.round(Math.min(innerWidth, innerHeight) * .045);
  const xs = [innerWidth / 2, margin, innerWidth - margin, ...others.flatMap((o) => [o.left, o.left + o.width / 2, o.right])];
  const ys = [innerHeight / 2, margin, innerHeight - margin, ...others.flatMap((o) => [o.top, o.top + o.height / 2, o.bottom])];
  let moved = false;

  track((ev) => {
    let dx = ev.clientX - e.clientX;
    let dy = ev.clientY - e.clientY;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    root.classList.add('moving');
    let guideX = null;
    let guideY = null;
    let gaps = [];
    if (!ev.altKey) { // 按住 Alt 可临时关闭吸附
      const sx = nearest([r.left + dx, r.left + r.width / 2 + dx, r.right + dx], xs);
      if (sx) { dx += sx.d; guideX = sx.at; }
      const sy = nearest([r.top + dy, r.top + r.height / 2 + dy, r.bottom + dy], ys);
      if (sy) { dy += sy.d; guideY = sy.at; } else {
        const now = new DOMRect(r.left + dx, r.top + dy, r.width, r.height);
        const equal = equalGap(now, others);
        if (equal) { dy += equal.top - now.top; gaps = equal.gaps; }
      }
    }
    block.x = clamp(start.x + dx / innerWidth, 0, 1);
    block.y = clamp(start.y + dy / innerHeight, 0, 1);
    place(id);
    frame();
    showGuides(guideX, guideY, gaps);
  }, () => {
    root.classList.remove('moving');
    showGuides();
    if (!moved) return;
    dock();
    commit();
  });
}

function startScale(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const id = selected;
  const block = state.layout[id];
  const r = rectOf(id);
  // 以组件的锚点为中心缩放，缩放时锚点位置不变
  const ax = r.left + r.width / 2;
  const ay = defs[id].anchor === 'top' ? r.top : r.top + r.height / 2;
  const d0 = Math.hypot(e.clientX - ax, e.clientY - ay) || 1;
  const s0 = block.scale;

  track((ev) => {
    let s = clamp(s0 * Math.hypot(ev.clientX - ax, ev.clientY - ay) / d0, .4, 3);
    if (!ev.altKey && Math.abs(s - 1) < .04) s = 1; // 吸附到默认大小
    block.scale = Math.round(s * 100) / 100;
    place(id);
    frame();
  }, () => {
    inspect();
    commit();
  });
}

function onKey(e) {
  if (e.target.closest?.('input, .scrim')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && (key === 'z' || key === 'y')) { e.preventDefault(); travel(key === 'y' || e.shiftKey ? 1 : -1); return; }
  if (e.key === 'Escape') { if (selected) select(null); else exitEdit(); return; }
  if (!selected) return;
  if (e.key === 'Delete') { hideSelected(); return; }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir) return;
  e.preventDefault();
  const step = e.shiftKey ? 10 : 1;
  const block = state.layout[selected];
  block.x = clamp(block.x + dir[0] * step / innerWidth, 0, 1);
  block.y = clamp(block.y + dir[1] * step / innerHeight, 0, 1);
  place(selected);
  frame();
  commit();
}
