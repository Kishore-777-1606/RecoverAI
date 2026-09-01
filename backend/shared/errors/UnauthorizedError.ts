import { AppError } from './AppError';

/**
 * Unauthorized Error thrown when authentication headers, tokens, or merchant scopes are missing or invalid.
 * Maps to HTTP 401 Unauthorized.
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Access denied: Authentication required') {
    super(message, 401, true);
  }
}
