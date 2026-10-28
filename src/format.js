import { fmtDayTime } from './time.js';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function rub(v, currency = 'RUB') {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  const s = n.toLocaleString('ru-RU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return currency === 'RUB' ? `${s} ₽` : `${s} ${currency}`;
}

export function pct(part, total) {
  if (!total) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

export const PARTY = {
  yoo_money: 'ЮКасса',
  payment_network: 'банк клиента или платёжная система',
  merchant: 'магазин (ты или бот)',
};

// Причины отмены из документации ЮКассы: текст + что с этим делать
export const REASONS = {
  insufficient_funds: ['не хватило денег', 'клиент может оплатить другой картой или по СБП'],
  '3d_secure_failed': ['не прошёл 3-D Secure', 'клиент не ввёл код из СМС или банк его не принял, пусть попробует ещё раз'],
  card_expired: ['карта просрочена', 'нужна другая карта'],
  invalid_card_number: ['неверный номер карты', 'опечатка при вводе, пусть повторит'],
  invalid_csc: ['неверный CVC', 'опечатка при вводе, пусть повторит'],
  fraud_suspected: ['антифрод заподозрил мошенничество', 'клиенту лучше оплатить другой картой или по СБП'],
  general_decline: ['банк отказал без объяснения', 'клиенту стоит позвонить в банк или взять другую карту'],
  call_issuer: ['банк просит клиента позвонить ему', 'клиенту нужно связаться с банком'],
  issuer_unavailable: ['банк клиента не ответил', 'временный сбой, обычно помогает повтор через пару минут'],
  payment_method_limit_exceeded: ['превышен лимит по карте', 'другая карта или СБП'],
  payment_method_restricted: ['операции по карте запрещены', 'другая карта или СБП'],
  country_forbidden: ['карта выпущена в запрещённой стране', 'нужна российская карта или СБП'],
  identification_required: ['кошелёк ЮMoney не идентифицирован', 'клиенту нужна другая оплата'],
  expired_on_confirmation: ['клиент не завершил оплату вовремя', 'это брошенная оплата, а не ошибка: можно напомнить о занятии'],
  expired_on_capture: ['истёк срок списания', 'платёж не подтвердили вовремя'],
  canceled_by_merchant: ['отменён магазином', 'отмена пришла с нашей стороны'],
  internal_timeout: ['технический сбой ЮКассы', 'если повторяется, пиши в поддержку ЮКассы'],
  permission_revoked: ['клиент отозвал разрешение на автоплатёж', 'это отток подписки'],
  unsupported_mobile_operator: ['оператор связи не поддерживается', 'другой способ оплаты'],
  deal_expired: ['сделка истекла', ''],
};

export function reasonText(reason) {
  return REASONS[reason]?.[0] ?? reason ?? 'причина не указана';
}

function footer(row) {
  const bits = [];
  if (row.object_created || row.objectCreated) bits.push(fmtDayTime(new Date(row.object_created || row.objectCreated)));
  bits.push(`<code>${esc(row.payment_id || row.paymentId)}</code>`);
  return `<i>${bits.join(' · ')}</i>`;
}

function testMark(row) {
  return row.isTest ?? row.is_test ? '🧪 <b>ТЕСТ</b> · ' : '';
}

function verifyMark(row) {
  return row.verified ? '' : '\n⚠️ <i>не перепроверено через API</i>';
}

export function msgSucceeded(row, today) {
  const lines = [
    `${testMark(row)}💰 <b>Оплата ${rub(row.amount, row.currency)}</b>`,
  ];
  if (row.description) lines.push(esc(row.description));
  if (row.methodTitle) lines.push(`💳 ${esc(row.methodTitle)}`);
  if (row.incomeAmount !== null && row.incomeAmount !== undefined) {
    lines.push(`На счёт: ${rub(row.incomeAmount, row.currency)} (комиссия ${rub(row.amount - row.incomeAmount, row.currency)})`);
  }
  if (today && !(row.isTest ?? row.is_test)) {
    lines.push(`\nСегодня: ${today.count} ${plural(today.count, 'оплата', 'оплаты', 'оплат')} на ${rub(today.sum)}`);
  }
  lines.push(footer(row) + verifyMark(row));
  return lines.join('\n');
}

export function msgCanceled(row) {
  const reason = row.cancelReason ?? row.cancel_reason;
  const party = row.cancelParty ?? row.cancel_party;
  const abandoned = reason === 'expired_on_confirmation';
  const head = abandoned ? '🛒 <b>Брошенная оплата' : '❌ <b>Оплата не прошла';
  const lines = [`${testMark(row)}${head} · ${rub(row.amount, row.currency)}</b>`];
  if (row.description) lines.push(esc(row.description));
  lines.push(`Причина: ${esc(reasonText(reason))}`);
  if (party && !abandoned) lines.push(`Кто отказал: ${esc(PARTY[party] ?? party)}`);
  const hint = REASONS[reason]?.[1];
  if (hint) lines.push(`👉 ${esc(hint)}`);
  if (row.methodTitle) lines.push(`💳 ${esc(row.methodTitle)}`);
  lines.push(footer(row) + verifyMark(row));
  return lines.join('\n');
}

export function msgRefund(row) {
  const lines = [`${testMark(row)}↩️ <b>Возврат ${rub(row.amount, row.currency)}</b>`];
  if (row.description) lines.push(esc(row.description));
  lines.push(`По платежу <code>${esc(row.paymentId)}</code>`);
  lines.push(footer({ ...row, paymentId: row.objectId }) + verifyMark(row));
  return lines.join('\n');
}

export function msgWaiting(row) {
  return [
    `${testMark(row)}⏳ <b>Ждёт подтверждения · ${rub(row.amount, row.currency)}</b>`,
    row.description ? esc(row.description) : null,
    'Деньги заморожены, платёж нужно подтвердить или отменить',
    footer(row) + verifyMark(row),
  ].filter(Boolean).join('\n');
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
