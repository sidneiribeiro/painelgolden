# ===========================================
# PAINEL IPTV - BACKEND DOCKERFILE
# ===========================================

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Instala ferramentas de build necessárias para dependências nativas
RUN apt-get update && apt-get install -y \
    python3 \
    default-mysql-client \
    postgresql-client \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Instala dependências
COPY package*.json ./
RUN npm install

# Copia código fonte
COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Compila TypeScript
RUN npm run build

# ===========================================
# Production image
# ===========================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Instala bibliotecas runtime necessárias para canvas, prisma, e vídeo promocional
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libuuid1 \
    openssl \
    ca-certificates \
    ffmpeg \
    python3 \
    default-mysql-client \
    postgresql-client \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Cria usuário não-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 expressjs

# Copia arquivos necessários
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Criar diretórios para vídeo promocional e yt-dlp cache (antes de trocar user)
RUN mkdir -p /var/www/painel/storage/promo-videos/temp \
    && chown -R expressjs:nodejs /var/www/painel/storage \
    && mkdir -p /app/storage/banners/videos /app/storage/promo-videos /app/storage/uploads \
    && chown -R expressjs:nodejs /app/storage \
    && mkdir -p /home/expressjs \
    && chown expressjs:nodejs /home/expressjs

# Permissões
RUN chown -R expressjs:nodejs /app

USER expressjs
ENV HOME=/home/expressjs

# Expõe porta
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:3001/api/health >/dev/null || exit 1

# Comando de inicialização
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
ENV PRISMA_CLI_BINARY_TARGETS="linux-musl"
CMD ["sh", "-c", "npx prisma db push --skip-generate && (npx tsx prisma/seed.ts || true) && node --max-old-space-size=8192 dist/app.js"]
