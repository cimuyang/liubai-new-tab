// 组件：时间、日期、搜索、天气。

import { state, local, saveLocal } from './store.js';
import { h, svg, hostOf, normalizeUrl, openUrl, emit } from './dom.js';
import { iconNode } from './icons.js';
import { describe, cachedWeather, fetchWeather } from './weather.js';

const pad = (n) => String(n).padStart(2, '0');
const note = (text) => h('p', { class: 'note', text });

/** 画一次，并在内容下一次变化的时刻再画。标签页不可见或组件隐藏时不计时。 */
function ticking(id, draw, delay) {
  let timer = 0;
  const render = () => {
    clearTimeout(timer);
    if (!state.layout[id].visible) return;
    draw();
    if (!document.hidden) timer = setTimeout(render, delay() + 4);
  };
  document.addEventListener('visibilitychange', render);
  return render;
}

// ───────── 时间 ─────────
export function createClock() {
  const ampm = h('small', { class: 'ampm' });
  const main = h('span');
  const sec = h('small');
  const el = h('div', { class: 'clock' }, ampm, main, sec);

  const render = ticking('clock', () => {
    const b = state.layout.clock;
    const now = new Date();
    const hours = b.hour24 ? pad(now.getHours()) : now.getHours() % 12 || 12;
    main.textContent = `${hours}:${pad(now.getMinutes())}`;
    ampm.textContent = now.getHours() < 12 ? '上午' : '下午';
    ampm.hidden = b.hour24;
    sec.textContent = pad(now.getSeconds());
    sec.hidden = !b.seconds;
    el.style.setProperty('--wght', b.weight);
  }, () => {
    const unit = state.layout.clock.seconds ? 1000 : 60000; // 不显示秒时，每分钟才醒来一次
    return unit - Date.now() % unit;
  });

  return {
    el, title: '时间', render,
    options: () => [
      { key: 'hour24', label: '24 小时制' },
      { key: 'seconds', label: '显示秒' },
      { key: 'weight', label: '字重', options: [[200, '纤细'], [300, '细'], [500, '中'], [700, '粗']] },
    ],
  };
}

// ───────── 日期 ─────────
const WEEK = '日一二三四五六';
const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
const lunarFormat = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });

/** 农历日期，使用浏览器内置的历法数据，无需联网。 */
function lunar(date) {
  const parts = Object.fromEntries(lunarFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return parts.month + LUNAR_DAYS[parseInt(parts.day, 10) - 1];
}

export function createDate() {
  const el = h('div', { class: 'date' });
  const render = ticking('date', () => {
    const b = state.layout.date;
    const now = new Date();
    const [y, m, d, w] = [now.getFullYear(), now.getMonth() + 1, now.getDate(), WEEK[now.getDay()]];
    const text = { full: `${y}年${m}月${d}日 星期${w}`, short: `${m}/${d} 周${w}` }[b.format] || `${m}月${d}日 星期${w}`;
    el.textContent = text + (b.lunar ? ` · ${lunar(now)}` : '');
  }, () => new Date().setHours(24, 0, 0, 0) - Date.now()); // 到午夜再更新
  return {
    el, title: '日期', render,
    options: () => [
      { key: 'format', label: '格式', options: [['long', '月日'], ['full', '年月日'], ['short', '简短']] },
      { key: 'lunar', label: '显示农历' },
    ],
  };
}

// ───────── 搜索 ─────────
const looksLikeUrl = (text) => /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(text);

/** 在自己的链接中查找；名称或域名以输入开头的排在前面。 */
function matchLinks(query) {
  const q = query.toLowerCase();
  return state.groups.flatMap((g) => g.links)
    .map((link) => {
      const name = link.name.toLowerCase();
      const host = hostOf(link.url);
      return { link, prefix: name.startsWith(q) || host.startsWith(q), hit: name.includes(q) || host.includes(q) };
    })
    .filter((m) => m.hit)
    .sort((a, b) => b.prefix - a.prefix)
    .slice(0, 5);
}

export function createSearch() {
  const input = h('input', { type: 'text', placeholder: '搜索', spellcheck: false, autocomplete: 'off', 'aria-label': '搜索' });
  const list = h('div', { class: 'suggest', hidden: true });
  const el = h('div', { class: 'search' }, h('label', { class: 'search-box' }, svg('search'), input), list);
  let rows = [];
  let active = 0;

  function suggest() {
    const text = input.value.trim();
    list.hidden = !text;
    if (!text) { rows = []; return; }
    const hits = matchLinks(text);
    const url = looksLikeUrl(text) && normalizeUrl(text);
    rows = [
      ...hits.map(({ link }) => ({ link, label: link.name || hostOf(link.url), hint: hostOf(link.url), run: () => openUrl(link.url) })),
      url
        ? { label: text, hint: '打开网址', icon: 'globe', run: () => openUrl(url) }
        : { label: text, hint: '搜索', icon: 'search', run: () => chrome.search.query({ text, disposition: 'CURRENT_TAB' }) }, // 浏览器的默认搜索引擎
    ];
    active = hits[0]?.prefix ? 0 : rows.length - 1; // 输入与某个链接的开头吻合时默认选中它，否则默认搜索
    draw();
  }

  function draw() {
    list.replaceChildren(...rows.map((row, i) => h('button', {
      class: `sg${i === active ? ' on' : ''}`,
      onpointerdown: (e) => e.preventDefault(), // 不让输入框失焦
      onclick: row.run,
      onpointermove: () => { if (active !== i) { active = i; draw(); } },
    },
    row.link ? iconNode(row.link, 'sg-icon') : h('span', { class: 'sg-icon' }, svg(row.icon)),
    h('span', { class: 'sg-name', text: row.label }),
    h('span', { class: 'sg-hint', text: row.hint }))));
  }

  input.addEventListener('input', suggest);
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', () => { list.hidden = true; });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 输入法选字时的回车不触发搜索
    if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[active].run();
    }
  });

  return {
    el, title: '搜索', input,
    render() { el.style.setProperty('--w', state.layout.search.width); },
    options: () => [
      { key: 'width', label: '宽度', min: 16, max: 60 },
      note('使用浏览器的默认搜索引擎。输入时先匹配你的链接，回车直达。'),
    ],
  };
}

// ───────── 天气 ─────────
export function createWeather() {
  const el = h('a', { class: 'weather', href: 'https://www.msn.com/zh-cn/weather/forecast/', rel: 'noreferrer' });
  const temp = (celsius) => `${Math.round(state.layout.weather.unit === 'F' ? celsius * 9 / 5 + 32 : celsius)}°`;
  const message = (text) => el.replaceChildren(h('span', { class: 'wx-note', text }));

  function show(data) {
    const b = state.layout.weather;
    const [text, icon] = describe(data.code, data.isDay);
    el.replaceChildren(
      h('div', { class: 'wx-main' }, svg(icon), h('span', { text: temp(data.temp) })),
      h('div', { class: 'wx-sub', text: `${b.city.name} · ${text}${b.range ? `　${temp(data.low)} / ${temp(data.high)}` : ''}` }),
    );
  }

  function render() {
    const { visible, city } = state.layout.weather;
    if (!visible) return; // 关闭时不发出任何请求
    if (!city) { message('选择城市'); return; }
    const cached = cachedWeather(city);
    if (cached) show(cached); else message(city.name);
    fetchWeather(city)
      .then((data) => { if (state.layout.weather.visible && state.layout.weather.city === city && data !== cached) show(data); })
      .catch(() => { if (!cached) message(`${city.name} · 暂时无法获取天气`); });
  }

  el.addEventListener('click', (e) => {
    if (!state.layout.weather.city) { e.preventDefault(); emit('edit', 'weather'); }
  });
  // 回到标签页或每 10 分钟检查一次；实际联网频率受 30 分钟缓存限制
  setInterval(() => { if (!document.hidden) render(); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  function cityPicker(b, update) {
    const input = h('input', { class: 'input', placeholder: '输入城市，如：杭州', value: b.city?.name || '', spellcheck: false });
    const results = h('div', { class: 'city-list' });
    const find = async () => (await import('./cities.js')).searchCities(input.value); // 城市表用到时才加载
    const choose = (city) => {
      b.city = city;
      local.weather = null;
      saveLocal('weather');
      input.value = city.name;
      results.replaceChildren();
      update();
    };
    input.addEventListener('input', async () => {
      results.replaceChildren(...(await find()).map((city) => h('button', { text: city.name, onclick: () => choose(city) })));
    });
    input.addEventListener('keydown', async (e) => {
      const first = e.key === 'Enter' && !e.isComposing && (await find())[0];
      if (first) choose(first);
    });
    return h('div', null, input, results);
  }

  return {
    el, title: '天气', render,
    options: (b, update) => [
      cityPicker(b, update),
      { key: 'unit', label: '单位', options: [['C', '摄氏 °C'], ['F', '华氏 °F']] },
      { key: 'range', label: '显示最低 / 最高温' },
      note('城市在本地换算为约 10 公里精度的坐标，只有这个坐标会发送给 Open-Meteo。找不到城市时可直接输入「纬度, 经度」。点击天气可打开 MSN 天气。'),
    ],
  };
}
