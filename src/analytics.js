import { pool } from './db.js';
import { esc, rub, pct, plural, reasonText } from './format.js';
import { fmtDay, fmtDayTime, fmtMonth, mskDayStart, mskWeekStart, mskMonthStart, mskYmd } from './time.js';
import { siteStats, landingLines } from './metrika.js';

// Все отчёты считаются только по боевым (не тестовым) платежам.
// Время платежа: момент события (received_at), он ближе всего к реальному моменту оплаты.

export async function stats(from, to) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event = 'payment.succeeded')                       AS ok_count,
       COALESCE(SUM(amount) FILTER (WHERE event = 'payment.succeeded'), 0)       AS ok_sum,
       COALESCE(SUM(income_amount) FILTER (WHERE event = 'payment.succeeded'), 0) AS income_sum,
       COUNT(*) FILTER (WHERE event = 'payment.canceled' AND cancel_reason <> 'expired_on_confirmation') AS fail_count,
       COUNT(*) FILTER (WHERE event = 'payment.canceled' AND cancel_reason = 'expired_on_confirmation')  AS abandoned_count,
       COALESCE(SUM(amount) FILTER (WHERE event = 'payment.canceled'), 0)         AS lost_sum,
       COUNT(*) FILTER (WHERE event = 'refund.succeeded')                        AS refund_count,
       COALESCE(SUM(amount) FILTER (WHERE event = 'refund.succeeded'), 0)        AS refund_sum
     FROM yk_events
     WHERE NOT is_test AND received_at >= $1 AND received_at < $2`,
    [from, to],
  );
  const r = rows[0];
  const s = {
    okCount: Number(r.ok_count),
    okSum: Number(r.ok_sum),
    incomeSum: Number(r.income_sum),
    failCount: Number(r.fail_count),
    abandonedCount: Number(r.abandoned_count),
    lostSum: Number(r.lost_sum),
    refundCount: Number(r.refund_count),
    refundSum: Number(r.refund_sum),
  };
  s.attempts = s.okCount + s.failCount + s.abandonedCount;
  s.avg = s.okCount ? s.okSum / s.okCount : 0;
  return s;
}

async function reasons(from, to) {
  const { rows } = await pool.query(
    `SELECT cancel_reason, COUNT(*)::int AS n FROM yk_events
     WHERE NOT is_test AND event = 'payment.canceled' AND received_at >= $1 AND received_at < $2
     GROUP BY cancel_reason ORDER BY n DESC`,
    [from, to],
  );
  return rows;
}

async function products(from, to, limit = 5) {
  const { rows } = await pool.query(
    `SELECT COALESCE(description, 'без описания') AS name, COUNT(*)::int AS n, SUM(amount) AS sum
     FROM yk_events
     WHERE NOT is_test AND event = 'payment.succeeded' AND received_at >= $1 AND received_at < $2
     GROUP BY 1 ORDER BY sum DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

async function methods(from, to) {
  const { rows } = await pool.query(
    `SELECT COALESCE(method_type, '?') AS m, COUNT(*)::int AS n FROM yk_events
     WHERE NOT is_test AND event = 'payment.succeeded' AND received_at >= $1 AND received_at < $2
     GROUP BY 1 ORDER BY n DESC`,
    [from, to],
  );
  return rows;
}

const METHOD_SHORT = { bank_card: 'карта', sbp: 'СБП', sberbank: 'SberPay', yoo_money: 'ЮMoney', tinkoff_bank: 'T-Pay' };

function delta(cur, prev) {
  if (!prev) return cur ? 'было 0' : 'без изменений';
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return 'без изменений';
  return `${d > 0 ? '+' : ''}${d}%`;
}

// Полный отчёт за период + сравнение с предыдущим периодом той же длины
export async function report(title, from, to, prevFrom, prevTo, prevLabel) {
  const [s, prev, rs, ps, ms] = await Promise.all([
    stats(from, to),
    stats(prevFrom, prevTo),
    reasons(from, to),
    products(from, to),
    methods(from, to),
  ]);

  const L = [`📊 <b>${esc(title)}</b>`, ''];

  if (!s.attempts && !s.refundCount) {
    L.push('Платежей не было.');
    if (prev.okCount) L.push(`${prevLabel}: ${rub(prev.okSum)} (${prev.okCount} ${plural(prev.okCount, 'оплата', 'оплаты', 'оплат')})`);
    return L.join('\n');
  }

  L.push(`<b>Выручка: ${rub(s.okSum)}</b> · ${s.okCount} ${plural(s.okCount, 'оплата', 'оплаты', 'оплат')}`);
  if (s.incomeSum) L.push(`На счёт после комиссии: ${rub(s.incomeSum)}`);
  if (s.okCount) L.push(`Средний чек: ${rub(Math.round(s.avg))}`);
  if (s.refundCount) L.push(`Возвраты: ${s.refundCount} на ${rub(s.refundSum)} · чистыми ${rub(s.okSum - s.refundSum)}`);

  L.push('');
  L.push(`Дошли до оплаты: ${s.attempts} · успешно ${pct(s.okCount, s.attempts)}`);
  if (s.failCount) L.push(`Отказы банка/платёжки: ${s.failCount}`);
  if (s.abandonedCount) L.push(`Брошенные оплаты: ${s.abandonedCount}`);
  if (s.lostSum) L.push(`Не дошло до кассы: ${rub(s.lostSum)}`);

  if (rs.length) {
    L.push('', '<b>Почему не оплатили</b>');
    for (const r of rs) L.push(`· ${esc(reasonText(r.cancel_reason))}: ${r.n}`);
  }

  if (ps.length > 1 || (ps.length === 1 && s.okCount > 1)) {
    L.push('', '<b>Что покупали</b>');
    for (const p of ps) L.push(`· ${esc(p.name)}: ${p.n} × на ${rub(p.sum)}`);
  }

  if (ms.length > 1) {
    L.push('', `Способы: ${ms.map((m) => `${METHOD_SHORT[m.m] ?? m.m} ${m.n}`).join(', ')}`);
  }

  L.push('', `<i>${esc(prevLabel)}: ${rub(prev.okSum)} (${delta(s.okSum, prev.okSum)})</i>`);
  return L.join('\n');
}

const DAY = 24 * 60 * 60 * 1000;

export function todayReport(now = new Date()) {
  const from = mskDayStart(now);
  // сравнение с тем же отрезком дня неделю назад
  return report(`Сегодня · ${fmtDay(now)}`, from, now, new Date(from - 7 * DAY), new Date(now - 7 * DAY), 'Неделю назад к этому часу');
}

export function dayReport(dayStart) {
  const to = new Date(+dayStart + DAY);
  return report(`Итоги дня · ${fmtDay(dayStart)}`, dayStart, to, new Date(dayStart - 7 * DAY), new Date(to - 7 * DAY), 'Тот же день неделю назад');
}

export function weekReport(now = new Date()) {
  const from = mskWeekStart(now);
  return report(`Неделя с ${fmtDay(from)}`, from, now, new Date(from - 7 * DAY), new Date(now - 7 * DAY), 'Прошлая неделя к этому моменту');
}

export function lastWeekReport(now = new Date()) {
  const to = mskWeekStart(now);
  const from = new Date(to - 7 * DAY);
  return report(`Итоги недели · ${fmtDay(from)} – ${fmtDay(new Date(to - 1))}`, from, to, new Date(from - 7 * DAY), from, 'Неделей раньше');
}

// Блок «Лендинг стретча» для итогов: визиты и заявки из Метрики, оплаты из базы бота
export async function landingBlock(from, to) {
  const [site, s] = await Promise.all([
    siteStats(mskYmd(from), mskYmd(new Date(to - 1))),
    stats(from, to),
  ]);
  return landingLines(site, s.okCount);
}

export function monthReport(now = new Date()) {
  const from = mskMonthStart(now);
  const prevFrom = mskMonthStart(now, -1);
  const elapsed = now - from;
  return report(fmtMonth(now), from, now, prevFrom, new Date(+prevFrom + elapsed), 'Прошлый месяц за те же дни');
}

export async function lastPayments(limit = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM yk_events WHERE event IN ('payment.succeeded','refund.succeeded')
     ORDER BY received_at DESC LIMIT $1`,
    [limit],
  );
  if (!rows.length) return 'Платежей пока нет.';
  const L = ['🧾 <b>Последние оплаты</b>', ''];
  for (const r of rows) {
    const icon = r.event === 'refund.succeeded' ? '↩️' : '💰';
    const test = r.is_test ? ' 🧪' : '';
    L.push(`${icon} ${rub(r.amount)} · ${esc(r.description ?? '')}${test}\n   <i>${fmtDayTime(r.received_at)}</i>`);
  }
  return L.join('\n');
}

export async function lastFails(limit = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM yk_events WHERE event = 'payment.canceled' ORDER BY received_at DESC LIMIT $1`,
    [limit],
  );
  if (!rows.length) return 'Отказов не было 👌';
  const L = ['❌ <b>Последние отказы</b>', ''];
  for (const r of rows) {
    const test = r.is_test ? ' 🧪' : '';
    L.push(`· ${rub(r.amount)}: ${esc(reasonText(r.cancel_reason))}${test}\n   <i>${fmtDayTime(r.received_at)}${r.method_title ? ' · ' + esc(r.method_title) : ''}</i>`);
  }
  return L.join('\n');
}

export async function todayTotals(now = new Date()) {
  const s = await stats(mskDayStart(now), new Date(+now + 1000));
  return { count: s.okCount, sum: s.okSum };
}
