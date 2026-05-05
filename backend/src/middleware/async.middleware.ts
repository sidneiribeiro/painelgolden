import { Request, Response, NextFunction } from 'express';

/**
 * Async Handler Middleware
 * Wraps async route handlers to catch errors
 */
export const asyncHandler = (fn: Function) => 
  (req: Request, res: Response, next: NextFunction) => 
    Promise.resolve(fn(req, res, next)).catch(next);