// 界面基础件：菜单、对话框、提示、表单控件。

import { h, svg, clamp } from './dom.js';

const layer = document.getElementById('layer');

// ───────── 菜单 ─────────
let dismissMenu = null;
export function closeMenu() { dismissMenu?.(); }

/**
 * 弹出菜单。
 * @param items 菜单项数组，或返回数组的函数（每次重绘时重新求值）。
 *   项：'-' 分隔线 | { label, onClick, checked, danger, keep, items }
 *   keep：点击后不关闭（用于开关）；items：子菜单。
 * @param at {x, y} 坐标，或作为锚点的元素。
 */
export function menu(items, at) {
  closeMenu();
  const el = h('div', { class: 'menu panel', role: 'menu' });
  const previous = document.activeElement;
  const path = []; // 进入的子菜单层级

  const draw = () => {
    let list = typeof items === 'function' ? items() : items;
    for (const step of path) list = list.find((it) => it?.label === step)?.items || [];
    el.replaceChildren();
    if (path.length) {
      el.append(
        h('button', { class: 'menu-item', onclick: () => { path.pop(); draw(); } }, svg('back'), h('span', { class: 'menu-label', text: path.at(-1) })),
        h('div', { class: 'menu-sep' }),
      );
    }
    for (const it of list) {
      if (!it) continue;
      if (it === '-') { el.append(h('div', { class: 'menu-sep' })); continue; }
      el.append(h('button', {
        class: `menu-item${it.danger ? ' danger' : ''}`,
        onclick: () => {
          if (it.items) { path.push(it.label); draw(); return; }
          if (!it.keep) close();
          it.onClick();
          if (it.keep) draw();
        },
      },
      h('span', { class: 'menu-check' }, it.checked && svg('check')),
      h('span', { class: 'menu-label', text: it.label }),
      it.items && svg('chevron')));
    }
    for (const button of el.querySelectorAll('button')) button.setAttribute('role', 'menuitem');
    el.querySelector('button')?.focus({ preventScroll: true });
    let { x, y } = at;
    if (at instanceof Element) {
      const r = at.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 8;
    }
    el.style.left = `${clamp(x, 8, innerWidth - el.offsetWidth - 8)}px`;
    el.style.top = `${clamp(y, 8, innerHeight - el.offsetHeight - 8)}px`;
  };

  const onDown = (e) => { if (!el.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); previous?.focus({ preventScroll: true }); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const items = [...el.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  function close() {
    el.remove();
    removeEventListener('pointerdown', onDown, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('blur', close);
    removeEventListener('resize', close);
    if (dismissMenu === close) dismissMenu = null;
  }
  dismissMenu = close;

  layer.append(el);
  draw();
  addEventListener('pointerdown', onDown, true);
  addEventListener('keydown', onKey, true);
  addEventListener('blur', close);
  addEventListener('resize', close);
}

// ───────── 对话框 ─────────
const dialogs = [];
let dialogId = 0;
/**
 * @param opts { title, note, body: Node[], actions: [{ label, primary, danger, onClick(close) }], onClose }
 *   没有 onClick 的按钮仅关闭对话框；按回车触发 primary 按钮。
 */
export function sheet({ title, note, body = [], actions = [], onClose }) {
  closeMenu();
  const previous = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    dialogs.splice(dialogs.indexOf(scrim), 1);
    removeEventListener('keydown', onKey, true);
    onClose?.();
    if (previous?.isConnected && (!dialogs.length || dialogs.at(-1).contains(previous))) previous.focus({ preventScroll: true });
    else if (dialogs.length) dialogs.at(-1).querySelector('.sheet').focus({ preventScroll: true });
  };
  const buttons = actions.map((a) => h('button', {
    class: `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
    text: a.label,
    onclick: () => (a.onClick ? a.onClick(close) : close()),
  }));
  const primary = buttons[actions.findIndex((a) => a.primary)];
  const heading = `sheet-title-${++dialogId}`;
  const box = h('div', { class: 'sheet panel', role: 'dialog', tabIndex: -1, 'aria-modal': 'true', 'aria-labelledby': heading },
    h('h2', { id: heading, text: title }),
    note && h('p', { class: 'note', text: note }),
    h('div', { class: 'sheet-body' }, body),
    h('div', { class: 'sheet-actions' }, buttons));
  const scrim = h('div', { class: 'scrim', onpointerdown: (e) => { if (e.target === scrim) close(); } }, box);

  function onKey(e) {
    if (dialogs.at(-1) !== scrim || e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    } else if (e.key === 'Tab') {
      const items = [...box.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')]
        .filter((item) => !item.disabled && item.getClientRects().length);
      const first = items[0] || box;
      const last = items.at(-1) || box;
      if (!items.includes(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    } else if (e.key === 'Enter' && primary && box.contains(e.target) && e.target.matches('input.input:not([type]), input[type="text"]')) {
      e.preventDefault();
      primary.click();
    }
  }
  addEventListener('keydown', onKey, true);
  dialogs.push(scrim);
  layer.append(scrim);
  (box.querySelector('input.input') || primary || buttons[0] || box).focus();
  return { close, primary };
}

export function confirm({ title, note, label = '确定', danger = false, onConfirm }) {
  sheet({
    title, note,
    actions: [{ label: '取消' }, { label, primary: !danger, danger, onClick: (close) => { close(); onConfirm(); } }],
  });
}

/** 输入一行文字。 */
export function prompt({ title, value = '', label = '确定', onSubmit }) {
  const input = h('input', { class: 'input', value, spellcheck: false });
  sheet({
    title,
    body: [input],
    actions: [{ label: '取消' }, { label, primary: true, onClick: (close) => { const v = input.value.trim(); if (v) { close(); onSubmit(v); } } }],
  });
  input.select();
}

// ───────── 提示 ─────────
let toastEl = null;
/** @param action 可选的操作按钮 { label, onClick }，例如「撤销」 */
export function toast(text, ms = 2600, action = null) {
  toastEl?.remove();
  const el = toastEl = h('div', { class: 'toast panel' }, h('span', { text }),
    action && h('button', { class: 'link-btn', text: action.label, onclick: () => { el.remove(); action.onClick(); } }));
  layer.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

// ───────── 表单控件 ─────────
export const field = (label, input) => h('label', { class: 'field' }, h('span', { text: label }), input);

/**
 * 绑定到 obj[key] 的控件，按参数自动选择形态：
 * 有 options 是分段选择，有 max 是滑块，否则是开关。
 * @param change(final) 值改变后回调；拖动滑块的过程中 final 为 false。
 */
export function control(obj, { key, label, options, min, max, step = 1, format = String }, change) {
  const name = label && h('span', { class: 'row-label', text: label });
  if (options) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([value, text]) => h('button', {
      class: value === obj[key] ? 'on' : '',
      'aria-pressed': String(value === obj[key]),
      text,
      onclick: (e) => {
        for (const b of seg.children) {
          const active = b === e.currentTarget;
          b.classList.toggle('on', active);
          b.setAttribute('aria-pressed', String(active));
        }
        obj[key] = value;
        change(true);
      },
    })));
    return h('div', { class: 'row' }, name, seg);
  }
  if (max == null) {
    const input = h('input', { type: 'checkbox', class: 'switch', checked: !!obj[key] });
    input.addEventListener('change', () => { obj[key] = input.checked; change(true); });
    name.classList.add('grow');
    return h('label', { class: 'row' }, name, input);
  }
  const out = h('span', { class: 'row-value', text: format(obj[key]) });
  const input = h('input', { type: 'range', 'aria-label': label, min, max, step, value: obj[key] });
  const paint = () => input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => { obj[key] = +input.value; paint(); out.textContent = format(obj[key]); change(false); });
  input.addEventListener('change', () => change(true));
  paint();
  return h('div', { class: 'row' }, name, input, out);
}
