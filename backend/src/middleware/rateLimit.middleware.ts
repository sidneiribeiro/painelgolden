import { Request, Response, NextFunction } from 'express';

// Rate limiter simples em memória
const requestCounts = new Map<string, { count: number; resetTime: number }>();

function createLimiter(name: string, windowMs: number, max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip || 'unknown'}`;
    const now = Date.now();
    
    let record = requestCounts.get(key);
    
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      requestCounts.set(key, record);
    } else {
      record.count++;
    }
    
    if (record.count > max) {
      return res.status(429).json({
        error: 'Muitas requisições. Tente novamente mais tarde.',
      });
    }
    
    next();
  };
}

// Limitadores
export const generalLimiter = createLimiter('general', 60 * 1000, 100); // 100 req/min
export const authLimiter = createLimiter('auth', 15 * 60 * 1000, 20); // 20 req/15min
export const createCustomerLimiter = createLimiter('create-customer', 60 * 1000, 30); // 30 req/min
export const publicCoreCheckoutCreateLimiter = createLimiter('public-core-checkout-create', 15 * 60 * 1000, 10); // 10 req/15min
export const publicCoreCheckoutStatusLimiter = createLimiter('public-core-checkout-status', 60 * 1000, 120); // 120 req/min

// Limpa o cache periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(key);
    }
  }
}, 60 * 1000);

export default {
  generalLimiter,
  authLimiter,
  createCustomerLimiter,
  publicCoreCheckoutCreateLimiter,
  publicCoreCheckoutStatusLimiter,
};
