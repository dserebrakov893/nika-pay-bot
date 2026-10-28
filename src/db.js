import pg from 'pg';
import { config } from './config.js';

const ssl =
  /localhost|127\.0\.0\.1|\.railway\.internal/.test(config.databaseUrl) ? false : { rejectUnauthorized: false };

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl });

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yk_events (
      id              BIGSERIAL PRIMARY KEY,
      event           TEXT NOT NULL,
      object_id       TEXT NOT NULL,
      payment_id      TEXT,
      status          TEXT,
      amount          NUMERIC(14,2),
      income_amount   NUMERIC(14,2),
      currency        TEXT,
      description     TEXT,
      method_type     TEXT,
      method_title    TEXT,
      cancel_party    TEXT,
      cancel_reason   TEXT,
      is_test         BOOLEAN NOT NULL DEFAULT FALSE,
      verified        BOOLEAN NOT NULL DEFAULT FALSE,
      object_created  TIMESTAMPTZ,
      received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      raw             JSONB NOT NULL,
      UNIQUE (event, object_id)
    );
    CREATE INDEX IF NOT EXISTS yk_events_received_idx ON yk_events (received_at);
    CREATE INDEX IF NOT EXISTS yk_events_event_idx ON yk_events (event, received_at);

    CREATE TABLE IF NOT EXISTS bot_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// true, если событие новое; false, если это повтор от ЮКассы
export async function saveEvent(row) {
  const res = await pool.query(
    `INSERT INTO yk_events
       (event, object_id, payment_id, status, amount, income_amount, currency, description,
        method_type, method_title, cancel_party, cancel_reason, is_test, verified, object_created, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (event, object_id) DO NOTHING
     RETURNING id`,
    [
      row.event, row.objectId, row.paymentId, row.status, row.amount, row.incomeAmount, row.currency,
      row.description, row.methodType, row.methodTitle, row.cancelParty, row.cancelReason,
      row.isTest, row.verified, row.objectCreated, row.raw,
    ],
  );
  return res.rowCount > 0;
}

export async function getState(key) {
  const r = await pool.query('SELECT value FROM bot_state WHERE key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

export async function setState(key, value) {
  await pool.query(
    `INSERT INTO bot_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)],
  );
}
