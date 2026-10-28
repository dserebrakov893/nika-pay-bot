import { config, verifyEnabled } from './config.js';
import { pool, saveEvent, getState, setState } from './db.js';
import { fetchObject, normalize } from './yookassa.js';
import { msgSucceeded, msgCanceled, msgRefund, msgWaiting, reasonText, esc, plural } from './format.js';
import { notifyOwners } from './notify.js';
import { todayTotals } from './analytics.js';

const HANDLED = new Set(['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture', 'refund.succeeded']);

// Ожидаемый статус объекта для каждого события
const EXPECTED_STATUS = {
  'payment.succeeded': 'succeeded',
  'payment.canceled': 'canceled',
  'payment.waiting_for_capture': 'waiting_for_capture',
  'refund.succeeded': 'succeeded',
};

export async function processNotification(body) {
  const event = body?.event;
  const obj = body?.object;
  if (body?.type !== 'notification' || !event || !obj?.id) {
    console.warn('[process] непонятное тело уведомления', JSON.stringify(body).slice(0, 300));
    return;
  }
  if (!HANDLED.has(event)) {
    console.log(`[process] событие ${event} пропущено`);
    return;
  }

  let actual = obj;
  let verified = false;
  if (verifyEnabled) {
    const kind = event.startsWith('refund.') ? 'refund' : 'payment';
    const fetched = await fetchObject(kind, obj.id);
    if (!fetched) {
      console.warn(`[process] ${obj.id} не найден в API, возможна подделка`);
      await notifyOwners(`⚠️ Пришло уведомление <code>${esc(event)}</code> о платеже, которого нет в ЮКассе (<code>${esc(obj.id)}</code>). Проигнорировал.`);
      return;
    }
    if (fetched.status !== EXPECTED_STATUS[event]) {
      console.warn(`[process] статус ${fetched.status} не совпадает с событием ${event}`);
      return;
    }
    actual = fetched;
    verified = true;
  }

  const row = normalize(event, actual, verified);

  // для возврата подтянем описание исходного платежа
  if (event === 'refund.succeeded' && !row.description) {
    const r = await pool.query(`SELECT description FROM yk_events WHERE object_id = $1 LIMIT 1`, [row.paymentId]);
    row.description = r.rows[0]?.description ?? null;
  }

  const isNew = await saveEvent(row);
  if (!isNew) return; // повторная доставка, уже уведомляли

  if (row.isTest && !config.notifyTest) return;

  let text;
  if (event === 'payment.succeeded') text = msgSucceeded(row, await todayTotals());
  else if (event === 'payment.canceled') text = msgCanceled(row);
  else if (event === 'refund.succeeded') text = msgRefund(row);
  else text = msgWaiting(row);

  // брошенные оплаты не будят ночью и днём приходят без звука
  const silent = event === 'payment.canceled' && row.cancelReason === 'expired_on_confirmation' ? true : undefined;
  await notifyOwners(text, { silent });

  if (!row.isTest) await checkAlerts(event);
}

// Тревога: несколько настоящих отказов подряд (брошенные оплаты не считаются)
async function checkAlerts(event) {
  if (event === 'payment.succeeded') {
    await setState('fail_alert_sent', '0');
    return;
  }
  if (event !== 'payment.canceled') return;

  const n = config.alertFailStreak;
  const { rows } = await pool.query(
    `SELECT event, cancel_reason, received_at FROM yk_events
     WHERE NOT is_test AND event IN ('payment.succeeded','payment.canceled')
       AND COALESCE(cancel_reason, '') <> 'expired_on_confirmation'
     ORDER BY received_at DESC LIMIT $1`,
    [n],
  );
  if (rows.length < n || rows.some((r) => r.event !== 'payment.canceled')) return;
  const spanMin = (rows[0].received_at - rows[n - 1].received_at) / 60000;
  if (spanMin > config.alertWindowMin) return;
  if ((await getState('fail_alert_sent')) === '1') return;

  const reasons = {};
  for (const r of rows) reasons[reasonText(r.cancel_reason)] = (reasons[reasonText(r.cancel_reason)] || 0) + 1;
  const list = Object.entries(reasons).map(([k, v]) => `· ${esc(k)}: ${v}`).join('\n');
  await notifyOwners(
    `🚨 <b>${n} ${plural(n, 'отказ', 'отказа', 'отказов')} подряд за ${Math.max(1, Math.round(spanMin))} мин</b>\n${list}\n\n` +
      'Если причины разные или это «технический сбой», похоже на проблему с оплатой в боте. ' +
      'Проверь тестовой оплатой и статус ЮКассы. Следующая тревога будет после первой успешной оплаты.',
    { silent: false },
  );
  await setState('fail_alert_sent', '1');
}
