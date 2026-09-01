import { AppError } from './AppError';

/**
 * Not Found Error thrown when a requested database row or route does not exist.
 * Maps to HTTP 404 Not Found.
 */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, true);
  }
}
