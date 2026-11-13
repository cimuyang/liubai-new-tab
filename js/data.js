// 导入与导出：收藏夹导入、备份与恢复、隐私一览。全部在本地完成。

import { DATA_VERSION, state, save, local, normalize, replaceState, listBackups, recoveryDraft } from './store.js';
import { h, svg, normalizeUrl, hostOf, pickFile, emit, today } from './dom.js';
import { sheet, confirm, toast, control } from './ui.js';

const countLinks = (data) => (data.groups || []).reduce((n, g) => n + (g.links?.length || 0), 0);

// ───────── 备份 ─────────
// 备份文件就是 state 本身：分组里嵌套链接，布局用窗口比例与倍数表示，不含任何缓存。
export function exportBackup(data = state) {
  const { version, ...content } = data;
  const backup = { format: 'liubai-backup', version, exported: today(), ...content };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  h('a', { href: url, download: `留白备份 ${today()}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('备份已保存到下载文件夹');
}

async function restore(data) {
  try {
    await replaceState(data);
    emit('data');
    toast(state.appearance.wallpaper === 'image' && !local.image ? '已恢复设置。请重新选择壁纸图片。' : '已恢复');
  } catch {
    toast('无法写入备份，当前设置仍可使用');
  }
}

async function restoreFile() {
  const picked = await pickFile('.json,application/json');
  if (!picked) return;
  if (picked.size > 16 * 1024 * 1024) { toast('备份文件超过 16 MB，无法导入'); return; }
  const data = await picked.text().then(JSON.parse).catch(() => null);
  if (data?.format !== 'liubai-backup') { toast('这不是留白的备份文件'); return; }
  if (data.version > DATA_VERSION) { toast('请更新留白后再恢复这份备份'); return; }
  const validGroups = Array.isArray(data.groups) && data.groups.every((group) => group && typeof group === 'object');
  const validLinks = validGroups && (data.blocks ? Array.isArray(data.links) : data.groups.every((group) => Array.isArray(group.links)));
  if (!validLinks) { toast('备份的分组或链接格式有误'); return; }
  const normalized = normalize(data);
  const count = countLinks(normalized);
  const skipped = (data.blocks ? data.links.length : countLinks(data)) - count;
  const date = typeof data.exported === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.exported) ? data.exported : '日期未知';
  confirm({
    title: '恢复这份备份？',
    note: `${date}，共 ${count} 个可恢复链接。${skipped > 0 ? `将跳过 ${skipped} 个无效链接。` : ''}当前的链接、分组和布局将被替换。`,
    label: '恢复',
    onConfirm: () => restore(normalized),
  });
}

// ───────── 面板 ─────────
export async function openData() {
  const backups = await listBackups().catch(() => ({}));
  const { weather } = state.layout;
  const bing = { off: '关闭', manual: '手动：只在浏览壁纸时连接', daily: '每日自动：每天连接一次' }[state.appearance.bing];
  const dialog = sheet({
    title: '导入与导出',
    body: [
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: '从收藏夹导入', onclick: () => { dialog.close(); importBookmarks(); } }),
        h('button', { class: 'btn', text: '导出备份', onclick: () => exportBackup() }),
        h('button', { class: 'btn', text: '从备份恢复', onclick: () => { dialog.close(); restoreFile(); } })),
      h('p', { class: 'note', text: '备份包含链接、自定义图标和布局设置。壁纸原图和自动图标缓存留在当前浏览器。' }),
      recoveryDraft && h('button', { class: 'btn', text: '导出本页未保存的改动', onclick: () => exportBackup(recoveryDraft) }),
      h('h3', { text: '自动备份' }),
      h('p', { class: 'note', text: '每天第一次打开时自动保存一份，保留最近 7 天。' }),
      ...Object.keys(backups).sort().reverse().map((day) => h('div', { class: 'row' },
        h('span', { class: 'row-label grow', text: `${day}　${countLinks(normalize(backups[day]))} 个链接` }),
        h('button', {
          class: 'link-btn',
          text: '恢复',
          onclick: () => confirm({
            title: `恢复到 ${day}？`,
            note: '链接、分组和布局将回到那天第一次打开时的状态。',
            label: '恢复',
            onConfirm: () => { dialog.close(); restore(backups[day]); },
          }),
        }))),
      h('h3', { text: '隐私' }),
      h('p', { class: 'note', text: `天气：${weather.visible ? '已开启，只向 Open-Meteo 发送约 10 公里精度的坐标' : '关闭'}` }),
      h('p', { class: 'note', text: `必应壁纸：${bing}` }),
      h('p', { class: 'note', text: '自动图标读取本地缓存。主动开始查找时，直接来源请求网站公开页面和图标；Icon Horse 来源会收到查询域名和请求 IP。请求不带 Cookie，结果保存在本机。' }),
    ],
    actions: [{ label: '完成', primary: true }],
  });
}

// ───────── 收藏夹 ─────────
/** 点击时才申请收藏夹权限，用完立即归还。 */
export async function importBookmarks() {
  const access = { permissions: ['bookmarks'] };
  let granted = false;
  try {
    granted = await chrome.permissions.request(access);
    if (!granted) { toast('没有获得读取收藏夹的权限'); return; }
    const [root] = await chrome.bookmarks.getTree();
    pickBookmarks(root?.children || []);
  } catch {
    toast('无法读取浏览器收藏夹');
  } finally {
    if (granted) await chrome.permissions.remove(access).catch(() => {});
  }
}

/** 把 [{ name, links }] 并入现有数据：同名分组合并，同一分组内网址去重。返回新增数量。 */
function merge(groups) {
  const blank = state.groups.length === 1 && !state.groups[0].links.length && state.groups[0]; // 首次使用时的空白分组
  let added = 0;
  for (const { name, links } of groups) {
    let target = state.groups.find((g) => g.name === name);
    if (!target) state.groups.push(target = { name, links: [] });
    const known = new Set(target.links.map((l) => l.url));
    for (const link of links) {
      if (known.has(link.url)) continue;
      known.add(link.url);
      const { slot, ...entry } = link;
      target.links.push(entry);
      added++;
    }
  }
  if (blank && !blank.links.length && state.groups.length > 1) state.groups = state.groups.filter((g) => g !== blank);
  save(true);
  emit('data');
  return added;
}

function pickBookmarks(roots) {
  const checked = new Set();
  const leafBoxes = new Map(); // 收藏 id → 复选框
  const folderBoxes = []; // { box, ids }
  const usable = (node) => !!normalizeUrl(node.url);
  const leaves = (node) => (node.url ? (usable(node) ? [node] : []) : (node.children || []).flatMap(leaves));
  const options = { byFolder: true };
  let dialog = null;

  const sync = () => {
    for (const [id, box] of leafBoxes) box.checked = checked.has(id);
    for (const { box, ids } of folderBoxes) {
      const n = ids.filter((id) => checked.has(id)).length;
      box.checked = n > 0 && n === ids.length;
      box.indeterminate = n > 0 && n < ids.length;
    }
    if (!dialog) return;
    dialog.primary.textContent = checked.size ? `导入 ${checked.size} 个` : '导入';
    dialog.primary.disabled = !checked.size;
  };
  const check = (ids, on) => { for (const id of ids) { if (on) checked.add(id); else checked.delete(id); } sync(); };

  function row(node, open = false) {
    const box = h('input', { type: 'checkbox' });
    if (node.url) {
      if (!usable(node)) return null;
      box.addEventListener('change', () => check([node.id], box.checked));
      leafBoxes.set(node.id, box);
      return h('label', { class: 'tree-row' },
        h('span', { class: 'twist' }), box,
        h('span', { class: 'tree-name', text: node.title || hostOf(node.url) }),
        h('span', { class: 'tree-meta', text: hostOf(node.url) }));
    }
    const ids = leaves(node).map((n) => n.id);
    if (!ids.length) return null;
    const kids = h('div', { class: 'tree-kids', hidden: true });
    const twist = h('button', { class: 'twist' }, svg('chevron'));
    const expand = () => {
      if (!kids.children.length) { // 展开时才生成子节点，收藏很多时也不卡
        kids.append(...node.children.map((child) => row(child)).filter(Boolean));
        sync();
      }
      kids.hidden = !kids.hidden;
      twist.classList.toggle('open', !kids.hidden);
    };
    box.addEventListener('change', () => check(ids, box.checked));
    folderBoxes.push({ box, ids });
    twist.addEventListener('click', expand);
    if (open) expand();
    return h('div', null,
      h('div', { class: 'tree-row folder' }, twist, box,
        h('span', { class: 'tree-name', text: node.title || '未命名文件夹', onclick: expand }),
        h('span', { class: 'tree-meta', text: `${ids.length}` })),
      kids);
  }

  function run(close) {
    const groups = new Map();
    const visit = (node, folder) => {
      if (!node.url) { for (const child of node.children || []) visit(child, node.title || folder); return; }
      if (!checked.has(node.id)) return;
      const name = options.byFolder ? folder : state.groups[local.active].name;
      if (!groups.has(name)) groups.set(name, { name, links: [] });
      groups.get(name).links.push({ name: (node.title || '').slice(0, 64), url: normalizeUrl(node.url) });
    };
    for (const root of roots) visit(root, '收藏夹');
    close();
    const added = merge([...groups.values()]);
    toast(added ? `已导入 ${added} 个链接` : '这些链接已经全部导入过了');
  }

  dialog = sheet({
    title: '从收藏夹导入',
    note: '勾选要放到标签页上的收藏。这是一次性复制，之后不会再读取收藏夹。',
    body: [
      h('div', { class: 'tree' }, roots.map((root, i) => row(root, i === 0)).filter(Boolean)),
      control(options, { key: 'byFolder', label: '按文件夹建立分组' }, () => {}),
    ],
    actions: [{ label: '取消' }, { label: '导入', primary: true, onClick: run }],
  });
  sync();
}
