#!/bin/sh
set -e
echo "▶ Applying database migrations (as owner)…"
npx prisma migrate deploy

if [ "$SEED_ON_START" = "true" ]; then
  echo "▶ Seeding plans and demo data…"
  npx tsx prisma/seed.ts
fi

echo "▶ Starting API (as restricted app_user)…"
exec node dist/index.js
