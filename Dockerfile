# ---- install dependencies ----
    FROM node:20-bookworm-slim AS deps
    WORKDIR /app
    COPY package.json package-lock.json ./
    RUN npm install -g npm@11 && npm ci
    
    # ---- build Next.js ----
    FROM node:20-bookworm-slim AS builder
    WORKDIR /app
    COPY --from=deps /app/node_modules ./node_modules
    COPY . .
    
    # Inlined into client JS at build time (also set in next.config.ts)
    ENV NEXT_PUBLIC_BASE_PATH=/ic_maps
    
    RUN npm run build
    
    # ---- production image ----
    FROM node:20-bookworm-slim AS runner
    WORKDIR /app
    
    ENV NODE_ENV=production
    ENV PORT=3000
    ENV HOSTNAME=0.0.0.0
    
    # Standalone server + assets Next doesn't bundle automatically
    COPY --from=builder /app/.next/standalone ./
    COPY --from=builder /app/.next/static ./.next/static
    COPY --from=builder /app/public ./public
    
    EXPOSE 3000
    CMD ["node", "server.js"]