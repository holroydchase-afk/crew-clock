#!/bin/sh
# Runs the stub, every migration (filename order) and every numbered SQL test on a throwaway
# Postgres database. Files are found by glob, never listed here, and sorted with LC_ALL=C.
#   sh tests/sql/run.sh               run all
#   sh tests/sql/run.sh --list        print the files in run order (never starts psql)
#   sh tests/sql/run.sh --skip NAME   leave out the file with that base name (repeatable)
# With PGHOST set (CI), psql connects with PGHOST/PGPORT/PGUSER/PGPASSWORD; otherwise it runs as
# the local postgres user through su.
set -e
cd "$(dirname "$0")/../.."
export LC_ALL=C
DB=crewclock_test
list=0
skip=" "
while [ $# -gt 0 ]; do
  case "$1" in
    --list) list=1 ;;
    --skip) shift; [ $# -gt 0 ] || { echo "run.sh: --skip needs a file name" >&2; exit 2; }; skip="$skip$(basename "$1") " ;;
    *) echo "run.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

files=$( { echo tests/sql/supabase_stub.sql
           ls supabase/migrations/*.sql | sort
           ls tests/sql/[0-9]*_test.sql | sort; } )
run=""
for f in $files; do
  case "$skip" in *" $(basename "$f") "*) continue ;; esac
  run="$run $f"
done

if [ "$list" = 1 ]; then
  for f in $run; do echo "$f"; done
  exit 0
fi

args=""
for f in $run; do args="$args -f $f"; done

pg() {
  if [ -n "$PGHOST" ]; then sh -c "$1"; else su postgres -c "$1"; fi
}
pg "psql -q -d postgres -c 'drop database if exists $DB' -c 'create database $DB'"
# Keep psql's exit status: piping into grep alone would hide a failed test.
status=0
out=$(pg "psql -q -v ON_ERROR_STOP=1 -d $DB $args" 2>&1) || status=$?
echo "$out" | grep -E "NOTICE|ERROR|exception" || true
exit $status
