import { ID, AmountString, DateString } from '../../shared/types/common';

export type PaymentStatus = 'INITIATED' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';
export type PaymentEnvironment = 'LIVE' | 'TEST' | 'SIMULATION';

/**
 * Domain-level representation of an original Payment checkout transaction.
 * Declared as readonly to enforce immutability at compile time.
 */
export interface Payment {
  readonly payment_id: ID;
  readonly merchant_id: ID;
  readonly customer_id: ID;
  readonly payment_method_id: string;
  readonly amount: AmountString;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly failure_type_id: string | null;
  readonly failure_message: string | null;
  readonly external_reference: string;
  readonly provider_event_id: string | null;
  readonly environment: PaymentEnvironment;
  readonly simulation_session_id: ID | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly failed_at: Date | null;
  readonly successful_at: Date | null;
}

export interface CreatePaymentInput {
  merchant_id: ID;
  customer_id: ID;
  payment_method_id: string;
  amount: AmountString;
  currency?: string; // defaults to 'INR'
  status?: PaymentStatus; // defaults to 'INITIATED'
  external_reference: string;
  provider_event_id?: string;
  environment?: PaymentEnvironment; // defaults to 'LIVE'
  simulation_session_id?: ID;
}

export interface TransitionPaymentInput {
  status: PaymentStatus;
  failed_at?: Date;
  successful_at?: Date;
  failure_type_id?: string;
  failure_message?: string;
  provider_event_id?: string;
}
