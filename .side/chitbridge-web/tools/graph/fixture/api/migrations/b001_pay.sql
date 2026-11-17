-- fixture — the table universe: two touched by code, one touched by nothing
CREATE TABLE IF NOT EXISTS books_payment (payment_id uuid PRIMARY KEY, amount_minor bigint NOT NULL);
CREATE TABLE IF NOT EXISTS books_setting (entity_id uuid PRIMARY KEY, enabled boolean, status text);
CREATE TABLE IF NOT EXISTS chit_header (chit_id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS never_touched (id uuid PRIMARY KEY);
