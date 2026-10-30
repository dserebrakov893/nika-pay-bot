import { config, metrikaEnabled } from './config.js';
import { esc, plural } from './format.js';
import { mskDayStart, mskYmd } from './time.js';

// Яндекс Метрика: посещаемость лендинга стретча.
// Счётчик стоит только на этой странице, поэтому все его визиты — визиты лендинга.
// Границы дат считаем по Москве; сами отчёты Метрика строит в часовом поясе счётчика,
// поэтому в настройках счётчика должна стоять Москва.

const API_TIMEOUT_MS = Number(process.env.METRIKA_API_TIMEOUT_MS) || 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
export const UNAVAILABLE = 'Метрика недоступна';

const cache = new Map();

function metrics() {
  const list = ['ym:s:visits', 'ym:s:users'];
  if (config.metrikaGoalId) list.push(`ym:s:goal${config.metrikaGoalId}reaches`);
  return list;
}

async function apiGet(date1, date2) {
  const params = new URLSearchParams({
    ids: config.metrikaCounterId,
    metrics: metrics().join(','),
    date1,
    date2,
    accuracy: 'full',
  });
  const root = process.env.METRIKA_API_ROOT || 'https://api-metrika.yandex.net';
  const res = await fetch(`${root}/stat/v1/data?${params}`, {
    headers: { Authorization: `OAuth ${config.metrikaToken}` },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Metrika API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Визиты, посетители и заявки за даты YYYY-MM-DD включительно.
// null — Метрика не подключена или не ответила: бот от этого не падает.
export async function siteStats(date1, date2) {
  if (!metrikaEnabled) return null;
  const key = `${date1}|${date2}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const json = await apiGet(date1, date2);
    const t = json.totals ?? json.data?.[0]?.metrics;
    if (!Array.isArray(t)) throw new Error('Metrika API: в ответе нет totals');
    const value = {
      visits: Number(t[0] ?? 0),
      users: Number(t[1] ?? 0),
      leads: config.metrikaGoalId ? Number(t[2] ?? 0) : null,
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.error('[metrika]', e.message);
    return null;
  }
}

function line(title, s) {
  if (!s) return `<b>${esc(title)}:</b> ${UNAVAILABLE}`;
  const parts = [
    `${s.visits} ${plural(s.visits, 'визит', 'визита', 'визитов')}`,
    `${s.users} ${plural(s.users, 'посетитель', 'посетителя', 'посетителей')}`,
  ];
  if (s.leads !== null) parts.push(`${s.leads} ${plural(s.leads, 'заявка', 'заявки', 'заявок')}`);
  return `<b>${esc(title)}:</b> ${parts.join(' · ')}`;
}

// Команда /site
export async function siteReport(now = new Date()) {
  if (!metrikaEnabled) return '🌐 <b>Лендинг стретча</b>\n\nМетрика не подключена: задай METRIKA_TOKEN.';
  const today = mskYmd(now);
  const yesterday = mskYmd(mskDayStart(now, -1));
  const weekAgo = mskYmd(mskDayStart(now, -6));
  const [a, b, c] = await Promise.all([
    siteStats(today, today),
    siteStats(yesterday, yesterday),
    siteStats(weekAgo, today),
  ]);
  const L = ['🌐 <b>Лендинг стретча</b>', '', line('Сегодня', a), line('Вчера', b), line('7 дней', c)];
  if (!config.metrikaGoalId) L.push('', '<i>Заявки появятся, когда будет задан METRIKA_GOAL_ID.</i>');
  return L.join('\n');
}

// «3,2%»: на лендинге конверсия маленькая, целые проценты её съедают
function conversion(part, total) {
  if (!total) return '—';
  return `${((part / total) * 100).toFixed(1).replace('.', ',')}%`;
}

// Блок для итогов дня и недели. Без токена пусто: отчёт выглядит как раньше.
export function landingLines(site, payments) {
  if (!metrikaEnabled) return '';
  if (!site) return `\n\n🌐 <b>Лендинг стретча</b>\n${UNAVAILABLE}`;
  const leads = site.leads === null ? '' : `${site.leads} ${plural(site.leads, 'заявка', 'заявки', 'заявок')} → `;
  return [
    '',
    '',
    '🌐 <b>Лендинг стретча</b>',
    `${site.visits} ${plural(site.visits, 'визит', 'визита', 'визитов')} → ${leads}${payments} ${plural(payments, 'оплата', 'оплаты', 'оплат')}`,
    `Конверсия визит→оплата: ${conversion(payments, site.visits)}`,
  ].join('\n');
}
