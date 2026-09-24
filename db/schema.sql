-- PlaySync schema (MySQL 8.4, InnoDB). See docs/er.md and docs/normalization.md.
-- Loaded by the Docker entrypoint into the `playsync` database.

SET NAMES utf8mb4;

CREATE TABLE account (
  account_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(40)  NOT NULL,
  display_name    VARCHAR(80)  NOT NULL,
  max_streams     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  conflict_policy ENUM('REJECT','TAKEOVER','ASK') NOT NULL DEFAULT 'ASK',
  state_version   BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- bumped on every state change (OCC + client ordering)
  is_lab          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_account_username UNIQUE (username),          -- candidate key
  CONSTRAINT ck_account_max_streams CHECK (max_streams BETWEEN 1 AND 10)
) ENGINE=InnoDB;

CREATE TABLE device (
  device_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id   INT UNSIGNED NOT NULL,
  device_name  VARCHAR(60) NOT NULL,
  device_type  ENUM('DESKTOP','MOBILE','TABLET','WEB') NOT NULL,  -- EER discriminator
  last_seen_at DATETIME(3) NULL,
  CONSTRAINT uq_device_account_name UNIQUE (account_id, device_name), -- candidate key
  CONSTRAINT uq_device_id_account   UNIQUE (device_id, account_id),   -- target of composite FK
  CONSTRAINT fk_device_account FOREIGN KEY (account_id)
    REFERENCES account(account_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE song (
  song_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  artist      VARCHAR(120) NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  play_count  BIGINT UNSIGNED NOT NULL DEFAULT 0            -- lost-update experiment
) ENGINE=InnoDB;

CREATE TABLE playback_session (
  session_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        INT UNSIGNED NOT NULL,                   -- deliberate denormalization (device_id -> account_id)
  device_id         INT UNSIGNED NOT NULL,
  song_id           INT UNSIGNED NOT NULL,
  status            ENUM('PLAYING','PAUSED','ENDED','PREEMPTED','EXPIRED') NOT NULL,
  position_ms       INT UNSIGNED NOT NULL DEFAULT 0,
  started_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_expires_at  DATETIME(3) NOT NULL,
  ended_at          DATETIME(3) NULL,
  strategy          VARCHAR(24) NOT NULL,
  active_account_id INT UNSIGNED
    GENERATED ALWAYS AS (IF(status = 'PLAYING', account_id, NULL)) STORED,
  -- Composite FK keeps the denormalized account_id consistent with device.account_id.
  CONSTRAINT fk_session_device_account FOREIGN KEY (device_id, account_id)
    REFERENCES device(device_id, account_id),
  CONSTRAINT fk_session_song FOREIGN KEY (song_id) REFERENCES song(song_id),
  INDEX ix_session_account_status_lease (account_id, status, lease_expires_at),
  INDEX ix_session_status_lease (status, lease_expires_at)
) ENGINE=InnoDB;
-- NOTE: the UNIQUE index on active_account_id is NOT created here.
-- It is added/dropped by the lab only for the CONSTRAINT strategy:
--   ALTER TABLE playback_session ADD UNIQUE INDEX uq_one_active_per_account (active_account_id);
-- If it existed permanently, the NAIVE strategy would be silently protected and the experiment would be meaningless.

CREATE TABLE playback_event (                               -- append-only audit log
  event_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        INT UNSIGNED NOT NULL,
  device_id         INT UNSIGNED NOT NULL,
  session_id        BIGINT UNSIGNED NULL,
  event_type        ENUM('CLAIM_GRANTED','CLAIM_REJECTED','PREEMPTED','PAUSED',
                         'RELEASED','EXPIRED','HEARTBEAT_REJECTED') NOT NULL,
  state_version     BIGINT UNSIGNED NOT NULL,
  client_request_id CHAR(36) NULL,
  detail            JSON NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_event_request UNIQUE (device_id, client_request_id),  -- idempotency
  INDEX ix_event_account_time (account_id, created_at)
) ENGINE=InnoDB;
-- No FKs on the log on purpose: an audit log should survive deletes of the rows it describes.

CREATE TABLE experiment_run (
  run_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  experiment      ENUM('STREAM_LIMIT','LOST_UPDATE') NOT NULL,
  strategy        VARCHAR(24) NOT NULL,
  isolation_level VARCHAR(20) NOT NULL,
  mode            ENUM('NORMAL','TAKEOVER') NOT NULL DEFAULT 'NORMAL',
  concurrency     INT UNSIGNED NOT NULL,
  accounts        INT UNSIGNED NOT NULL,
  max_streams     TINYINT UNSIGNED NOT NULL,
  race_delay_ms   INT UNSIGNED NOT NULL,
  granted         INT UNSIGNED NOT NULL,
  rejected        INT UNSIGNED NOT NULL,
  retries         INT UNSIGNED NOT NULL,
  deadlocks       INT UNSIGNED NOT NULL,
  lock_timeouts   INT UNSIGNED NOT NULL,
  errors          INT UNSIGNED NOT NULL,
  violations      INT UNSIGNED NOT NULL,   -- excess active sessions (or lost increments)
  p50_ms          DECIMAL(10,2) NOT NULL,
  p95_ms          DECIMAL(10,2) NOT NULL,
  throughput_rps  DECIMAL(10,2) NOT NULL,
  wall_ms         DECIMAL(10,2) NOT NULL DEFAULT 0,
  batch_id        CHAR(36)      NULL,      -- groups the trials of one "Run"/"Compare all"/bench invocation
  trial           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  source          ENUM('UI','API','BENCH','TEST') NOT NULL DEFAULT 'API',
  detail          JSON          NULL,      -- errorSamples, lost-update finalCount, etc.
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_run_batch (batch_id),
  INDEX ix_run_experiment_time (experiment, created_at)
) ENGINE=InnoDB;
-- (batch_id, strategy, trial) is unique in practice (one writer per batch) but not declared:
-- see docs/normalization.md for why this stays BCNF without that as a candidate key.
