// Все настройки берутся из переменных окружения (Railway → Variables)

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] не задана переменная ${name}`);
    process.exit(1);
  }
  return v;
}

function int(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : parseInt(v, 10);
}

export const config = {
  botToken: required('BOT_TOKEN'),
  // chat_id получателя уведомлений; можно несколько через запятую
  ownerIds: required('OWNER_CHAT_ID').split(',').map((s) => s.trim()).filter(Boolean),
  databaseUrl: required('DATABASE_URL'),
  // секретная часть URL вебхука: https://<домен>/yookassa/<WEBHOOK_SECRET>
  webhookSecret: required('WEBHOOK_SECRET'),
  port: int('PORT', 3000),

  // ключи API магазина ЮКассы: нужны, чтобы перепроверять каждое уведомление
  ykShopId: process.env.YK_SHOP_ID || '',
  ykSecretKey: process.env.YK_SECRET_KEY || '',

  // проверять, что запрос пришёл с IP ЮКассы
  checkIp: (process.env.CHECK_IP ?? 'true') !== 'false',

  shopName: process.env.SHOP_NAME || 'НИКА',

  // расписание (время московское)
  digestHour: int('DIGEST_HOUR', 21),
  weeklyHour: int('WEEKLY_HOUR', 10), // понедельник
  // тихие часы: уведомления приходят без звука
  quietFrom: int('QUIET_FROM', 23),
  quietTo: int('QUIET_TO', 8),

  // тревога: N отказов подряд в пределах окна
  alertFailStreak: int('ALERT_FAIL_STREAK', 3),
  alertWindowMin: int('ALERT_WINDOW_MIN', 60),

  // показывать тестовые платежи (они всё равно не попадают в аналитику)
  notifyTest: (process.env.NOTIFY_TEST ?? 'true') !== 'false',
};

export const verifyEnabled = Boolean(config.ykShopId && config.ykSecretKey);
