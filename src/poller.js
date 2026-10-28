import { verifyEnabled } from './config.js';
import { getState, setState } from './db.js';
import { listObjects } from './yookassa.js';
import { enqueue, handleEvent } from './processor.js';
import { notifyOwners } from './notify.js';
import { esc, plural, rub } from './format.js';
import { fmtDayTime } from './time.js';

// По платежам, которые создаёт Telegram, ЮКасса не шлёт HTTP-уведомления в наш магазин.
// Поэтому раз в минуту сами спрашиваем API о платежах и возвратах за последние сутки.
// Повторы отсекает база (уникальность event + object_id), так что вебхуки и опрос не дублируют друг друга.
const LOOKBACK_MS = 24 * 3600_000;

const PAYMENT_EVENTS = {
  succeeded: 'payment.succeeded',
  canceled: 'payment.canceled',
  waiting_for_capture: 'payment.waiting_for_capture',
};

// момент оплаты точнее момента создания
const eventTime = (obj) => new Date(obj.captured_at || obj.created_at);

async function collect() {
  const params = { 'created_at.gte': new Date(Date.now() - LOOKBACK_MS).toISOString() };
  const [payments, refunds] = await Promise.all([listObjects('payment', params), listObjects('refund', params)]);
  const items = [];
  for (const p of payments) if (PAYMENT_EVENTS[p.status]) items.push({ event: PAYMENT_EVENTS[p.status], obj: p });
  for (const r of refunds) if (r.status === 'succeeded') items.push({ event: 'refund.succeeded', obj: r });
  items.sort((a, b) => eventTime(a.obj) - eventTime(b.obj));
  return items;
}

async function tick() {
  const items = await collect();
  // при первом запуске сутки истории только записываем, иначе придёт пачка старых уведомлений
  const backfill = (await getState('poll_started')) === null;

  const found = await enqueue(async () => {
    const fresh = [];
    for (const { event, obj } of items) {
      if (await handleEvent(event, obj, true, { receivedAt: eventTime(obj), backfill })) fresh.push({ event, obj });
    }
    return fresh;
  });

  await setState('poll_ok', new Date().toISOString());
  if (await getState('poll_error')) await setState('poll_error', '');

  if (backfill) {
    await setState('poll_started', new Date().toISOString());
    await notifyOwners(backfillText(found), { silent: false });
  }
}

function backfillText(found) {
  const real = found.filter((f) => !f.obj.test);
  const paid = real.filter((f) => f.event === 'payment.succeeded');
  const fails = real.filter((f) => f.event === 'payment.canceled');
  const sum = paid.reduce((s, f) => s + Number(f.obj.amount?.value ?? 0), 0);
  const L = ['🔄 <b>Подключил опрос ЮКассы</b>', 'Раз в минуту сам проверяю новые платежи, отказы и возвраты.', ''];
  if (!found.length) {
    L.push('За последние сутки платежей в API не нашёл. Если оплата точно была, проверь, что ключи от того же магазина.');
  } else {
    L.push(
      `За последние сутки: ${paid.length} ${plural(paid.length, 'оплата', 'оплаты', 'оплат')} на ${rub(sum)}, ` +
        `${fails.length} ${plural(fails.length, 'отказ', 'отказа', 'отказов')}.`,
    );
    const last = found[found.length - 1];
    L.push(`Последнее: ${rub(last.obj.amount?.value)} · ${esc(last.obj.description ?? '')} · ${fmtDayTime(eventTime(last.obj))}`);
    L.push('', 'Они записаны в аналитику без отдельных уведомлений. Новые будут приходить в течение минуты.');
  }
  return L.join('\n');
}

// Об ошибке опроса пишем один раз, пока она не сменится или не пройдёт
async function reportError(e) {
  console.error('[poller]', e.message);
  const text = String(e.message).slice(0, 300);
  if ((await getState('poll_error')) === text) return;
  await setState('poll_error', text);
  await notifyOwners(`⚠️ Не получилось опросить ЮКассу:\n<code>${esc(text)}</code>\n\nЕсли там 401, проверь YK_SHOP_ID и YK_SECRET_KEY.`);
}

export function startPoller() {
  if (!verifyEnabled) {
    console.warn('[poller] YK_SHOP_ID / YK_SECRET_KEY не заданы: опрос API выключен');
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      await reportError(e).catch((err) => console.error('[poller]', err));
    } finally {
      running = false;
    }
  };
  setTimeout(run, 3_000);
  setInterval(run, 60_000);
}
