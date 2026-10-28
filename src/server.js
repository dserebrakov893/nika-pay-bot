import http from 'node:http';
import { config } from './config.js';
import { isYooKassaIp } from './yookassa.js';
import { processNotification } from './processor.js';

function clientIp(req) {
  // За прокси Railway реальный адрес клиента приходит в X-Real-IP / X-Forwarded-For
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Очередь: уведомления обрабатываются по одному, чтобы счётчики и тревоги считались в правильном порядке
let queue = Promise.resolve();
function enqueue(body) {
  queue = queue
    .then(() => processNotification(body))
    .catch((e) => console.error('[webhook] ошибка обработки', e));
  return queue;
}

export function startServer() {
  const hookPath = `/yookassa/${config.webhookSecret}`;

  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];

    if (req.method === 'GET' && (url === '/' || url === '/health')) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }

    if (req.method !== 'POST' || url !== hookPath) {
      res.writeHead(404).end();
      return;
    }

    const ip = clientIp(req);
    if (config.checkIp && !isYooKassaIp(ip)) {
      console.warn(`[webhook] запрос с чужого IP ${ip}, отклонён`);
      res.writeHead(403).end();
      return;
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400).end();
      return;
    }

    // ЮКассе важно быстро получить 200, обработка идёт дальше
    res.writeHead(200).end();
    enqueue(body);
  });

  server.listen(config.port, () => console.log(`[server] слушаю порт ${config.port}, вебхук: POST ${'/yookassa/***'}`));
  return server;
}
