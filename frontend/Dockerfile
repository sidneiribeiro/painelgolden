# ===========================================
# PAINEL IPTV - FRONTEND DOCKERFILE
# ===========================================

FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_APP_NAME=PainelMaster
ARG VITE_LANDING_HOSTNAME=
ARG VITE_ENABLE_XUIONE=false
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_LANDING_HOSTNAME=${VITE_LANDING_HOSTNAME}
ENV VITE_ENABLE_XUIONE=${VITE_ENABLE_XUIONE}

# Instala dependências
COPY package*.json ./
RUN npm ci

# Copia código fonte
COPY . .

# Build
RUN npm run build

# ===========================================
# Production image with Nginx
# ===========================================
FROM nginx:alpine AS runner

# Remove config padrão do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia configuração customizada
COPY nginx.conf /etc/nginx/conf.d/

# Copia arquivos buildados
COPY --from=builder /app/dist /usr/share/nginx/html

# Expõe porta
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
