import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('HTTP');

export function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const method = req.method;
    const url = req.originalUrl;
    const status = res.statusCode;
    
    // Ignora health checks
    if (url === '/api/health') return;
    
    const logFn = status >= 500 ? logger.error : status >= 400 ? logger.warn : logger.info;
    logFn(`${method} ${url} ${status} ${duration}ms`);
  });
  
  next();
}

export default loggerMiddleware;
