# syntax=docker/dockerfile:1

# ---------- Base común ----------
FROM node:24-alpine AS base
WORKDIR /app
# OpenSSL es necesario para que Prisma cargue su motor de consultas
RUN apk add --no-cache openssl

# ---------- Etapa 1: dependencias de producción ----------
# prisma es devDependency y peer opcional de @prisma/client ("devOptional"): hay que omitir los tres.
# --ignore-scripts evita el postinstall (prisma generate), que necesita el CLI.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --omit=peer --ignore-scripts && npm cache clean --force

# ---------- Etapa 2: generación del cliente de Prisma ----------
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate

# ---------- Imagen de migraciones (docker build --target migrate) ----------
# Incluye el CLI de Prisma, que la imagen de runtime no lleva. Se ejecuta como
# tarea única dentro de la VPC (llega a RDS) antes de desplegar el servicio.
FROM build AS migrate
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------- Etapa 3: runtime ----------
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3003

# Solo node_modules de producción (sin nodemon ni el CLI de Prisma), el cliente generado y el código
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json ./
COPY src ./src

# Usuario sin privilegios incluido en la imagen oficial de Node
USER node

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node directamente (sin npm) para que SIGTERM llegue al proceso
CMD ["node", "src/server.js"]
