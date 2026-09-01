import { AppError } from './AppError';

/**
 * Base error representing third-party provider integrations issues.
 */
export class ProviderError extends AppError {
  public readonly providerName: string;
  public readonly rawError?: any;

  constructor(message: string, providerName: string, statusCode: number = 502, rawError?: any) {
    super(message, statusCode, true);
    this.providerName = providerName;
    this.rawError = rawError;
  }
}

/**
 * Thrown when gateway/communication requests timeout.
 */
export class ProviderTimeoutError extends ProviderError {
  constructor(message: string, providerName: string, rawError?: any) {
    super(message, providerName, 504, rawError);
  }
}

/**
 * Thrown when integration credentials or authentication headers are invalid.
 */
export class ProviderAuthenticationError extends ProviderError {
  constructor(message: string, providerName: string, rawError?: any) {
    super(message, providerName, 500, rawError);
  }
}

/**
 * Thrown when the integration endpoint returns 5xx service down.
 */
export class ProviderUnavailableError extends ProviderError {
  constructor(message: string, providerName: string, rawError?: any) {
    super(message, providerName, 503, rawError);
  }
}

/**
 * Thrown when the gateway explicitly declines or rejects a transaction.
 */
export class ProviderRejectedError extends ProviderError {
  public readonly declineCode?: string;

  constructor(message: string, providerName: string, declineCode?: string, rawError?: any) {
    super(message, providerName, 400, rawError);
    this.declineCode = declineCode;
  }
}
