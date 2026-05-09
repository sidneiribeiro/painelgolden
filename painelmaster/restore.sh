#!/bin/bash

################################################################################
#                    🔄 RESTORE - PAINEL IPTV MASTER
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
║          🔄 PAINEL IPTV MASTER - RESTORE                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Verificar argumento
if [ -z "$1" ]; then
    print_error "Uso: ./restore.sh <arquivo_backup.tar.gz>"
    print_info "Exemplo: ./restore.sh backups/backup_20250107_120000.tar.gz"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
    print_error "Arquivo de backup não encontrado: ${BACKUP_FILE}"
    exit 1
fi

print_info "Arquivo de backup: ${BACKUP_FILE}"

# Confirmar restore
print_warning "⚠️  ATENÇÃO: Esta operação irá restaurar o backup!"
print_warning "Certifique-se de ter feito backup do estado atual antes de continuar."
echo ""
read -p "Deseja continuar? (s/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    print_info "Restore cancelado"
    exit 0
fi

# Criar diretório temporário
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

print_info "Extraindo backup..."
tar -xzf "${BACKUP_FILE}" -C "${TEMP_DIR}" || {
    print_error "Erro ao extrair backup"
    exit 1
}

# Verificar estrutura
if [ ! -d "${TEMP_DIR}/backup" ]; then
    print_error "Estrutura de backup inválida"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Restaurar código (se necessário)
print_info "Verificando código do projeto..."
# Não restaurar código por padrão (pode sobrescrever mudanças)
# Descomente se necessário:
# print_info "Restaurando código..."
# cp -r "${TEMP_DIR}/backup/backend" "${SCRIPT_DIR}/" || true
# cp -r "${TEMP_DIR}/backup/frontend" "${SCRIPT_DIR}/" || true

# 2. Restaurar banco de dados
print_info "Restaurando banco de dados..."

# Carregar variáveis de ambiente (stack usa .env na raiz)
if [ -f "${SCRIPT_DIR}/.env" ]; then
    export $(grep -v '^#' "${SCRIPT_DIR}/.env" | xargs)
fi

DATABASE_URL="${DATABASE_URL:-file:./dev.db}"

if [[ "${DATABASE_URL}" == mysql://* ]] || [[ "${DATABASE_URL}" == mariadb://* ]]; then
    # MySQL/MariaDB
    DB_DUMP=$(find "${TEMP_DIR}/backup" -name "database_*.sql" | head -1)
    
    if [ -f "${DB_DUMP}" ]; then
        print_info "Restaurando MySQL..."
        
        # Extrair credenciais
        DB_URL_REGEX="mysql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)"
        if [[ "${DATABASE_URL}" =~ ${DB_URL_REGEX} ]]; then
            DB_USER="${BASH_REMATCH[1]}"
            DB_PASS="${BASH_REMATCH[2]}"
            DB_HOST="${BASH_REMATCH[3]}"
            DB_PORT="${BASH_REMATCH[4]}"
            DB_NAME="${BASH_REMATCH[5]}"
            
            mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" < "${DB_DUMP}" 2>/dev/null || {
                print_warning "Erro ao restaurar MySQL. Execute manualmente:"
                print_info "mysql -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} -p ${DB_NAME} < ${DB_DUMP}"
            }
        fi
    else
        print_warning "Dump MySQL não encontrado no backup"
    fi
elif [[ "${DATABASE_URL}" == postgresql://* ]] || [[ "${DATABASE_URL}" == postgres://* ]]; then
    # PostgreSQL
    DB_DUMP=$(find "${TEMP_DIR}/backup" -name "database_*.sql" | head -1)

    if [ -f "${DB_DUMP}" ]; then
        print_info "Restaurando PostgreSQL..."

        DB_URL_REGEX="postgres(ql)?://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)"
        if [[ "${DATABASE_URL}" =~ ${DB_URL_REGEX} ]]; then
            DB_USER="${BASH_REMATCH[2]}"
            DB_PASS="${BASH_REMATCH[3]}"
            DB_HOST="${BASH_REMATCH[4]}"
            DB_PORT="${BASH_REMATCH[6]:-5432}"
            DB_NAME="${BASH_REMATCH[7]}"

            if command -v docker &> /dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'painelmaster-postgres'; then
                docker exec -i -e PGPASSWORD="${DB_PASS}" painelmaster-postgres psql -U "${DB_USER}" -d "${DB_NAME}" < "${DB_DUMP}" 2>/dev/null || {
                    print_warning "Erro ao restaurar PostgreSQL via Docker. Execute manualmente:"
                    print_info "docker exec -i -e PGPASSWORD=*** painelmaster-postgres psql -U ${DB_USER} -d ${DB_NAME} < ${DB_DUMP}"
                }
            elif command -v psql &> /dev/null; then
                if [[ "${DB_HOST}" == "postgres" ]]; then DB_HOST="127.0.0.1"; fi
                PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" < "${DB_DUMP}" 2>/dev/null || {
                    print_warning "Erro ao restaurar PostgreSQL. Execute manualmente:"
                    print_info "PGPASSWORD=*** psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} < ${DB_DUMP}"
                }
            else
                print_warning "psql não encontrado. Use o container do postgres ou instale: apt-get install postgresql-client"
            fi
        else
            print_warning "Não foi possível parsear DATABASE_URL do PostgreSQL"
        fi
    else
        print_warning "Dump PostgreSQL não encontrado no backup"
    fi
elif [[ "${DATABASE_URL}" == file:* ]]; then
    # SQLite
    DB_FILE=$(find "${TEMP_DIR}/backup" -name "database.sqlite" | head -1)
    
    if [ -f "${DB_FILE}" ]; then
        print_info "Restaurando SQLite..."
        SQLITE_PATH=$(echo "${DATABASE_URL}" | sed 's/file://')
        
        if [ -f "${SCRIPT_DIR}/backend/${SQLITE_PATH}" ]; then
            cp "${DB_FILE}" "${SCRIPT_DIR}/backend/${SQLITE_PATH}" || {
                print_warning "Erro ao restaurar SQLite"
            }
        else
            print_warning "Caminho SQLite não encontrado: ${SQLITE_PATH}"
        fi
    else
        print_warning "Arquivo SQLite não encontrado no backup"
    fi
fi

# 3. Restaurar storage/uploads (se existir)
if [ -d "${TEMP_DIR}/backup/storage_uploads" ]; then
    print_info "Restaurando storage/uploads..."
    mkdir -p "${SCRIPT_DIR}/backend/storage/uploads"
    cp -r "${TEMP_DIR}/backup/storage_uploads"/* "${SCRIPT_DIR}/backend/storage/uploads/" 2>/dev/null || {
        print_warning "Erro ao restaurar storage/uploads"
    }
fi

# 4. Regenerar Prisma Client
print_info "Regenerando Prisma Client..."
cd "${SCRIPT_DIR}/backend"
npx prisma generate || {
    print_warning "Erro ao gerar Prisma Client"
}

print_success "✅ Restore concluído!"
echo ""
print_info "Próximos passos:"
print_info "1. Verifique o arquivo .env está configurado corretamente"
print_info "2. Execute: cd backend && npx prisma db push"
print_info "3. Reinicie os serviços: pm2 restart all"
echo ""
