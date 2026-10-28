import { config, verifyEnabled } from './config.js';
import { migrate } from './db.js';
import { bot } from './notify.js';
import { setupCommands, setMenu } from './commands.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';

async function main() {
  await migrate();
  startServer();
  setupCommands();
  startScheduler();

  if (!verifyEnabled) {
    console.warn('[main] YK_SHOP_ID / YK_SECRET_KEY не заданы: уведомления не перепроверяются через API');
  }

  await setMenu().catch((e) => console.warn('[main] меню команд не обновлено', e.message));
  bot.start({
    drop_pending_updates: true,
    onStart: (me) => console.log(`[bot] @${me.username} запущен для ${config.ownerIds.join(', ')}`),
  });
}

main().catch((e) => {
  console.error('[main] не стартовал', e);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    bot.stop();
    process.exit(0);
  });
}
