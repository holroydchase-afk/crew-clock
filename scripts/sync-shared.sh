#!/bin/sh
# The app and the Edge Functions share these files. Supabase only deploys what is
# under supabase/functions, so copy them there. tests/shared.test.js checks they match.
set -e
cd "$(dirname "$0")/.."
for f in geo report chain risk; do cp "js/$f.js" "supabase/functions/_shared/vendor/$f.js"; done
