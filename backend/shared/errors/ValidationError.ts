import { AppError } from './AppError';

/**
 * Validation Error thrown when request payloads or schema validations fail.
 * Maps to HTTP 400 Bad Request.
 */
export class ValidationError extends AppError {
  public readonly errors?: Record<string, string[]>;

  constructor(message: string, errors?: Record<string, string[]>) {
    super(message, 400, true);
    this.errors = errors;
  }
}
