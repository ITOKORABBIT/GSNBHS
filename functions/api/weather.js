import { get, json } from './_local.js';

// 舊社公園：臺中市官方避難收容處所清單座標。
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=24.181308&longitude=120.699549&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTaipei&forecast_days=1';
export async function onRequestGet() {
  const meta = { source: 'Open-Meteo 天氣預報', sourceUrl: 'https://open-meteo.com/', fetchedAt: new Date().toISOString() };
  try {
    const data = await (await get(URL, 600)).json();
    const current = data.current;
    if (!current || !Number.isFinite(current.temperature_2m) || !Number.isFinite(current.weather_code) || !data.daily?.time?.length) throw new Error('invalid weather');
    const updatedAt = current.time + '+08:00';
    if (!Number.isFinite(Date.parse(updatedAt)) || Math.abs(Date.now() - Date.parse(updatedAt)) > 2 * 3600000) throw new Error('stale weather');
    return json({ ok: true, meta: { ...meta, updatedAt }, current, daily: data.daily }, 200, 600);
  } catch {
    return json({ ok: false, meta, error: '天氣資料暫時無法取得' }, 502, 60);
  }
}
