import { Keyboard } from 'grammy';
import { config, verifyEnabled } from './config.js';
import { bot } from './notify.js';
import { pool, getState } from './db.js';
import { esc } from './format.js';
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

// Постоянное меню кнопками под полем ввода
const BTN = {
  today: '📊 Сегодня',
  yesterday: '📅 Вчера',
  week: '🗓 Неделя',
  month: '📆 Месяц',
  last: '💰 Оплаты',
  fails: '❌ Отказы',
  status: '🟢 Статус',
};

const menu = new Keyboard()
  .text(BTN.today).text(BTN.yesterday).row()
  .text(BTN.week).text(BTN.month).row()
  .text(BTN.last).text(BTN.fails).row()
  .text(BTN.status)
  .resized()
  .persistent();

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
      await ctx.reply(await fn(), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: menu,
      });
    } catch (e) {
      console.error('[cmd]', e);
      await ctx.reply('Не получилось посчитать, ошибка в логах.', { reply_markup: menu });
    }
  };

  bot.command(['start', 'help'], send(async () => HELP));

  // каждое действие доступно и командой, и кнопкой меню
  const actions = {
    today: () => todayReport(),
    yesterday: () => dayReport(mskDayStart(new Date(), -1)),
    week: () => weekReport(),
    month: () => monthReport(),
    last: () => lastPayments(),
    fails: () => lastFails(),
    status: statusText,
  };
  for (const [name, fn] of Object.entries(actions)) {
    bot.command(name, send(fn));
    bot.hears(BTN[name], send(fn));
  }

  bot.catch((err) => console.error('[bot]', err.error));
}

async function statusText() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n, MAX(received_at) AS last,
            COUNT(*) FILTER (WHERE NOT verified)::int AS unverified
     FROM yk_events`,
  );
  const r = rows[0];
  const pollOk = await getState('poll_ok');
  const pollError = await getState('poll_error');
  return [
    '🟢 <b>Бот работает</b>',
    `Событий в базе: ${r.n}`,
    `Последнее событие ЮКассы: ${r.last ? fmtDayTime(r.last) : 'ещё не было'}`,
    `Опрос API: ${!verifyEnabled ? 'выключен' : pollError ? '❌ ' + esc(pollError) : pollOk ? 'последний ' + fmtDayTime(new Date(pollOk)) : 'ещё не было'}`,
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
