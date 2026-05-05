import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { ZodError } from 'zod';

const logger = createLogger('Error');

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({
    error: 'Rota não encontrada',
    path: req.originalUrl,
  });
}

export function errorMiddleware(
  err: Error | AppError | ZodError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Zod validation error
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Erro de validação',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // App error
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  // Unknown error
  logger.error(`Erro: ${err.message}`, { stack: err.stack });

  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Erro interno do servidor' 
      : err.message,
  });
}

export default { AppError, asyncHandler, notFoundMiddleware, errorMiddleware };
