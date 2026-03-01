#!/bin/bash
# Enable PostGIS in the app database so node_outside.location and ST_MakePoint/ST_SetSRID work.
# Runs automatically on first container init (empty volume). If the DB already existed without
# PostGIS, run manually: docker exec -it postgress psql -U root -d icmaps -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
