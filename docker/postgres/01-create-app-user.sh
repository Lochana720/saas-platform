#!/bin/bash
# Runs once, when the Postgres volume is first created.
# Creates the restricted runtime role used by the API. It is NOT a superuser and
# does NOT have BYPASSRLS, so Row-Level Security policies always apply to it.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${APP_DB_PASSWORD}';
EOSQL
