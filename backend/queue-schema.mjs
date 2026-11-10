export const queueSchema = [
  `CREATE SEQUENCE IF NOT EXISTS q_order_seq`,
  `CREATE TABLE IF NOT EXISTS q_member (
    id UUID PRIMARY KEY, seq BIGSERIAL UNIQUE, alias TEXT NOT NULL, alias_key TEXT NOT NULL UNIQUE,
    region TEXT NOT NULL, timezone TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', available BOOLEAN NOT NULL DEFAULT false,
    created_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL, cooldown_until BIGINT NOT NULL DEFAULT 0,
    queue_order BIGINT NOT NULL DEFAULT nextval('q_order_seq'), priority_order BIGINT,
    email TEXT UNIQUE, email_verified BOOLEAN NOT NULL DEFAULT false, email_consent BOOLEAN NOT NULL DEFAULT false
  )`,
  `ALTER TABLE q_member ADD COLUMN IF NOT EXISTS watch_reason TEXT`,
  `ALTER TABLE q_member ADD COLUMN IF NOT EXISTS watch_until BIGINT NOT NULL DEFAULT 0`,
  `ALTER TABLE q_member ADD COLUMN IF NOT EXISTS quiet_enabled BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE q_member ADD COLUMN IF NOT EXISTS quiet_start INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE q_member ADD COLUMN IF NOT EXISTS quiet_end INTEGER NOT NULL DEFAULT 360`,
  `CREATE TABLE IF NOT EXISTS q_presence (member_id UUID NOT NULL REFERENCES q_member(id),tab_id UUID NOT NULL,seen_at BIGINT NOT NULL,closed_at BIGINT,PRIMARY KEY(member_id,tab_id))`,
  `CREATE TABLE IF NOT EXISTS q_session (token_hash TEXT PRIMARY KEY, member_id UUID NOT NULL REFERENCES q_member(id), expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS q_access (token_hash TEXT PRIMARY KEY, member_id UUID NOT NULL REFERENCES q_member(id), expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS q_email_verify (token_hash TEXT PRIMARY KEY, member_id UUID NOT NULL REFERENCES q_member(id), email TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS q_round (id UUID PRIMARY KEY, started_at BIGINT NOT NULL, source_deadline BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'active', fallback_claimed BOOLEAN NOT NULL DEFAULT false)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS q_one_active_round ON q_round(status) WHERE status='active'`,
  `CREATE TABLE IF NOT EXISTS q_call (id UUID PRIMARY KEY, round_id UUID NOT NULL REFERENCES q_round(id), member_id UUID NOT NULL REFERENCES q_member(id), status TEXT NOT NULL DEFAULT 'offered', offered_at BIGINT NOT NULL, respond_by BIGINT NOT NULL, act_by BIGINT, UNIQUE(round_id,member_id))`,
  `CREATE TABLE IF NOT EXISTS q_touch (round_id UUID NOT NULL REFERENCES q_round(id), member_id UUID NOT NULL REFERENCES q_member(id), channel TEXT NOT NULL, PRIMARY KEY(round_id,member_id))`,
  `CREATE TABLE IF NOT EXISTS q_mail (id UUID PRIMARY KEY, kind TEXT NOT NULL, member_id UUID NOT NULL REFERENCES q_member(id), round_id UUID REFERENCES q_round(id), reserved_at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'reserved', provider_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS q_mail_budget ON q_mail(reserved_at,kind)`,
  `CREATE TABLE IF NOT EXISTS q_budget (id INTEGER PRIMARY KEY CHECK(id=1), credits DOUBLE PRECISION NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS q_session_member ON q_session(member_id)`
];
