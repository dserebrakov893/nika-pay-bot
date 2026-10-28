import { Bot } from 'grammy';
import { config } from './config.js';
import { mskParts } from './time.js';

export const bot = new Bot(config.botToken, {
  client: process.env.TELEGRAM_API_ROOT ? { apiRoot: process.env.TELEGRAM_API_ROOT } : undefined,
});

function isQuiet(now = new Date()) {
  const h = mskParts(now).hour;
  const { quietFrom: a, quietTo: b } = config;
  if (a === b) return false;
  return a < b ? h >= a && h < b : h >= a || h < b;
}

// Отправка всем получателям. Ночью без звука.
export async function notifyOwners(html, { silent } = {}) {
  const disable_notification = silent ?? isQuiet();
  for (const id of config.ownerIds) {
    try {
      await bot.api.sendMessage(id, html, {
        parse_mode: 'HTML',
        disable_notification,
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      console.error(`[notify] не удалось отправить в ${id}:`, e.description || e.message);
    }
  }
}
