#!/bin/sh
# Runs the migration and RLS tests on a throwaway local Postgres database.
set -e
cd "$(dirname "$0")/../.."
DB=crewclock_test
su postgres -c "dropdb --if-exists $DB && createdb $DB"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/supabase_stub.sql -f supabase/migrations/20261022000000_init.sql -f tests/sql/rls_test.sql" 2>&1 | grep -E "NOTICE|ERROR|exception" 
