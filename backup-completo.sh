#!/bin/bash

################################################################################
#                    💾 BACKUP COMPLETO - PAINEL IPTV MASTER
#                    Para guardar no Google Drive e instalar em nova VPS
################################################################################

set -e  # Exit on error

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para imprimir mensagens coloridas
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Banner
clear
echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     💾 PAINEL IPTV MASTER - BACKUP COMPLETO PARA VPS          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Configurações
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="painel-iptv-backup-completo_${TIMESTAMP}"
BACKUP_PATH="${SCRIPT_DIR}/${BACKUP_NAME}"

print_info "Iniciando backup completo do Painel IPTV Master..."
print_info "Timestamp: ${TIMESTAMP}"
print_info "Destino: ${BACKUP_PATH}.tar.gz"
echo ""

# Criar diretório temporário para o backup
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

mkdir -p "${TEMP_DIR}/painel-iptv"

print_info "📦 Copiando código completo do projeto..."

# Copiar tudo exceto node_modules, dist, backups, logs
rsync -aq \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='.git' \
  --exclude='backups' \
  --exclude='_archive' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='storage/uploads' \
  --exclude='storage/banners' \
  --exclude='storage/videos' \
  --exclude='storage/temp' \
  --exclude='.next' \
  --exclude='coverage' \
  --exclude='.nyc_output' \
  "${SCRIPT_DIR}/" "${TEMP_DIR}/painel-iptv/" || {
  print_error "Erro ao copiar código"
  exit 1
}

print_success "Código copiado"

# Backup do banco de dados
print_info "🗄️  Fazendo backup do banco de dados..."

# Carregar variáveis de ambiente (stack usa .env na raiz)
if [ -f "${SCRIPT_DIR}/.env" ]; then
  export $(grep -v '^#' "${SCRIPT_DIR}/.env" | xargs)
fi

DATABASE_URL="${DATABASE_URL:-file:./dev.db}"

if [[ "${DATABASE_URL}" == mysql://* ]] || [[ "${DATABASE_URL}" == mariadb://* ]]; then
  # MySQL/MariaDB
  print_info "Detectado: MySQL/MariaDB"
  
  # Extrair credenciais da URL
  DB_URL_REGEX="mysql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)"
  if [[ "${DATABASE_URL}" =~ ${DB_URL_REGEX} ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"
    
    DB_DUMP="${TEMP_DIR}/painel-iptv/database_${DB_NAME}.sql"
    
    if command -v mysqldump &> /dev/null; then
      mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" > "${DB_DUMP}" 2>/dev/null || {
        print_warning "Aviso: Não foi possível fazer dump do MySQL automaticamente"
        print_info "Execute manualmente: mysqldump -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} -p ${DB_NAME} > ${DB_DUMP}"
      }
    else
      print_warning "mysqldump não encontrado. Instale: apt-get install mysql-client"
    fi
  else
    print_warning "Não foi possível parsear DATABASE_URL do MySQL"
  fi
elif [[ "${DATABASE_URL}" == postgresql://* ]] || [[ "${DATABASE_URL}" == postgres://* ]]; then
  # PostgreSQL
  print_info "Detectado: PostgreSQL"

  DB_URL_REGEX="postgres(ql)?://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)"
  if [[ "${DATABASE_URL}" =~ ${DB_URL_REGEX} ]]; then
    DB_USER="${BASH_REMATCH[2]}"
    DB_PASS="${BASH_REMATCH[3]}"
    DB_HOST="${BASH_REMATCH[4]}"
    DB_PORT="${BASH_REMATCH[6]:-5432}"
    DB_NAME="${BASH_REMATCH[7]}"

    DB_DUMP="${TEMP_DIR}/painel-iptv/database_${DB_NAME}.sql"

    if command -v docker &> /dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'painelmaster-postgres'; then
      docker exec -e PGPASSWORD="${DB_PASS}" painelmaster-postgres pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges > "${DB_DUMP}" 2>/dev/null || {
        print_warning "Aviso: Não foi possível fazer dump do PostgreSQL via Docker"
        print_info "Execute manualmente: docker exec -e PGPASSWORD=*** painelmaster-postgres pg_dump -U ${DB_USER} -d ${DB_NAME} --clean --if-exists --no-owner --no-privileges > ${DB_DUMP}"
      }
    elif command -v pg_dump &> /dev/null; then
      if [[ "${DB_HOST}" == "postgres" ]]; then DB_HOST="127.0.0.1"; fi
      PGPASSWORD="${DB_PASS}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges > "${DB_DUMP}" 2>/dev/null || {
        print_warning "Aviso: Não foi possível fazer dump do PostgreSQL"
        print_info "Execute manualmente: PGPASSWORD=*** pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} --clean --if-exists --no-owner --no-privileges > ${DB_DUMP}"
      }
    else
      print_warning "pg_dump não encontrado. Use o container do postgres ou instale: apt-get install postgresql-client"
    fi
  else
    print_warning "Não foi possível parsear DATABASE_URL do PostgreSQL"
  fi
elif [[ "${DATABASE_URL}" == file:* ]]; then
  # SQLite
  print_info "Detectado: SQLite"
  DB_FILE=$(echo "${DATABASE_URL}" | sed 's/file://')
  
  if [ -f "${SCRIPT_DIR}/backend/${DB_FILE}" ]; then
    cp "${SCRIPT_DIR}/backend/${DB_FILE}" "${TEMP_DIR}/painel-iptv/database.sqlite" || {
      print_warning "Não foi possível copiar arquivo SQLite"
    }
    print_success "SQLite copiado"
  elif [ -f "${DB_FILE}" ]; then
    cp "${DB_FILE}" "${TEMP_DIR}/painel-iptv/database.sqlite" || {
      print_warning "Não foi possível copiar arquivo SQLite"
    }
    print_success "SQLite copiado"
  else
    print_warning "Arquivo SQLite não encontrado: ${DB_FILE}"
  fi
else
  print_warning "Tipo de banco de dados não suportado para backup automático: ${DATABASE_URL}"
fi

# Criar arquivo .env.example baseado no .env atual (sem senhas)
print_info "📝 Criando .env.example..."
if [ -f "${SCRIPT_DIR}/.env" ]; then
  # Copiar .env mas remover valores sensíveis
  sed 's/=.*/=YOUR_VALUE_HERE/' "${SCRIPT_DIR}/.env" > "${TEMP_DIR}/painel-iptv/.env.example" 2>/dev/null || true
fi

# Criar arquivo de informações do backup
cat > "${TEMP_DIR}/painel-iptv/BACKUP_INFO.txt" << EOF
╔═══════════════════════════════════════════════════════════════╗
║          PAINEL IPTV MASTER - BACKUP COMPLETO                  ║
╚═══════════════════════════════════════════════════════════════╝

Data/Hora: $(date)
Timestamp: ${TIMESTAMP}
Versão: 2.0.0

📦 CONTEÚDO DO BACKUP:
- ✅ Código completo do projeto (backend + frontend)
- ✅ Banco de dados (MySQL ou SQLite)
- ✅ Scripts de instalação e restore
- ✅ Documentação completa
- ✅ Guia para iniciantes

📋 INSTALAÇÃO RÁPIDA (5 PASSOS):

1. Faça upload deste arquivo .tar.gz para sua VPS
2. Extraia: tar -xzf ${BACKUP_NAME}.tar.gz
3. Entre no diretório: cd painel-iptv
4. Execute: sudo bash INSTALL.sh
5. Configure o .env e inicie: ./start.sh

📖 DOCUMENTAÇÃO:
- 🔰 INICIANTES: Leia GUIA_INSTALACAO_INICIANTE.md
- 📚 TÉCNICA: Leia GUIA_INSTALACAO_COMPLETO.md
- 📘 COMPLETA: Leia DOCUMENTACAO_PAINEL.md

⚠️  IMPORTANTE:
- Configure o arquivo backend/.env após a instalação
- Altere a senha padrão (admin/admin123)
- Configure SSL/HTTPS em produção
- Abra as portas 3001 e 5173 no firewall

💡 REQUISITOS MÍNIMOS VPS:
- RAM: 2GB (mínimo 1GB)
- Disco: 20GB SSD
- Sistema: Ubuntu 20.04+ ou Debian 11+
- Processador: 1 vCore

✅ Este backup contém tudo necessário para instalar o painel
   em uma nova VPS compatível. Siga o guia para iniciantes!
EOF

# Criar arquivo .tar.gz
print_info "📦 Compactando backup..."
cd "${TEMP_DIR}"
tar -czf "${BACKUP_PATH}.tar.gz" painel-iptv/ || {
  print_error "Erro ao compactar backup"
  exit 1
}

# Mover para o diretório original
mv "${BACKUP_PATH}.tar.gz" "${SCRIPT_DIR}/"

# Calcular tamanho e hash
BACKUP_SIZE=$(du -h "${SCRIPT_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)
BACKUP_HASH=$(sha256sum "${SCRIPT_DIR}/${BACKUP_NAME}.tar.gz" | cut -d' ' -f1)

print_success "Backup completo criado com sucesso!"
echo ""
print_info "📊 Informações do backup:"
echo "   Arquivo: ${BACKUP_NAME}.tar.gz"
echo "   Tamanho: ${BACKUP_SIZE}"
echo "   SHA256:  ${BACKUP_HASH:0:32}..."
echo ""
print_info "💡 PRÓXIMOS PASSOS:"
echo "   1. Faça upload deste arquivo para seu Google Drive"
echo "   2. Para instalar em nova VPS:"
echo "      - Baixe o arquivo"
echo "      - Extraia: tar -xzf ${BACKUP_NAME}.tar.gz"
echo "      - Execute: cd painel-iptv && sudo bash INSTALL.sh"
echo ""
print_success "✅ Backup pronto para upload no Google Drive!"

