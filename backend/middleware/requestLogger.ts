import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logging/logger';

/**
 * Express middleware logging incoming API requests and durations.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request processed', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ip: req.ip,
      durationMs: duration
    });
  });

  next();
}
