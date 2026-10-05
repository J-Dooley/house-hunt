#!/usr/bin/env bash
# Builds a throwaway database with Supabase stand-ins, applies the repo SQL in order, runs the SQL tests.
# Usage: PGHOST=/tmp PGPORT=5544 PGUSER=postgres tests/harness/run-db-tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=househunt_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f tests/harness/stubs.sql
sed -E "/^create extension if not exists pg_(cron|net);/d" supabase/sql/automation.sql > /tmp/automation.local.sql
$P -f /tmp/automation.local.sql
$P -f supabase/sql/ingestion.sql
$P -f supabase/sql/security.sql
for f in supabase/sql/alerts.sql; do [ -f "$f" ] && $P -f "$f"; done
$P -f tests/database.sql && echo "database.sql: PASS"
for f in tests/database-alerts.sql; do [ -f "$f" ] && $P -f "$f" && echo "$f: PASS"; done
true
