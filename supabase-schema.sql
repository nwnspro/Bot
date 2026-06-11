CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  user_id             TEXT PRIMARY KEY,
  api_token           TEXT UNIQUE,
  calibration_easy    JSONB NOT NULL DEFAULT '[]',
  calibration_unknown JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calibration_easy JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS calibration_unknown JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS words (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  word          TEXT NOT NULL,
  zh            TEXT,
  source        TEXT NOT NULL DEFAULT 'feed',
  status        TEXT NOT NULL DEFAULT 'learning',
  review_count  INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  last_reviewed TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, word)
);

CREATE INDEX IF NOT EXISTS words_user_active_idx
  ON words (user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS words_user_status_active_idx
  ON words (user_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_api_token_idx
  ON users (api_token);

CREATE OR REPLACE FUNCTION record_review(p_user_id TEXT, p_word TEXT, p_correct BOOLEAN)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE words
  SET review_count = review_count + 1,
      correct_count = correct_count + CASE WHEN p_correct THEN 1 ELSE 0 END,
      last_reviewed = now()
  WHERE user_id = p_user_id
    AND word = p_word
    AND deleted_at IS NULL;
END;
$$;
