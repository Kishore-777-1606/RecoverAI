import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../shared/errors/UnauthorizedError';
import { logger } from '../shared/logging/logger';

/**
 * Express middleware to resolve merchant isolation boundaries.
 * Reads 'x-merchant-id' header or 'merchantId' query parameter.
 */
export function merchantContext(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.headers['x-merchant-id'];
  const queryId = req.query.merchantId;
  
  const merchantId = headerId || queryId;

  if (!merchantId || typeof merchantId !== 'string') {
    logger.warn('Tenant access blocked: Missing or invalid x-merchant-id header context');
    throw new UnauthorizedError('Access Denied. x-merchant-id header or merchantId query parameter is required.');
  }

  // Inject merchant scoping context
  (req as any).merchantId = merchantId;
  next();
}
export default merchantContext;
