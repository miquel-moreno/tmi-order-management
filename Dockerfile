# Taller de Pedidos (demo) — imagen de producción para la demo pública.
# Node 20 sobre Debian slim. La base de datos SQLite y los adjuntos viven en
# /data, que debe montarse como VOLUMEN PERSISTENTE (ver README, Despliegue).

FROM node:20-bookworm-slim

# better-sqlite3 es un módulo nativo: estas herramientas permiten compilarlo si
# no hay binario prebuilt para la plataforma. Se quedan en la imagen (demo).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero, para aprovechar la caché de capas.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Resto del proyecto (backend + frontend + docs + tests).
COPY . .

# Datos persistentes FUERA del árbol de la app: montar un volumen en /data.
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/taller.db \
    UPLOADS_DIR=/data/uploads \
    WEBHOOKS_ENABLED=0
RUN mkdir -p /data/uploads

WORKDIR /app/backend
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Siembra la demo SOLO si la base está vacía (primer arranque); en arranques
# posteriores conserva el estado del volumen. Luego arranca el servidor.
# Se usa forma shell para no depender de un script con permisos/EOL.
CMD node -e "const db=require('./src/models/db');process.exit(db.prepare('select count(*) c from orders').get().c>0?0:1)" \
    || npm run seed; \
    exec node src/server.js
