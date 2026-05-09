#!/bin/bash

################################################################################
#                    💾 BACKUP AUTOMÁTICO - PAINEL IPTV MASTER
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
║          💾 PAINEL IPTV MASTER - BACKUP AUTOMÁTICO            ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Configurações
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Criar diretório de backups se não existir
mkdir -p "${BACKUP_DIR}"

print_info "Iniciando backup do Painel IPTV Master..."
print_info "Timestamp: ${TIMESTAMP}"
print_info "Destino: ${BACKUP_PATH}"

# Criar diretório temporário para o backup
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

mkdir -p "${TEMP_DIR}/backup"

# 1. Backup do código (excluindo node_modules, dist, etc)
print_info "📦 Copiando código do projeto..."
rsync -aq \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='backups' \
  --exclude='_archive' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='storage/uploads' \
  --exclude='storage/banners' \
  --exclude='storage/videos' \
  "${SCRIPT_DIR}/" "${TEMP_DIR}/backup/" || {
  print_error "Erro ao copiar código"
  exit 1
}

# 2. Backup do banco de dados
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
    
    DB_DUMP="${TEMP_DIR}/backup/database_${DB_NAME}.sql"
    
    if command -v mysqldump &> /dev/null; then
      mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" > "${DB_DUMP}" 2>/dev/null || {
        print_warning "Aviso: Não foi possível fazer dump do MySQL (pode precisar de senha interativa)"
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

    DB_DUMP="${TEMP_DIR}/backup/database_${DB_NAME}.sql"

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
    cp "${SCRIPT_DIR}/backend/${DB_FILE}" "${TEMP_DIR}/backup/database.sqlite" || {
      print_warning "Não foi possível copiar arquivo SQLite"
    }
  elif [ -f "${DB_FILE}" ]; then
    cp "${DB_FILE}" "${TEMP_DIR}/backup/database.sqlite" || {
      print_warning "Não foi possível copiar arquivo SQLite"
    }
  else
    print_warning "Arquivo SQLite não encontrado: ${DB_FILE}"
  fi
else
  print_warning "Tipo de banco de dados não suportado para backup automático: ${DATABASE_URL}"
  print_info "Faça backup manual do banco de dados"
fi

# 3. Backup de storage/uploads (se existir e for pequeno)
print_info "📁 Verificando storage/uploads..."
if [ -d "${SCRIPT_DIR}/backend/storage/uploads" ]; then
  UPLOADS_SIZE=$(du -sm "${SCRIPT_DIR}/backend/storage/uploads" | cut -f1)
  if [ "${UPLOADS_SIZE}" -lt 1000 ]; then  # Menor que 1GB
    print_info "Copiando storage/uploads (${UPLOADS_SIZE}MB)..."
    cp -r "${SCRIPT_DIR}/backend/storage/uploads" "${TEMP_DIR}/backup/storage_uploads" 2>/dev/null || {
      print_warning "Não foi possível copiar storage/uploads"
    }
  else
    print_warning "storage/uploads muito grande (${UPLOADS_SIZE}MB). Pulando..."
    print_info "Faça backup manual de storage/uploads se necessário"
  fi
fi

# 4. Criar arquivo de informações do backup
cat > "${TEMP_DIR}/backup/BACKUP_INFO.txt" << EOF
PAINEL IPTV MASTER - BACKUP
============================
Data/Hora: $(date)
Timestamp: ${TIMESTAMP}
Versão: 2.0.0

Conteúdo:
- Código do projeto (backend + frontend)
- Banco de dados
- Storage/uploads (se disponível)

Para restaurar:
1. Extraia este backup
2. Execute: ./restore.sh
3. Ou siga as instruções em DOCUMENTACAO_PAINEL.md
EOF

# 5. Criar arquivo .tar.gz
print_info "📦 Compactando backup..."
cd "${TEMP_DIR}"
tar -czf "${BACKUP_PATH}.tar.gz" backup/ || {
  print_error "Erro ao compactar backup"
  exit 1
}

# 6. Calcular tamanho e hash
BACKUP_SIZE=$(du -h "${BACKUP_PATH}.tar.gz" | cut -f1)
BACKUP_HASH=$(sha256sum "${BACKUP_PATH}.tar.gz" | cut -d' ' -f1)

print_success "Backup criado com sucesso!"
echo ""
print_info "📊 Informações do backup:"
echo "   Arquivo: ${BACKUP_PATH}.tar.gz"
echo "   Tamanho: ${BACKUP_SIZE}"
echo "   SHA256:  ${BACKUP_HASH:0:16}..."
echo ""
print_info "💡 Para restaurar, execute: ./restore.sh ${BACKUP_NAME}.tar.gz"
echo ""

# 7. Limpar backups antigos (manter últimos 10)
print_info "🧹 Limpando backups antigos (mantendo últimos 10)..."
cd "${BACKUP_DIR}"
ls -t backup_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f

BACKUP_COUNT=$(ls -1 backup_*.tar.gz 2>/dev/null | wc -l)
print_info "Backups mantidos: ${BACKUP_COUNT}"

print_success "✅ Backup concluído!"
