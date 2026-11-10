// 天气：默认关闭。开启后只向 Open-Meteo 发送一个精确到 0.1° 的坐标，
// 不带账号、Cookie 或来源页面；结果缓存 30 分钟。

import { local, saveLocal } from './store.js';

const TTL = 30 * 60 * 1000;
const STALE = 6 * 60 * 60 * 1000; // 超过 6 小时的旧数据不再显示
const TIMEOUT = 20 * 1000;
const RETRY = 60 * 1000; // 失败后至少间隔一分钟再试
let failedAt = 0;
let pending = null; // 进行中的请求，避免重复联网

/** WMO 天气代码 → [描述, 图标] */
export function describe(code, isDay) {
  if (code === 0) return ['晴', isDay ? 'sun' : 'moon'];
  if (code === 1) return ['少云', isDay ? 'partly' : 'moon'];
  if (code === 2) return ['多云', isDay ? 'partly' : 'cloud'];
  if (code === 3) return ['阴', 'cloud'];
  if (code === 45 || code === 48) return ['雾', 'fog'];
  if (code >= 51 && code <= 55) return ['毛毛雨', 'rain'];
  if (code === 56 || code === 57 || code === 66 || code === 67) return ['冻雨', 'rain'];
  if (code === 61) return ['小雨', 'rain'];
  if (code === 63) return ['中雨', 'rain'];
  if (code === 65) return ['大雨', 'rain'];
  if (code === 71) return ['小雪', 'snow'];
  if (code === 73) return ['中雪', 'snow'];
  if (code === 75 || code === 77) return ['大雪', 'snow'];
  if (code >= 80 && code <= 82) return ['阵雨', 'rain'];
  if (code === 85 || code === 86) return ['阵雪', 'snow'];
  if (code >= 95) return ['雷暴', 'thunder'];
  return ['—', 'cloud'];
}

const keyOf = (city) => `${city.lat},${city.lon}`;
const cached = (city, maxAge) => {
  const c = local.weather;
  return c && c.key === keyOf(city) && Date.now() - c.t < maxAge ? c.data : null;
};

/** 可立即显示的缓存数据。 */
export const cachedWeather = (city) => cached(city, STALE);

/** 获取天气；缓存有效期内不联网。失败时抛出异常。 */
export async function fetchWeather(city) {
  const fresh = cached(city, TTL);
  if (fresh) return fresh;
  if (pending?.key === keyOf(city)) return pending.promise;
  if (Date.now() - failedAt < RETRY) throw new Error('天气服务暂时不可用');
  const promise = request(city)
    .catch((err) => { failedAt = Date.now(); throw err; })
    .finally(() => { pending = null; });
  pending = { key: keyOf(city), promise };
  return promise;
}

async function request(city) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: city.lat,
    longitude: city.lon,
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: 1,
  });
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`天气服务返回 ${res.status}`);
  const json = await res.json();
  const data = {
    temp: json.current.temperature_2m,
    code: json.current.weather_code,
    isDay: json.current.is_day === 1,
    high: json.daily.temperature_2m_max[0],
    low: json.daily.temperature_2m_min[0],
  };
  local.weather = { key: keyOf(city), t: Date.now(), data };
  saveLocal('weather');
  return data;
}
