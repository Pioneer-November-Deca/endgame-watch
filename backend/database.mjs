import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
pool.on('error', () => console.error('database_connection_error'));
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74120911)');
    await client.query(`CREATE TABLE IF NOT EXISTS watch_observation (
      campaign_id TEXT PRIMARY KEY, seconds INTEGER, source_status TEXT NOT NULL,
      observed_at BIGINT NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS watch_alert (
      campaign_id TEXT PRIMARY KEY, status TEXT NOT NULL, observed_seconds INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), provider_id TEXT
    )`);
    await client.query('ALTER TABLE watch_observation ADD COLUMN IF NOT EXISTS deadline_at BIGINT');
    await client.query('ALTER TABLE watch_observation ADD COLUMN IF NOT EXISTS campaign_end_date TEXT');
    await client.query('ALTER TABLE watch_observation ADD COLUMN IF NOT EXISTS source TEXT');
    await client.query(`CREATE TABLE IF NOT EXISTS watch_confirmation (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL, state TEXT NOT NULL DEFAULT 'pending'
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS watch_rate (
      key_hash TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 1, expires_at TIMESTAMPTZ NOT NULL
    )`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
