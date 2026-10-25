#!/bin/bash
# Nightly backup: SQLite DB + tenant workspaces + published sites. Keeps 7 days.
set -euo pipefail
D=/opt/builder/backups
mkdir -p "$D"
S=$(date +%Y%m%d)
T=$(mktemp -d)
trap "rm -rf $T" EXIT
sqlite3 /opt/builder/data/builder.db ".backup '$T/builder.db'"
tar -czf "$D/dukan-$S.tar.gz" -C "$T" builder.db -C /opt tenants www/published
find "$D" -name "dukan-*.tar.gz" -mtime +7 -delete
echo "$(date -Iseconds) backup dukan-$S.tar.gz done ($(du -h "$D/dukan-$S.tar.gz" | cut -f1))"
