// 链接网格与分组。
// 所有分组一次渲染完成，切换只是显示 / 隐藏；图标来自本机缓存，因此切换是即时的。
// 每个图标元素的 link 属性、每个网格与分组标签的 group 属性，直接指向 state 中的对象。

import { state, save, local, saveLocal } from './store.js';
import { h, svg, clamp, hostOf, normalizeUrl, openUrl, on, emit, track, pickFile, cover } from './dom.js';
import { menu, sheet, confirm, toast, field, control } from './ui.js';
import { iconNode, refreshIcons } from './icons.js';

const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const layer = document.getElementById('layer');

/** 重排前后各记录一次位置，用动画补上位移（FLIP）。 */
function flip(nodes, mutate) {
  const before = new Map(nodes.map((n) => [n, n.getBoundingClientRect()]));
  mutate();
  for (const node of nodes) {
    const a = before.get(node);
    const b = node.getBoundingClientRect();
    if (a.left !== b.left || a.top !== b.top) {
      node.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { id: 'flip', duration: 260, easing: EASE });
    }
  }
}

/**
 * 拖动排序。
 * @param opts { item: 可拖动项的选择器, zones?: 可投放区域的选择器, onSort(), onZone(el, zone) }
 */
function sortable(root, { item, zones, onSort, onZone }) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(item);
    if (e.button !== 0 || !el || el.querySelector('input')) return;
    const rect = el.getBoundingClientRect();
    let ghost = null;
    let zone = null;
    let lastSwap = 0;

    track((ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        ghost = el.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.style.cssText = `${root.style.cssText}; left: 0; top: 0; max-height: none; font-size: ${getComputedStyle(el).fontSize}; width: ${rect.width}px`;
        ghost.dataset.tone = root.dataset.tone;
        layer.append(ghost);
        el.classList.add('drag-src');
      }
      ghost.style.transform = `translate(${rect.left + ev.clientX - e.clientX}px, ${rect.top + ev.clientY - e.clientY}px) scale(1.06)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const nextZone = (zones && under?.closest(zones)) || null;
      if (nextZone !== zone) {
        zone?.classList.remove('drop');
        zone = nextZone;
        zone?.classList.add('drop');
      }
      // 正在补位动画中的项仍停在指针下方，跳过它们，否则会来回交换
      const over = under?.closest(item);
      if (over && over !== el && over.parentNode === el.parentNode && !over.getAnimations().some((a) => a.id === 'flip') && performance.now() - lastSwap > 120) {
        lastSwap = performance.now();
        flip([...el.parentNode.querySelectorAll(item)], () => {
          if (el.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING) over.after(el);
          else over.before(el);
        });
      }
    }, () => {
      if (!ghost) return;
      // 拖动结束时浏览器仍会触发一次点击，这里拦掉，避免误打开链接
      const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', stop, true));

      const finish = () => { ghost.remove(); el.classList.remove('drag-src'); };
      zone?.classList.remove('drop');
      if (zone) { finish(); onZone(el, zone); return; }
      const home = el.getBoundingClientRect();
      ghost.animate([{ transform: ghost.style.transform }, { transform: `translate(${home.left}px, ${home.top}px)` }], { duration: 220, easing: EASE })
        .finished.then(finish, finish);
      onSort();
    });
  });
}

export function createLinks() {
  const el = h('div', { class: 'links' });
  const tabsEl = h('div', { class: 'tabs' });
  const pill = h('span', { class: 'tab-pill' });
  let signature = '';

  const current = () => state.groups[local.active];
  const tabs = () => [...tabsEl.querySelectorAll('.tab')];
  const changed = () => { save(); render(); renderTabs(); };
  const setActive = (index) => { local.active = index; saveLocal('active'); };

  // ───────── 网格 ─────────
  const tile = (link) => Object.assign(h('a', { class: 'tile', href: link.url },
    iconNode(link),
    h('span', { class: 'tile-name', text: link.name || hostOf(link.url) })), { link });

  function emptyState() {
    const first = state.groups.every((g) => !g.links.length);
    return h('div', { class: 'empty' },
      h('span', { text: first ? '从这里开始' : '这个分组还没有链接' }),
      h('div', { class: 'empty-actions' },
        h('button', { class: 'quiet', text: '添加链接', onclick: () => editLink() }),
        first && h('button', { class: 'quiet', text: '从收藏夹导入', onclick: () => emit('bookmarks') })),
      first && h('span', { text: '长按空白处或点击右键，可以调整布局' }));
  }

  /** 内容变化时重建网格；只是样式变化时仅更新样式，图标不重绘。 */
  function render() {
    local.active = clamp(local.active, 0, state.groups.length - 1);
    const next = JSON.stringify(state.groups);
    if (next !== signature) {
      signature = next;
      el.replaceChildren(...state.groups.map((group) => Object.assign(h('div', { class: 'grid' },
        group.links.length ? group.links.map(tile) : emptyState()), { group })));
    }
    const b = state.layout.links;
    el.style.setProperty('--gap', b.gap);
    el.style.setProperty('--radius', b.radius);
    el.style.setProperty('--align', b.align);
    // icon 为 0 时按图标的原始像素显示（最清晰）；否则是图标占色块的比例
    if (b.icon) el.style.setProperty('--icon', `${b.icon * 100}%`); else el.style.removeProperty('--icon');
    el.style.setProperty('--letter', b.icon ? b.icon / .45 : 1);
    el.classList.toggle('no-labels', !b.labels);
    for (const grid of el.children) {
      grid.hidden = grid.group !== current();
      grid.style.setProperty('--cols', clamp(grid.group.links.length, 1, b.columns));
      grid.classList.toggle('is-empty', !grid.group.links.length);
    }
    for (const a of el.querySelectorAll('.tile')) a.target = b.newTab ? '_blank' : '';
    requestAnimationFrame(fit); // 等其他组件就位后再量
  }

  /** 限制链接区的高度：止于下方最近的组件（或窗口底部），放不下的部分在区域内滚动。 */
  function fit() {
    if (el.hidden) return;
    const r = el.getBoundingClientRect();
    let limit = innerHeight - 12;
    for (const other of document.querySelectorAll('.block:not([hidden])')) {
      const o = other.getBoundingClientRect();
      if (other !== el && o.top > r.top + 40 && o.left < r.right && o.right > r.left) limit = Math.min(limit, o.top - 14);
    }
    el.style.maxHeight = `${Math.max(120, limit - r.top)}px`;
    el.classList.toggle('scrolls', el.scrollHeight > el.clientHeight + 1);
  }
  new ResizeObserver(fit).observe(el);
  addEventListener('resize', fit);
  on('layout', fit);

  /** 读取浏览器的本地图标，更新还没有图标的链接。 */
  async function loadIcons() {
    const hosts = await refreshIcons(state.groups.flatMap((g) => g.links));
    for (const a of el.querySelectorAll('.tile')) {
      if (hosts.includes(hostOf(a.link.url))) a.firstChild.replaceWith(iconNode(a.link));
    }
  }

  // ───────── 分组 ─────────
  function renderTabs() {
    tabsEl.replaceChildren(pill,
      ...state.groups.map((group) => Object.assign(h('button', { class: 'tab', text: group.name }), { group })),
      h('button', { class: 'tab-add', 'aria-label': '新建分组', onclick: addGroup }, svg('plus')));
    syncPill();
  }

  function syncPill() {
    const active = tabs().find((tab) => tab.classList.toggle('on', tab.group === current()));
    if (!active) return;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
  }
  new ResizeObserver(syncPill).observe(tabsEl);
  requestAnimationFrame(() => requestAnimationFrame(() => tabsEl.classList.add('ready'))); // 首次定位不做动画

  function activate(index) {
    if (index === local.active || !state.groups[index]) return;
    const dir = Math.sign(index - local.active);
    setActive(index);
    for (const grid of el.children) {
      grid.hidden = grid.group !== current();
      if (!grid.hidden) grid.animate([{ opacity: 0, transform: `translateX(${dir * 1.4}em)` }, {}], { duration: 340, easing: EASE });
    }
    syncPill();
    fit();
  }

  function addGroup() {
    state.groups.push({ name: '新分组', links: [] });
    setActive(state.groups.length - 1);
    changed();
    rename(current());
  }

  function rename(group) {
    const tab = tabs().find((t) => t.group === group);
    const input = h('input', { value: group.name, maxLength: 16, spellcheck: false });
    let finished = false;
    const done = (keep) => {
      if (finished) return;
      finished = true;
      if (keep && input.value.trim()) group.name = input.value.trim();
      changed();
    };
    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    tab.replaceChildren(input);
    syncPill();
    input.select();
  }

  function removeGroup(group) {
    if (state.groups.length === 1) { toast('至少保留一个分组'); return; }
    const run = () => {
      const active = current();
      state.groups = state.groups.filter((g) => g !== group);
      setActive(Math.max(0, state.groups.indexOf(active)));
      changed();
    };
    if (!group.links.length) run();
    else confirm({ title: `删除「${group.name}」？`, note: `其中的 ${group.links.length} 个链接也会一并删除。`, label: '删除', danger: true, onConfirm: run });
  }

  // ───────── 链接操作 ─────────
  function moveLink(link, from, to) {
    from.links.splice(from.links.indexOf(link), 1);
    to.links.push(link);
    changed();
  }

  function removeLink(link, group) {
    const index = group.links.indexOf(link);
    group.links.splice(index, 1);
    changed();
    toast(`已删除「${link.name || hostOf(link.url)}」`, 5000, {
      label: '撤销',
      onClick: () => { group.links.splice(index, 0, link); changed(); },
    });
  }

  /** 添加（不传 link）或编辑链接。 */
  function editLink(link) {
    const draft = { icon: link?.icon || '' }; // '' 自动 | 'letter' 首字母 | data URL 自定义图片
    const name = h('input', { class: 'input', value: link?.name || '', placeholder: '留空则显示域名', spellcheck: false });
    const url = h('input', { class: 'input', value: link?.url || '', placeholder: 'example.com', spellcheck: false });
    const picker = h('div', { class: 'icon-pick' });

    const drawPicker = () => {
      const pick = { kind: draft.icon.startsWith('data:') ? 'image' : draft.icon };
      picker.replaceChildren(
        iconNode({ name: name.value, url: normalizeUrl(url.value) || '', icon: draft.icon }),
        control(pick, { key: 'kind', options: [['', '自动'], ['letter', '字母'], ['image', '图片']] }, async () => {
          if (pick.kind !== 'image') draft.icon = pick.kind;
          else {
            const chosen = await pickFile('image/*');
            try { if (chosen) draft.icon = cover(await createImageBitmap(chosen), 128, 128).toDataURL('image/webp', .9); } catch { toast('无法读取这张图片'); }
          }
          drawPicker();
        }));
    };
    name.addEventListener('input', drawPicker);
    url.addEventListener('change', drawPicker);
    drawPicker();

    sheet({
      title: link ? '编辑链接' : '添加链接',
      body: [field('网址', url), field('名称', name), field('图标', picker)],
      actions: [
        { label: '取消' },
        {
          label: link ? '完成' : '添加',
          primary: true,
          onClick: (close) => {
            const href = normalizeUrl(url.value);
            if (!href) { toast('请输入有效的网址'); url.focus(); return; }
            const next = { name: name.value.trim(), url: href, ...(draft.icon && { icon: draft.icon }) };
            if (link) { delete link.icon; Object.assign(link, next); } else current().links.push(next);
            close();
            changed();
            loadIcons();
          },
        },
      ],
    });
    (link ? name : url).focus();
  }

  // ───────── 事件 ─────────
  el.addEventListener('click', (e) => {
    const a = e.target.closest('.tile');
    if (a && !/^https?:/.test(a.link.url)) { e.preventDefault(); openUrl(a.link.url); }
  });

  el.addEventListener('contextmenu', (e) => {
    const a = e.target.closest('.tile');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const { link } = a;
    const group = a.parentNode.group;
    const others = state.groups.filter((g) => g !== group);
    menu([
      { label: '在新标签页打开', onClick: () => window.open(link.url, '_blank', 'noopener') },
      { label: '编辑', onClick: () => editLink(link) },
      others.length && { label: '移动到', items: others.map((g) => ({ label: g.name, onClick: () => moveLink(link, group, g) })) },
      '-',
      { label: '删除', danger: true, onClick: () => removeLink(link, group) },
    ], { x: e.clientX, y: e.clientY });
  });

  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) activate(state.groups.indexOf(tab.group));
  });
  tabsEl.addEventListener('dblclick', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && e.target.tagName !== 'INPUT') rename(tab.group);
  });
  tabsEl.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    e.stopPropagation();
    menu([
      { label: '重命名', onClick: () => rename(tab.group) },
      { label: '新建分组', onClick: addGroup },
      '-',
      { label: '删除分组', danger: true, onClick: () => removeGroup(tab.group) },
    ], { x: e.clientX, y: e.clientY });
  });

  sortable(el, {
    item: '.tile',
    zones: '.tab',
    onSort: () => {
      const grid = [...el.children].find((g) => g.group === current());
      grid.group.links = [...grid.querySelectorAll('.tile')].map((a) => a.link);
      signature = JSON.stringify(state.groups); // DOM 已是最新顺序，无需重建
      save();
    },
    onZone: (a, tab) => {
      const from = a.parentNode.group;
      if (tab.group === from) return;
      moveLink(a.link, from, tab.group);
      toast(`已移动到「${tab.group.name}」`);
    },
  });

  sortable(tabsEl, {
    item: '.tab',
    onSort: () => {
      const active = current();
      state.groups = tabs().map((tab) => tab.group);
      setActive(state.groups.indexOf(active));
      signature = JSON.stringify(state.groups);
      save();
      syncPill();
    },
  });

  return {
    addLink: () => editLink(),
    reset: () => { signature = ''; }, // state 被整体替换后调用，下次渲染时重建
    addGroup,
    step: (delta) => activate(local.active + delta), // 键盘左右键切换分组
    loadIcons,
    links: {
      el, title: '链接', anchor: 'top', render,
      options: (b, update) => {
        // 「清晰」档：按图标的原始像素显示。滑到它附近时自动吸附。
        const box = el.querySelector('.tile-icon')?.offsetWidth || 60;
        const crisp = clamp(Math.max(18, 32 / devicePixelRatio) / box, .2, .9);
        const isCrisp = (v) => Math.abs(v - crisp) < .035;
        const icon = { size: b.icon || crisp };
        return [
          { key: 'columns', label: '每行', min: 2, max: 14 },
          { key: 'align', label: '对齐', options: [['left', '左'], ['center', '中'], ['right', '右']] },
          { key: 'gap', label: '间距', min: .4, max: 4, step: .05, format: (v) => v.toFixed(1) },
          { key: 'radius', label: '圆角', min: 0, max: 50, format: (v) => `${v}%` },
          control(icon, { key: 'size', label: '图标', min: .2, max: .9, step: .01, format: (v) => (isCrisp(v) ? '清晰' : `${Math.round(v * 100)}%`) }, (final) => {
            b.icon = isCrisp(icon.size) ? 0 : icon.size;
            update(final);
          }),
          { key: 'labels', label: '显示名称' },
          { key: 'newTab', label: '在新标签页打开' },
        ];
      },
    },
    tabs: {
      el: tabsEl, title: '分组', render: renderTabs,
      options: () => [h('p', { class: 'note', text: '双击分组名可重命名，拖动可排序。把链接拖到分组名上，可移动到该分组。' })],
    },
  };
}
