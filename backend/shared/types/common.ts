/**
 * Shared foundational TypeScript declarations for the RecoverAI backend.
 */

export type ID = string;
export type DateString = string; // ISO 8601 UTC date string
export type AmountString = string; // 2-decimal money string representation

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
