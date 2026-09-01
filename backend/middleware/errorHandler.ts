import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors/AppError';
import { ValidationError } from '../shared/errors/ValidationError';
import { logger } from '../shared/logging/logger';
import { ApiErrorResponse } from '../shared/types/api';

/**
 * Global HTTP exception catcher that intercept failures, logs unhandled errors,
 * and normalizes error payloads into clean API responses.
 */
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details: Record<string, string[]> | undefined = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;

    if (err instanceof ValidationError) {
      details = err.errors;
    }
  } else {
    // Log native unhandled runtime errors
    logger.error('Unhandled server exception in API lifecycle', {
      error: err.message || String(err),
      stack: err.stack
    });
  }

  const errorResponse: ApiErrorResponse = {
    status: 'error',
    error: {
      message,
      details
    }
  };

  res.status(statusCode).json(errorResponse);
}
