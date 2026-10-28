import { config, verifyEnabled } from './config.js';
import { bot } from './notify.js';
import { pool } from './db.js';
import { todayReport, weekReport, monthReport, dayReport, lastPayments, lastFails } from './analytics.js';
import { fmtDayTime, mskDayStart } from './time.js';

const HELP = `<b>Платежи ${config.shopName}</b>

Сам пришлю: оплаты, отказы с причиной, брошенные оплаты, возвраты, тревогу при серии отказов, сводку дня в ${config.digestHour}:00 и итоги недели по понедельникам.

/today  сегодня
/yesterday  вчера
/week  текущая неделя
/month  текущий месяц
/last  последние оплаты
/fails  последние отказы
/status  всё ли работает`;

export function setupCommands() {
  // Бот отвечает только владельцу. Остальным показывает их chat_id, чтобы было проще настроить.
  bot.use(async (ctx, next) => {
    const id = String(ctx.chat?.id ?? '');
    if (config.ownerIds.includes(id)) return next();
    if (ctx.message?.text === '/start' || ctx.message?.text === '/id') {
      await ctx.reply(`Этот бот закрытый.\nТвой chat_id: <code>${id}</code>`, { parse_mode: 'HTML' });
    }
  });

  const send = (fn) => async (ctx) => {
    try {
      await ctx.reply(await fn(), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (e) {
      console.error('[cmd]', e);
      await ctx.reply('Не получилось посчитать, ошибка в логах.');
    }
  };

  bot.command(['start', 'help'], send(async () => HELP));
  bot.command('today', send(() => todayReport()));
  bot.command('yesterday', send(() => dayReport(mskDayStart(new Date(), -1))));
  bot.command('week', send(() => weekReport()));
  bot.command('month', send(() => monthReport()));
  bot.command('last', send(() => lastPayments()));
  bot.command('fails', send(() => lastFails()));
  bot.command('status', send(statusText));

  bot.catch((err) => console.error('[bot]', err.error));
}

async function statusText() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n, MAX(received_at) AS last,
            COUNT(*) FILTER (WHERE NOT verified)::int AS unverified
     FROM yk_events`,
  );
  const r = rows[0];
  return [
    '🟢 <b>Бот работает</b>',
    `Событий в базе: ${r.n}`,
    `Последнее уведомление ЮКассы: ${r.last ? fmtDayTime(r.last) : 'ещё не было'}`,
    `Перепроверка через API: ${verifyEnabled ? 'включена' : '❌ выключена, задай YK_SHOP_ID и YK_SECRET_KEY'}`,
    `Проверка IP ЮКассы: ${config.checkIp ? 'включена' : 'выключена'}`,
    r.unverified ? `Неперепроверенных событий: ${r.unverified}` : null,
  ].filter(Boolean).join('\n');
}

export async function setMenu() {
  await bot.api.setMyCommands([
    { command: 'today', description: 'Сегодня' },
    { command: 'yesterday', description: 'Вчера' },
    { command: 'week', description: 'Текущая неделя' },
    { command: 'month', description: 'Текущий месяц' },
    { command: 'last', description: 'Последние оплаты' },
    { command: 'fails', description: 'Последние отказы' },
    { command: 'status', description: 'Всё ли работает' },
  ]);
}
