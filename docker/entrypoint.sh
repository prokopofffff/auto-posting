#!/bin/sh
set -e

echo "→ Applying Prisma migrations"
node node_modules/prisma/build/index.js migrate deploy

echo "→ Starting Next.js server"
exec node server.js
