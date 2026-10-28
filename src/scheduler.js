import { config } from './config.js';
import { getState, setState } from './db.js';
import { notifyOwners } from './notify.js';
import { dayReport, lastWeekReport } from './analytics.js';
import { mskParts, mskDayStart } from './time.js';

// Раз в минуту проверяем, не пора ли отправить сводку. Отметка в базе защищает от дублей после рестарта.
async function tick() {
  const now = new Date();
  const p = mskParts(now);
  const dayKey = `${p.year}-${p.month + 1}-${p.day}`;

  if (p.hour >= config.digestHour && (await getState('daily_sent')) !== dayKey) {
    await setState('daily_sent', dayKey);
    await notifyOwners(await dayReport(mskDayStart(now)), { silent: false });
  }

  if (p.weekday === 1 && p.hour >= config.weeklyHour && (await getState('weekly_sent')) !== dayKey) {
    await setState('weekly_sent', dayKey);
    await notifyOwners(await lastWeekReport(now), { silent: false });
  }
}

export function startScheduler() {
  const run = () => tick().catch((e) => console.error('[scheduler]', e));
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
}
