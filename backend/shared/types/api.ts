/**
 * Standard API envelope structures for consistent router responses.
 */

export interface ApiResponse<T = any> {
  status: 'success';
  data: T;
}

export interface ApiErrorResponse {
  status: 'error';
  error: {
    message: string;
    code?: string;
    details?: Record<string, string[]>;
  };
}
