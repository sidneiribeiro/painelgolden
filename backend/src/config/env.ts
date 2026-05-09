import dotenv from 'dotenv';
dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'default-jwt-secret-change-in-production',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  
  // URLs (para CORS, notificações, pagamentos)
  FRONTEND_URL: process.env.FRONTEND_URL || process.env.API_URL?.replace(/\/api\/?$/, '').replace(/:\d+$/, '') || 'http://localhost:5173',
  API_URL: process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3001'}`,
  
  // Encryption
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'default-encryption-key-32chars!',
  
  // TMDB API (opcional, pode ser gerenciado via banco de dados)
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',

  // Recovery (produção): habilita endpoint /api/auth/recover-admin
  ADMIN_RECOVERY_TOKEN: process.env.ADMIN_RECOVERY_TOKEN || '',
};

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';

export default env;
