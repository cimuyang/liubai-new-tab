// 链接网格与分组。
import { state, save, local, saveLocal, isIconImage, normalizeLink } from './store.js';
import { h, svg, clamp, hostOf, normalizeUrl, openUrl, on, emit, track, pickFile, shortText } from './dom.js';
import { menu, sheet, confirm, toast, field, control } from './ui.js';
import { automaticIcon, iconKey, iconNode, iconQuality, primeIcons, refreshIcons, useSiteIcon } from './icons.js';
import { canFetchSiteIcon, canUseIconService, fetchSiteIcons, siteResult } from './site-icons.js';
import { linkSlots, placeLink, saveSlots } from './link-positions.js';
import { bindLinkDrag } from './link-drag.js';
import { describeIcon } from './icon-image.js';

const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const layer = document.getElementById('layer');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/** 重排前后各记录一次位置，用动画补上位移（FLIP）。 */
function flip(nodes, mutate) {
  if (reduced.matches) { mutate(); return; }
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
 * @param opts { item: 可拖动项的选择器, onSort() }
 */
function sortable(root, { item, onSort }) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(item);
    if (e.button !== 0 || !el || el.querySelector('input') || document.documentElement.classList.contains('editing')) return;
    const rect = el.getBoundingClientRect();
    const siblings = [...el.parentNode.querySelectorAll(item)];
    let ghost = null;
    let lastSwap = 0;

    track((ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        ghost = el.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.dataset.labelInk = root.dataset.labelInk || 'auto';
        ghost.style.cssText = `${root.style.cssText}; left: 0; top: 0; max-height: none; font-size: ${getComputedStyle(el).fontSize}; width: ${rect.width}px`;
        layer.append(ghost);
        el.classList.add('drag-src');
      }
      ghost.style.transform = `translate(${rect.left + ev.clientX - e.clientX}px, ${rect.top + ev.clientY - e.clientY}px) scale(1.06)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      // 正在补位动画中的项仍停在指针下方，跳过它们，否则会来回交换
      const over = under?.closest(item);
      if (over && over !== el && over.parentNode === el.parentNode && !over.getAnimations().some((a) => a.id === 'flip') && performance.now() - lastSwap > 120) {
        lastSwap = performance.now();
        flip([...el.parentNode.querySelectorAll(item)], () => {
          if (el.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING) over.after(el);
          else over.before(el);
        });
      }
    }, (event) => {
      if (!ghost) return;
      if (event.type === 'pointercancel' || !el.isConnected) {
        if (el.isConnected) siblings.forEach((sibling) => el.parentNode.append(sibling));
        ghost.remove();
        el.classList.remove('drag-src');
        return;
      }
      // 拖动结束时浏览器仍会触发一次点击，这里拦掉，避免误打开链接
      const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', stop, true));

      const finish = () => { ghost.remove(); el.classList.remove('drag-src'); };
      const home = el.getBoundingClientRect();
      if (reduced.matches) finish();
      else ghost.animate([{ transform: ghost.style.transform }, { transform: `translate(${home.left}px, ${home.top}px)` }], { duration: 220, easing: EASE })
        .finished.then(finish, finish);
      onSort();
    });
  });
}

function iconSource() {
  const select = h('select', { class: 'input', 'aria-label': '查找来源' },
    h('option', { value: 'site', text: '直接从网站查找' }),
    h('option', { value: 'service', text: '使用 Icon Horse' }));
  const note = h('p', { class: 'note', text: '仅请求公开页面和图标，不携带 Cookie。' });
  select.addEventListener('change', () => {
    note.textContent = select.value === 'service'
      ? 'Icon Horse 会收到查询的域名和请求 IP。图片会保存到本机。'
      : '仅请求公开页面和图标，不携带 Cookie。';
  });
  return { select, note };
}

export function createLinks() {
  const el = h('div', { class: 'links' });
  const tabsEl = h('div', { class: 'tabs', role: 'group', 'aria-label': '链接分组' });
  const pill = h('span', { class: 'tab-pill' });
  const scrollPositions = new WeakMap();
  let grid;
  let iconTimer;
  let previewGroup;
  const fixed = () => state.layout.links.arrangement === 'fixed';

  const current = () => previewGroup || state.groups[local.active];
  const tabs = () => [...tabsEl.querySelectorAll('.tab')];
  const changed = () => { save(true); render(); renderTabs(); scheduleIcons(); };
  const setActive = (index) => { local.active = index; saveLocal('active'); };

  // ───────── 网格 ─────────
  function tile(link) {
    const name = link.name || hostOf(link.url) || link.url;
    return Object.assign(h('a', { class: 'tile', href: link.url, title: name, rel: 'noopener', 'aria-label': name },
      iconNode(link), h('span', { class: 'tile-name', text: name })), { link });
  }

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
    const group = current();
    const position = grid?.group === group
      ? { top: el.scrollTop, left: el.scrollLeft }
      : scrollPositions.get(group) || { top: 0, left: 0 };
    if (grid?.group !== group || grid.fixed !== fixed()) {
      if (grid?.group) scrollPositions.set(grid.group, { top: el.scrollTop, left: el.scrollLeft });
      grid = Object.assign(h('div', { class: group.links.length ? 'grid' : 'grid is-empty' },
        group.links.length ? group.links.map(tile) : emptyState()), { group, fixed: fixed() });
      el.replaceChildren(grid);
    } else {
      // Keep existing tiles mounted while moving them, so decoded images and focus survive.
      const nodes = new Map([...grid.querySelectorAll('.tile')].map((node) => [node.link, node]));
      const links = new Set(group.links);
      for (const [link, node] of nodes) if (!links.has(link)) node.remove();
      grid.classList.toggle('is-empty', !group.links.length);
      if (group.links.length) {
        grid.querySelector('.empty')?.remove();
        group.links.forEach((link, index) => {
          const node = nodes.get(link) || tile(link);
          if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] || null);
        });
      } else if (!grid.firstChild) grid.append(emptyState());
    }
    const b = state.layout.links;
    el.style.setProperty('--gap', b.gap);
    el.style.setProperty('--radius', b.radius);
    el.style.setProperty('--align', b.align);
    grid.style.setProperty('--cols', b.columns);
    grid.classList.toggle('fixed-grid', fixed());
    el.classList.toggle('fixed-links', fixed());
    if (fixed()) {
      const slots = linkSlots(group.links);
      let lastRow = 1;
      for (const a of grid.querySelectorAll('.tile')) {
        const slot = slots.get(a.link);
        const row = Math.floor(slot / b.columns) + 1;
        a.style.gridRowStart = row;
        a.style.gridColumnStart = slot % b.columns + 1;
        lastRow = Math.max(lastRow, row);
      }
      grid.style.setProperty('--rows', lastRow);
    }
    if (b.icon) el.style.setProperty('--icon', `${b.icon * 100}%`);
    else el.style.removeProperty('--icon');
    el.style.setProperty('--letter', b.icon ? b.icon / .45 : 1);
    el.classList.toggle('no-labels', !b.labels);
    el.dataset.labelInk = b.labelColor;
    el.classList.toggle('solid-icons', b.iconBackground === 'solid');
    for (const a of el.querySelectorAll('.tile')) a.target = b.newTab ? '_blank' : '';
    fit();
    el.scrollTop = position.top;
    el.scrollLeft = position.left;
    updateScroll();
  }

  function fit() {
    if (el.hidden || !grid) return;
    const { columns, gap } = state.layout.links;
    const em = parseFloat(getComputedStyle(el).fontSize);
    const width = Math.max(1, Math.floor(((innerWidth - 24) / em - 2 + gap * .62) / (5.2 + gap * .62)));
    if (!fixed()) grid.style.setProperty('--cols', Math.min(columns, width));
    const r = el.getBoundingClientRect();
    let limit = innerHeight - 12;
    for (const other of document.querySelectorAll('.block:not([hidden])')) {
      const o = other.getBoundingClientRect();
      if (other !== el && o.top > r.top + 40 && o.left < r.right && o.right > r.left) limit = Math.min(limit, o.top - 14);
    }
    const height = `${Math.max(80, limit - r.top)}px`;
    if (el.style.maxHeight !== height) el.style.maxHeight = height;
    updateScroll();
  }
  new ResizeObserver(fit).observe(el);
  addEventListener('resize', () => { fit(); scheduleIcons(); });
  on('layout', () => { fit(); scheduleIcons(); });

  function updateScroll() {
    el.classList.toggle('scrolls', el.scrollTop + el.clientHeight + 1 < el.scrollHeight);
  }

  const allLinks = () => state.groups.flatMap((group) => group.links);
  const targetPixels = () => (el.querySelector('.tile-icon')?.offsetWidth || 64) * (state.layout.links.icon || .74) * devicePixelRatio;

  async function loadIcons(revisit = false) {
    if (el.hidden) return;
    const area = el.getBoundingClientRect();
    const visible = [];
    for (const tile of el.querySelectorAll('.tile')) {
      const rect = tile.getBoundingClientRect();
      if (rect.bottom >= area.top && rect.top <= area.bottom + rect.height
        && rect.right >= area.left && rect.left <= area.right) visible.push(tile.link);
    }
    await refreshIcons(visible, { pixels: targetPixels(), revisit, knownLinks: allLinks() });
  }

  function scheduleIcons(revisit = false) {
    clearTimeout(iconTimer);
    iconTimer = setTimeout(() => loadIcons(revisit), 110);
  }

  el.addEventListener('scroll', () => {
    if (grid?.group) scrollPositions.set(grid.group, { top: el.scrollTop, left: el.scrollLeft });
    updateScroll();
    scheduleIcons();
  }, { passive: true });
  on('icon', (key) => {
    for (const a of el.querySelectorAll('.tile')) {
      if (!a.link.icon && iconKey(a.link.url) === key) a.firstChild.replaceWith(iconNode(a.link));
    }
  });

  // ───────── 分组 ─────────
  function renderTabs() {
    const existing = tabs();
    if (existing.length === state.groups.length && existing.every((tab, i) => tab.group === state.groups[i] && tab.textContent === tab.group.name && !tab.querySelector('input'))) { syncPill(); return; }
    tabsEl.replaceChildren(pill,
      ...state.groups.map((group) => Object.assign(h('button', { class: 'tab', text: group.name }), { group })),
      h('button', { class: 'tab-add', 'aria-label': '新建分组', onclick: addGroup }, svg('plus')));
    syncPill();
  }

  function syncPill() {
    let active;
    for (const tab of tabs()) {
      const selected = tab.group === current();
      tab.classList.toggle('on', selected);
      tab.setAttribute('aria-pressed', String(selected));
      if (selected) active = tab;
    }
    if (!active) return;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    if (active.offsetLeft < tabsEl.scrollLeft) tabsEl.scrollLeft = active.offsetLeft;
    else if (active.offsetLeft + active.offsetWidth > tabsEl.scrollLeft + tabsEl.clientWidth) {
      tabsEl.scrollLeft = active.offsetLeft + active.offsetWidth - tabsEl.clientWidth;
    }
  }
  new ResizeObserver(syncPill).observe(tabsEl);
  requestAnimationFrame(() => requestAnimationFrame(() => tabsEl.classList.add('ready'))); // 首次定位不做动画

  function activate(index, dir = Math.sign(index - local.active)) {
    if (index === local.active || !state.groups[index]) return false;
    const focusTab = tabsEl.contains(document.activeElement) && document.activeElement.matches('.tab');
    setActive(index);
    render();
    syncPill();
    if (focusTab) tabs().find((tab) => tab.group === current())?.focus({ preventScroll: true });
    if (!reduced.matches) {
      grid.animate([{ opacity: .85, transform: `translateX(${dir * .45}em)` }, {}], { duration: 170, easing: EASE });
    }
    scheduleIcons();
    return true;
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
  function removeLink(link, group) {
    const index = group.links.indexOf(link);
    if (fixed() || group.links.some((item) => item.slot !== undefined)) saveSlots(group.links);
    group.links.splice(index, 1);
    changed();
    toast(`已删除「${link.name || hostOf(link.url)}」`, 5000, {
      label: '撤销',
      onClick: () => {
        if (!state.groups.includes(group)) return;
        if (group.links.some((other) => other.slot === link.slot)) delete link.slot;
        group.links.splice(index, 0, link);
        if (fixed()) saveSlots(group.links);
        changed();
      },
    });
  }

  /** 添加（不传 link）或编辑链接。 */
  function editLink(link) {
    const { select: provider, note: providerNote } = iconSource();
    const group = link ? state.groups.find((g) => g.links.includes(link)) : current();
    const groupSelect = h('select', { class: 'input' }, state.groups.map((item, index) =>
      h('option', { value: String(index), text: item.name })));
    groupSelect.value = String(state.groups.indexOf(group));
    const groups = state.groups.slice();
    const name = h('input', { class: 'input', value: link?.name || '', placeholder: '留空则显示域名', spellcheck: false });
    const url = h('input', { class: 'input', value: link?.url || '', placeholder: 'example.com', spellcheck: false });
    name.maxLength = 256;
    url.maxLength = 8192;
    let picture = isIconImage(link?.icon) ? link.icon : '';
    let pictureFill = link?.iconFill || '';
    const kind = { value: picture ? 'image' : link?.icon === 'text' ? 'text' : 'auto' };
    const fit = { value: link?.iconFit || (picture ? 'cover' : 'contain') };
    const caption = h('input', {
      class: 'input', value: link?.iconText || '', placeholder: '最多 4 个字符，留空使用首字', maxLength: 32,
    });
    const colors = { iconBg: link?.iconBg || '', iconFg: link?.iconFg || '' };
    const preview = h('div', { class: 'icon-preview' });
    const options = h('div', { class: 'icon-options stack' });
    const status = h('p', { class: 'note icon-status', role: 'status', hidden: true });
    const value = () => ({
      name: name.value, url: normalizeUrl(url.value) || '',
      icon: kind.value === 'image' ? picture : kind.value === 'text' ? 'text' : '',
      iconFit: fit.value, iconFill: pictureFill, iconText: shortText(caption.value), ...colors,
    });
    let closed = false;
    let network;
    let assetOrigins = [];
    let approvedOrigins = [];
    let candidates = [];
    let staged;
    const advanced = h('details', { class: 'icon-more' }, h('summary', { text: '图标外观' }));
    const replacement = h('details', { class: 'icon-more' }, h('summary', { text: '更换图标' }));
    const lookup = h('details', { class: 'icon-lookup' }, h('summary', { text: '查找高清图标' }));
    let dialog;
    let readingFile = false;

    const show = (message = '') => { status.textContent = message; status.hidden = !message; };
    const draw = () => {
      preview.classList.toggle('solid-icons', state.layout.links.iconBackground === 'solid');
      const draft = value();
      preview.replaceChildren(iconNode(staged && kind.value === 'auto' ? { ...draft, icon: staged.data, iconFit: 'contain' } : draft));
      fromCache.disabled = !iconKey(value().url) || !!network;
      fromSite.hidden = !canFetchSiteIcon(value().url);
      fromSite.disabled = !!network || provider.value === 'service' && !canUseIconService(draft.url);
      provider.disabled = !!network;
      fromSite.textContent = assetOrigins.length ? '继续获取图标' : '开始查找';
      if (dialog) dialog.primary.disabled = !!network || readingFile;
    };
    const checkCache = async (force = false) => {
      const candidate = value();
      const key = iconKey(candidate.url);
      if (kind.value !== 'auto' || !key) return;
      if (force) show('正在读取浏览器中的图标…');
      await refreshIcons([candidate], { pixels: targetPixels(), force, knownLinks: allLinks() });
      if (closed || key !== iconKey(value().url) || kind.value !== 'auto') return;
      draw();
      if (force && !network) show(automaticIcon(candidate.url) ? '已读取图标' : '本地没有图标，可以访问该网站后重试');
    };
    const fromCache = h('button', { class: 'btn', text: '刷新本地图标', onclick: () => checkCache(true) });
    const fromSite = h('button', { class: 'btn', text: '从网站获取图标', onclick: async () => {
      const address = value().url;
      if (network || !canFetchSiteIcon(address)) return;
      const request = network = new AbortController();
      draw();
      show('正在查找可用图标…');
      try {
        const scope = [...new Set([...approvedOrigins, ...assetOrigins])];
        const result = await fetchSiteIcons([address], request.signal, scope, provider.value);
        if (request !== network || closed || address !== value().url) return;
        const found = siteResult(result, address);
        if (!found) {
          show(result.status === 'denied' ? '未获得访问权限' : '暂时无法获取图标，请稍后再试');
          return;
        }
        approvedOrigins = scope;
        assetOrigins = found.origins;
        candidates = [...new Map([...found.icons, ...candidates].map((icon) => [icon.data, icon])).values()]
          .sort((a, b) => iconQuality(b) - iconQuality(a)).slice(0, 4);
        if (found.icons.length && (!staged || iconQuality(found.icons[0]) > iconQuality(staged))) staged = found.icons[0];
        if (request !== network || closed || address !== value().url) return;
        const sites = assetOrigins.map((origin) => new URL(origin).hostname).join('、');
        show(sites ? `网站还声明了这些图片来源：${sites}` : candidates.length
          ? '可选择下方图标并固定使用' : '网站没有返回可用图标，可使用图片或备用文字');
      } finally {
        if (request === network) { network = null; if (!closed) drawOptions(); }
      }
    } });

    const chooseImage = async () => {
      const picked = await pickFile('image/*');
      if (!picked || closed || kind.value !== 'image') return;
      readingFile = true;
      draw();
      try {
        const image = picked.size <= 16 * 1024 * 1024 && await describeIcon(picked);
        if (closed || kind.value !== 'image') return;
        if (!image) { show('无法读取这张图片，请选择 16 MB 以内的图片'); return; }
        picture = image.data;
        pictureFill = '#' + image.fill.split(' ').map((value) => Number(value).toString(16).padStart(2, '0')).join('');
        show();
      } finally {
        readingFile = false;
        if (!closed) drawOptions();
      }
    };

    function swatch(key, label, initial) {
      const input = h('input', { type: 'color', value: colors[key] || initial, 'aria-label': label });
      const reset = h('button', { class: 'link-btn', text: '恢复自动', hidden: !colors[key], onclick: () => {
        colors[key] = '';
        input.value = initial;
        reset.hidden = true;
        draw();
      } });
      input.addEventListener('input', () => {
        colors[key] = input.value;
        reset.hidden = false;
        draw();
      });
      return h('div', { class: 'row icon-color' }, h('span', { class: 'row-label', text: label }), input, reset);
    }

    function drawOptions() {
      if (kind.value === 'image') {
        options.replaceChildren(h('button', { class: 'btn icon-upload', text: picture ? '更换图片' : '选择图片', onclick: chooseImage }),
          control(fit, { key: 'value', label: '填充方式', options: [['contain', '完整'], ['cover', '铺满']] }, draw),
          advanced);
        advanced.replaceChildren(advanced.firstChild, swatch('iconBg', '底色', '#3c647e'));
      } else {
        const controls = [
          field(kind.value === 'auto' ? '备用文字' : '图标文字', caption),
          swatch('iconBg', '底色', '#3c647e'),
          swatch('iconFg', '字色', '#ffffff'),
        ];
        if (kind.value === 'auto') {
          advanced.replaceChildren(advanced.firstChild, ...controls.splice(0));
          lookup.replaceChildren(lookup.firstChild, provider, providerNote, fromSite);
          replacement.replaceChildren(replacement.firstChild, fromCache, lookup);
          controls.push(replacement);
          if (candidates.length) controls.push(h('div', { class: 'icon-candidates', 'aria-label': '可选图标' },
            candidates.map((icon, i) => h('button', {
              class: 'btn', title: '固定使用此图标', 'aria-label': `固定使用图标 ${i + 1}`,
              onclick: () => {
                picture = icon.data;
                pictureFill = '#' + icon.fill.split(' ').map((v) => Number(v).toString(16).padStart(2, '0')).join('');
                kind.value = 'image';
                fit.value = icon.fullBleed ? 'cover' : 'contain';
                syncModes();
                show('保存后将固定使用此图标');
                drawOptions();
              },
            }, h('img', { src: icon.data, alt: '' })))));
        } else {
          advanced.replaceChildren(advanced.firstChild, ...controls.splice(1));
        }
        controls.push(advanced);
        options.replaceChildren(...controls);
      }
      draw();
    }

    function cancelNetwork() {
      network?.abort();
      network = null;
    }
    let modes;
    function syncModes() {
      const next = control(kind, { key: 'value', label: '图标', options: [['auto', '自动'], ['image', '图片'], ['text', '手动']] }, () => {
        cancelNetwork();
        show();
        drawOptions();
        checkCache();
      });
      modes?.replaceWith(next);
      modes = next;
    }
    syncModes();
    provider.addEventListener('change', () => { assetOrigins = []; approvedOrigins = []; show(); draw(); });
    name.addEventListener('input', draw);
    caption.addEventListener('input', draw);
    url.addEventListener('input', () => { cancelNetwork(); assetOrigins = []; approvedOrigins = []; candidates = []; staged = null; show(); drawOptions(); });
    url.addEventListener('change', () => checkCache());
    drawOptions();

    const stopIconUpdates = on('icon', (key) => { if (key === iconKey(value().url)) draw(); });
    dialog = sheet({
      title: link ? '编辑链接' : '添加链接',
      body: [field('网址', url), h('div', { class: 'link-basic-fields' }, field('名称', name), field('所属分组', groupSelect)), h('div', { class: 'icon-editor' },
        h('div', { class: 'icon-editor-head' }, preview, modes), options, status),
        !link && h('button', { class: 'link-btn', text: '批量管理图标', onclick: manageIcons })],
      onClose: () => { closed = true; cancelNetwork(); stopIconUpdates(); },
      actions: [
        { label: '取消' },
        {
          label: link ? '保存' : '添加',
          primary: true,
          onClick: (close) => {
            const next = normalizeLink({ ...value(), slot: link?.slot });
            const destination = groups[Number(groupSelect.value)];
            if (!next) { toast('请输入有效的网址'); url.focus(); return; }
            if (kind.value === 'image' && !picture) { show('请先选择图片'); return; }
            if (!state.groups.includes(destination) || !state.groups.includes(group) || link && !group.links.includes(link)) {
              show('这个分组或链接已在另一标签页修改，请重新打开编辑窗口');
              return;
            }
            if (link) {
              if (fixed() || group.links.some((item) => item.slot !== undefined)) saveSlots(group.links);
              if (group === destination) {
                if (link.slot !== undefined) next.slot = link.slot;
                group.links[group.links.indexOf(link)] = next;
              } else {
                group.links.splice(group.links.indexOf(link), 1);
                delete next.slot;
                destination.links.push(next);
              }
            } else destination.links.push(next);
            if (fixed() || destination.links.some((item) => item.slot !== undefined)) saveSlots(destination.links);
            if (kind.value === 'auto' && staged) useSiteIcon(next.url, staged);
            close();
            changed();
          },
        },
      ],
    });
    (link ? name : url).focus();
    checkCache();
  }

  // ───────── 事件 ─────────
  el.addEventListener('click', (e) => {
    const a = e.target.closest('.tile');
    if (a && !/^https?:/.test(a.link.url)) {
      e.preventDefault();
      openUrl(a.link.url, state.layout.links.newTab || e.ctrlKey || e.metaKey || e.shiftKey);
    }
  });
  el.addEventListener('auxclick', (e) => {
    const a = e.target.closest('.tile');
    if (e.button === 1 && a && !/^https?:/.test(a.link.url)) {
      e.preventDefault();
      openUrl(a.link.url, true);
    }
  });

  el.addEventListener('contextmenu', (e) => {
    const a = e.target.closest('.tile');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const { link } = a;
    const group = a.parentNode.group;
    menu([
      { label: '在新标签页打开', onClick: () => openUrl(link.url, true) },
      { label: '编辑', onClick: () => editLink(link) },
      '-',
      { label: '删除', danger: true, onClick: () => removeLink(link, group) },
    ], { x: e.clientX, y: e.clientY });
  });

  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && !drag.active()) activate(state.groups.indexOf(tab.group));
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

  const drag = bindLinkDrag(el, {
    layer, current, fixed,
    hasGroup: (group) => state.groups.includes(group),
    layout: () => state.layout.links,
    preview: (group) => {
      el.classList.remove('drag-extend');
      previewGroup = group;
      render();
      syncPill();
      scheduleIcons();
    },
    drop: (link, from, to, destination) => {
      previewGroup = null;
      placeLink(link, from, to, destination, fixed());
      setActive(state.groups.indexOf(to));
      changed();
    },
  });

  sortable(tabsEl, {
    item: '.tab',
    onSort: () => {
      const active = current();
      state.groups = tabs().map((tab) => tab.group);
      setActive(state.groups.indexOf(active));
      save(true);
      syncPill();
    },
  });

  function manageIcons() {
    const { select: provider, note: providerNote } = iconSource();
    const pixels = Math.min(256, Math.max(96, Math.ceil(targetPixels())));
    const group = current();
    const scope = h('select', { class: 'input', 'aria-label': '查找范围' },
      h('option', { value: 'group', text: '当前分组' }), h('option', { value: 'all', text: '所有分组' }));
    let links = [];
    let generation = 0;
    let additional = [];
    let approved = [];
    let operation;
    const upgraded = new Set();
    const status = h('p', { class: 'note', role: 'status' });
    const message = h('p', { class: 'note', text: '仅更新缺失或低清的自动图标。' });
    const start = h('button', { class: 'btn primary', text: '查找高清图标', onclick: run });
    sheet({
      title: '管理链接图标', body: [field('范围', scope), field('来源', provider), providerNote, message, status, start],
      actions: [{ label: '关闭' }], onClose: () => { generation++; operation?.abort(); },
    });
    async function prepare() {
      const revision = ++generation;
      const eligible = (scope.value === 'all' ? allLinks() : group.links)
        .filter((link) => !link.icon && (provider.value === 'service' ? canUseIconService(link.url) : canFetchSiteIcon(link.url)));
      start.disabled = true;
      await primeIcons(eligible);
      if (revision !== generation) return;
      links = [...new Map(eligible.filter((link) => (automaticIcon(link.url)?.size || 0) < pixels)
        .map((link) => [iconKey(link.url), link])).values()];
      status.textContent = links.length ? `待检查 ${links.length} 个网址` : '没有待升级的自动图标';
      start.disabled = !links.length;
    }
    scope.addEventListener('change', prepare);
    provider.addEventListener('change', prepare);
    prepare();

    async function run() {
      start.disabled = true;
      scope.disabled = true;
      provider.disabled = true;
      status.textContent = '正在查找图标…';
      operation = new AbortController();
      const originsToRequest = [...new Set([...approved, ...additional])];
      const result = await fetchSiteIcons(links.map((link) => link.url), operation.signal, originsToRequest, provider.value,
        (done, total) => { status.textContent = '已检查 ' + done + ' / ' + total + ' 个站点'; });
      if (operation.signal.aborted) return;
      if (result.status !== 'done') {
        status.textContent = result.status === 'denied' ? '未获得访问权限' : '暂时无法获取，请稍后重试';
        start.disabled = false;
        if (!approved.length) { scope.disabled = false; provider.disabled = false; }
        return;
      }
      approved = originsToRequest;
      const remaining = [];
      const origins = new Set();
      for (const link of links) {
        if (operation.signal.aborted) return;
        const found = siteResult(result, link.url);
        const icon = found?.icons[0];
        const previous = automaticIcon(link.url)?.size || 0;
        if (icon && icon.size >= previous && (await useSiteIcon(link.url, icon)).used) upgraded.add(link.url);
        if (found?.origins.length && (automaticIcon(link.url)?.size || 0) < pixels) {
          remaining.push(link);
          found.origins.forEach((origin) => origins.add(origin));
        }
      }
      links = remaining;
      additional = [...origins];
      status.textContent = `已升级 ${upgraded.size} 个图标。`;
      if (additional.length) {
        status.textContent += `可继续查找网站声明的图片来源：${additional.map((origin) => new URL(origin).hostname).join('、')}`;
        start.textContent = '继续获取图片站图标';
        start.disabled = false;
      } else {
        start.hidden = true;
      }
    }
  }

  return {
    addLink: () => editLink(),
    reset: () => { drag.cancel(); grid = null; },
    dragging: drag.active,
    addGroup,
    step: (delta) => {
      const count = state.groups.length;
      return count > 1 && activate((local.active + delta + count) % count, delta);
    },
    wheelAllowed: (target) => state.layout.tabs.wheel && state.groups.length > 1
      && (!el.contains(target) || el.scrollHeight <= el.clientHeight + 1),
    loadIcons,
    links: {
      el, title: '链接', anchor: 'top', constrainWidth: true, render,
      options: (b, update) => {
        const icon = { size: b.icon || 0 };
        const nameColor = control(b, { key: 'labelColor', label: '名称字色', options: [['auto', '跟随页面'], ['light', '浅色'], ['dark', '深色']] }, update);
        nameColor.hidden = !b.labels;
        return [
          { key: 'arrangement', label: '排列方式', options: [['auto', '自动排列'], ['fixed', '固定位置']] },
          h('button', { class: 'btn fixed-only', text: '整理当前分组空位', onclick: () => {
            if (!fixed()) return;
            const group = current();
            const slots = linkSlots(group.links);
            [...group.links].sort((a, b) => slots.get(a) - slots.get(b)).forEach((link, slot) => { link.slot = slot; });
            changed();
          } }),
          { key: 'columns', label: '每行', min: 2, max: 14 },
          h('div', { class: 'auto-align' }, control(b, { key: 'align', label: '对齐', options: [['left', '左'], ['center', '中'], ['right', '右']] }, update)),
          { key: 'gap', label: '间距', min: .4, max: 4, step: .05, format: (v) => v.toFixed(1) },
          h('details', { class: 'icon-more' }, h('summary', { text: '图标与文字' }), h('div', { class: 'link-appearance' },
          control(b, { key: 'radius', label: '圆角', min: 0, max: 50, format: (v) => `${v}%` }, update),
          control(icon, { key: 'size', label: '图标占比', min: 0, max: .9, step: .01, format: (v) => (v < .2 ? '自动' : `${Math.round(v * 100)}%`) }, (final) => {
            b.icon = icon.size < .2 ? 0 : icon.size;
            update(final);
          }),
          control(b, { key: 'iconBackground', label: '图标底色', options: [['glass', '玻璃'], ['solid', '主色填充']] }, update),
          control(b, { key: 'labels', label: '显示名称' }, (final) => { nameColor.hidden = !b.labels; update(final); }),
          nameColor)),
          { key: 'newTab', label: '在新标签页打开' },
          h('button', { class: 'btn', text: '图标管理', onclick: manageIcons }),
        ].filter(Boolean);
      },
    },
    tabs: {
      el: tabsEl, title: '分组', constrainWidth: true, render: renderTabs,
      options: () => [
        { key: 'wheel', label: '滚轮切换分组' },
        h('p', { class: 'note', text: '方向键可循环切组。滚轮在可滚动的链接区内优先浏览链接。' }),
        h('p', { class: 'note', text: '双击分组名可重命名，拖动可排序。拖着链接悬停在分组名上，切换后继续拖到目标位置。' }),
      ],
    },
  };
}
