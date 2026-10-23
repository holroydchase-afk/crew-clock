#!/bin/sh
# Runs the migration and RLS tests on a throwaway local Postgres database.
set -e
cd "$(dirname "$0")/../.."
DB=crewclock_test
su postgres -c "dropdb --if-exists $DB && createdb $DB"
# Keep psql's exit status: piping into grep alone would hide a failed test.
status=0
out=$(su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/supabase_stub.sql -f supabase/migrations/20261022000000_init.sql -f supabase/migrations/20261023000000_auth_hook.sql -f supabase/migrations/20261023100000_location_consents.sql -f tests/sql/rls_test.sql -f tests/sql/auth_test.sql -f tests/sql/consent_test.sql" 2>&1) || status=$?
echo "$out" | grep -E "NOTICE|ERROR|exception" || true
exit $status
