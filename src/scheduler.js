import { config } from './config.js';
import { getState, setState } from './db.js';
import { notifyOwners } from './notify.js';
import { dayReport, lastWeekReport, landingBlock } from './analytics.js';
import { mskParts, mskDayStart, mskWeekStart } from './time.js';

const DAY = 24 * 60 * 60 * 1000;

// Раз в минуту проверяем, не пора ли отправить сводку. Отметка в базе защищает от дублей после рестарта.
async function tick() {
  const now = new Date();
  const p = mskParts(now);
  const dayKey = `${p.year}-${p.month + 1}-${p.day}`;

  if (p.hour >= config.digestHour && (await getState('daily_sent')) !== dayKey) {
    await setState('daily_sent', dayKey);
    const from = mskDayStart(now);
    const html = (await dayReport(from)) + (await landingBlock(from, new Date(+from + DAY)));
    await notifyOwners(html, { silent: false });
  }

  if (p.weekday === 1 && p.hour >= config.weeklyHour && (await getState('weekly_sent')) !== dayKey) {
    await setState('weekly_sent', dayKey);
    const to = mskWeekStart(now);
    const html = (await lastWeekReport(now)) + (await landingBlock(new Date(to - 7 * DAY), to));
    await notifyOwners(html, { silent: false });
  }
}

export function startScheduler() {
  const run = () => tick().catch((e) => console.error('[scheduler]', e));
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
}
