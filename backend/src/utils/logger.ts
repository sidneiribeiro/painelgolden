import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

// Função para serializar objetos evitando referências circulares
function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    // Ignora objetos circulares
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
      
      // Extrai apenas informações úteis de objetos Error
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      
      // Extrai apenas informações úteis de objetos axios response
      if (value && value.config && value.request) {
        return {
          status: value.status,
          statusText: value.statusText,
          data: value.data,
        };
      }
    }
    return value;
  });
}

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? safeStringify(meta) : '';
  return `${timestamp} [${level}] ${message} ${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: '/tmp/backend.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      ),
    }),
  ],
});

export function createLogger(module: string) {
  return {
    info: (message: string, meta?: object) => logger.info(`[${module}] ${message}`, meta),
    error: (message: string, meta?: object) => logger.error(`[${module}] ${message}`, meta),
    warn: (message: string, meta?: object) => logger.warn(`[${module}] ${message}`, meta),
    debug: (message: string, meta?: object) => logger.debug(`[${module}] ${message}`, meta),
  };
}

export default logger;
