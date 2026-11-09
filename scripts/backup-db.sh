#!/usr/bin/env bash
# Dumps the database's public schema (all site tables, policies and
# functions), checks the dump, and writes an AES-256 encrypted copy.
# The unencrypted dump never leaves the temp file, which is removed on
# exit. Used by .github/workflows/db-backup.yml.
#
#   DB_URL=... BACKUP_PASSPHRASE=... bash scripts/backup-db.sh <output-dir>
set -euo pipefail

: "${DB_URL:?DB_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set - refusing to write an unencrypted backup}"
out_dir="${1:?usage: backup-db.sh <output-dir>}"
expect_tables="${EXPECT_TABLES:-repair_requests techs time_logs reviews stats}"

plain="$(mktemp)"
trap 'rm -f "$plain"' EXIT

# pg_dump must match the server's major version (Supabase runs 17).
# DB_URL is passed as an env var and expanded inside the container so
# the password never appears in a command line.
docker run --rm --network host -e DB_URL postgres:17 \
    sh -c 'pg_dump "$DB_URL" --schema=public --no-owner' > "$plain"

# The dump creates the public schema, but every new database already has
# one, so a restore would stop right there. Make it create-if-missing.
sed -i 's/^CREATE SCHEMA public;$/CREATE SCHEMA IF NOT EXISTS public;/' "$plain"

for table in $expect_tables; do
    if ! grep -q "^CREATE TABLE public\.$table " "$plain" || ! grep -q "^COPY public\.$table " "$plain"; then
        echo "Backup check failed: table '$table' is missing from the dump." >&2
        exit 1
    fi
done

echo "Rows in this backup:"
awk '/^COPY public\./ { table = $2; rows = 0; next }
     /^\\\.$/        { if (table) print "  " table ": " rows; table = ""; next }
     table           { rows++ }' "$plain"

mkdir -p "$out_dir"
out_file="$out_dir/backup-$(date -u +%Y-%m-%dT%H%MZ).sql.gpg"
gpg --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 --output "$out_file" "$plain" <<< "$BACKUP_PASSPHRASE"

echo "Encrypted backup: $out_file ($(du -h "$out_file" | cut -f1))"
