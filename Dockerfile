# ==========================================
# STAGE 1: TS compilation builder
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json tsconfig.json ./

RUN npm ci

COPY backend ./backend

RUN npm run build

# ==========================================
# STAGE 2: Lightweight production runner
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --only=production

# Copy compiled transpiled JavaScript code from builder
COPY --from=builder /usr/src/app/dist ./dist
COPY public ./public
COPY database ./database
COPY database/schema.sql ./schema.sql
COPY database/seed.sql ./seed.sql

EXPOSE 3000

CMD ["node", "dist/backend/app/server.js"]
