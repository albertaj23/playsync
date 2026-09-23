-- PlaySync seed data. Rows are generated with WITH RECURSIVE where there is a pattern.
-- Expected counts: account 19 (1 demo + 16 lab + 2 stepper), device 1032 (4 + 16*64 + 2*2), song 12.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------- demo account
INSERT INTO account (username, display_name, max_streams, conflict_policy)
VALUES ('brij', 'Brij', 1, 'ASK');

INSERT INTO device (account_id, device_name, device_type)
SELECT a.account_id, d.device_name, d.device_type
FROM account a
JOIN (
  SELECT 'MacBook' AS device_name, 'DESKTOP' AS device_type UNION ALL
  SELECT 'iPhone',  'MOBILE'  UNION ALL
  SELECT 'iPad',    'TABLET'  UNION ALL
  SELECT 'Browser', 'WEB'
) d
WHERE a.username = 'brij';

-- ---------------------------------------------------------------- songs (made up)
-- Titles/artists are invented; 12 rows with durations spread evenly over 2..4 minutes.
INSERT INTO song (title, artist, duration_ms)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12)
SELECT
  ELT(i, 'Neon Tidepool', 'Paper Satellites', 'Quiet Voltage', 'Glasshouse Summer',
         'Midnight Ledger', 'Copper Rain', 'Lanterns on Mars', 'Static Bloom',
         'Northbound Echo', 'Velvet Circuit', 'Salt & Signal', 'Last Train to Nowhere'),
  ELT(i, 'The Lease Holders', 'Mira Kestrel', 'Gap Lock Trio', 'Ansel & The Undo Log',
         'Two-Phase Collective', 'Juno Hartwell', 'The Phantom Reads', 'Oriel Vance',
         'Deadlock Detectives', 'Sable Monroe', 'The Write Skews', 'Kit Calloway'),
  120000 + (i - 1) * 10909   -- 120 000 ms .. 240 000 ms (2..4 min)
FROM n;

-- ---------------------------------------------------------------- lab accounts
-- 16 accounts lab_01..lab_16, each with 64 devices lab-dev-01..lab-dev-64.
INSERT INTO account (username, display_name, max_streams, conflict_policy, is_lab)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 16)
SELECT CONCAT('lab_', LPAD(i, 2, '0')), CONCAT('Lab account ', i), 1, 'REJECT', TRUE
FROM n;

INSERT INTO device (account_id, device_name, device_type)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 64)
SELECT a.account_id,
       CONCAT('lab-dev-', LPAD(n.i, 2, '0')),
       ELT(1 + (n.i - 1) % 4, 'DESKTOP', 'MOBILE', 'TABLET', 'WEB')
FROM account a
CROSS JOIN n
WHERE a.is_lab = TRUE
ORDER BY a.account_id, n.i;

-- ---------------------------------------------------------------- stepper accounts
INSERT INTO account (username, display_name, max_streams, conflict_policy)
VALUES ('step_a', 'Stepper A', 1, 'REJECT'),
       ('step_b', 'Stepper B', 1, 'REJECT');

INSERT INTO device (account_id, device_name, device_type)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2)
SELECT a.account_id, CONCAT('step-dev-', n.i), IF(n.i = 1, 'DESKTOP', 'MOBILE')
FROM account a
CROSS JOIN n
WHERE a.username IN ('step_a', 'step_b')
ORDER BY a.account_id, n.i;
