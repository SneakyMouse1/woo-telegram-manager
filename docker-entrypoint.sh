#!/bin/sh
set -e

echo "[Docker Entrypoint] Starting WooCommerce Telegram Manager..."

# Wait for PostgreSQL to become reachable before running migrations
if [ -n "$DATABASE_URL" ]; then
  echo "[Docker Entrypoint] Checking database connection..."
  MAX_RETRIES=15
  COUNT=0
  until npx prisma migrate deploy > /dev/null 2>&1 || [ $COUNT -eq $MAX_RETRIES ]; do
    COUNT=$((COUNT + 1))
    echo "[Docker Entrypoint] Database not ready yet (attempt $COUNT/$MAX_RETRIES). Retrying in 2s..."
    sleep 2
  done

  if [ $COUNT -eq $MAX_RETRIES ]; then
    echo "[Docker Entrypoint] Database took too long to respond. Attempting direct migration to log details:"
    npx prisma migrate deploy
  else
    echo "[Docker Entrypoint] Database connected and migrations applied successfully!"
  fi
fi

# Execute application
echo "[Docker Entrypoint] Launching application server..."
exec "$@"
