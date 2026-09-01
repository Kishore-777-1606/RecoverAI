/**
 * Business classifications for gateway payment failures.
 */
export type FailureClass =
  | 'INSUFFICIENT_FUNDS'
  | 'CARD_DECLINED'
  | 'TEMPORARY_BANK_ISSUE'
  | 'NETWORK_ERROR'
  | 'UPI_TIMEOUT'
  | 'AUTHENTICATION_FAILED'
  | 'FRAUD_BLOCK'
  | 'OTHER_UNKNOWN';

/**
 * Normalizes a database failure type code into a standard domain category.
 */
export function classifyFailure(failureTypeId: string | null): FailureClass {
  if (!failureTypeId) {
    return 'OTHER_UNKNOWN';
  }

  const upper = failureTypeId.toUpperCase();

  switch (upper) {
    case 'INSUFFICIENT_FUNDS':
      return 'INSUFFICIENT_FUNDS';
    case 'CARD_DECLINED':
      return 'CARD_DECLINED';
    case 'TEMPORARY_BANK_ISSUE':
    case 'BANK_ISSUE':
      return 'TEMPORARY_BANK_ISSUE';
    case 'NETWORK_ERROR':
    case 'TIMEOUT_NETWORK':
      return 'NETWORK_ERROR';
    case 'UPI_TIMEOUT':
    case 'COLLECT_TIMEOUT':
      return 'UPI_TIMEOUT';
    case 'AUTHENTICATION_FAILED':
    case 'INCORRECT_OTP':
    case 'INCORRECT_PIN':
      return 'AUTHENTICATION_FAILED';
    case 'FRAUD_BLOCK':
    case 'RISK_BLOCK':
      return 'FRAUD_BLOCK';
    default:
      return 'OTHER_UNKNOWN';
  }
}

/**
 * Strategy heuristics mapping.
 * Suggests a default strategy based on the nature of the transaction failure.
 */
export function getPreferredStrategy(failureClass: FailureClass): string {
  switch (failureClass) {
    case 'NETWORK_ERROR':
    case 'TEMPORARY_BANK_ISSUE':
      // Technical/intermittent bank switch errors resolve best through delayed automatic retry sweeps
      return 'DELAYED_RETRY';

    case 'INSUFFICIENT_FUNDS':
    case 'UPI_TIMEOUT':
    case 'CARD_DECLINED':
    case 'AUTHENTICATION_FAILED':
      // funding/auth issues require customer actions (e.g. paying via alternative cards/accounts)
      return 'RECOVERY_LINK';

    case 'FRAUD_BLOCK':
    case 'OTHER_UNKNOWN':
    default:
      // Risk locks or unclassified errors require human intervention
      return 'MANUAL_REVIEW';
  }
}
