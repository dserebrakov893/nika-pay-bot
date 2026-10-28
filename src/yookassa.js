import net from 'node:net';
import { config, verifyEnabled } from './config.js';

// Адреса, с которых ЮКасса шлёт HTTP-уведомления (yookassa.ru/developers/using-api/webhooks)
const YK_NETS = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.156.11/32',
  '77.75.156.35/32',
  '77.75.154.128/25',
  '2a02:5180::/32',
];

const blockList = new net.BlockList();
for (const cidr of YK_NETS) {
  const [addr, prefix] = cidr.split('/');
  const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
  blockList.addSubnet(addr, Number(prefix), type);
}

export function isYooKassaIp(ip) {
  if (!ip) return false;
  let clean = ip.trim();
  if (clean.startsWith('::ffff:')) clean = clean.slice(7);
  const type = net.isIPv6(clean) ? 'ipv6' : net.isIPv4(clean) ? 'ipv4' : null;
  if (!type) return false;
  return blockList.check(clean, type);
}

// Запрашивает актуальный объект в API ЮКассы. Это главная защита от поддельных уведомлений.
export async function fetchObject(kind, id) {
  const path = kind === 'refund' ? 'refunds' : 'payments';
  const auth = Buffer.from(`${config.ykShopId}:${config.ykSecretKey}`).toString('base64');
  const res = await fetch(`${process.env.YK_API_ROOT || 'https://api.yookassa.ru'}/v3/${path}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`YooKassa API ${res.status}: ${await res.text()}`);
  return res.json();
}

export { verifyEnabled };

const num = (v) => (v === undefined || v === null ? null : Number(v));

const METHOD_NAMES = {
  bank_card: 'Карта',
  sbp: 'СБП',
  sberbank: 'SberPay',
  yoo_money: 'ЮMoney',
  tinkoff_bank: 'T-Pay',
  sber_loan: 'Сбер в рассрочку',
  mobile_balance: 'Баланс телефона',
};

export function describeMethod(pm) {
  if (!pm) return { type: null, title: null };
  const base = METHOD_NAMES[pm.type] || pm.type;
  if (pm.type === 'bank_card' && pm.card) {
    const c = pm.card;
    const bits = [c.issuer_name, c.card_type].filter(Boolean).join(' ');
    const tail = c.last4 ? `•• ${c.last4}` : '';
    return { type: pm.type, title: [base, bits, tail].filter(Boolean).join(' ') };
  }
  return { type: pm.type, title: base };
}

// Приводит уведомление к строке для базы
export function normalize(event, obj, verified) {
  const isRefund = event.startsWith('refund.');
  const method = describeMethod(obj.payment_method);
  return {
    event,
    objectId: obj.id,
    paymentId: isRefund ? obj.payment_id : obj.id,
    status: obj.status ?? null,
    amount: num(obj.amount?.value),
    incomeAmount: num(obj.income_amount?.value),
    currency: obj.amount?.currency ?? null,
    description: obj.description ?? null,
    methodType: method.type,
    methodTitle: method.title,
    cancelParty: obj.cancellation_details?.party ?? null,
    cancelReason: obj.cancellation_details?.reason ?? null,
    isTest: Boolean(obj.test),
    verified,
    objectCreated: obj.created_at ? new Date(obj.created_at) : null,
    raw: obj,
  };
}
