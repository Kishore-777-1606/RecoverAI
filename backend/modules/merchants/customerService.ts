import { PoolClient } from 'pg';
import * as customerRepo from '../../database/repositories/customerRepository';

/**
 * Lists customers scoped by merchant.
 */
export async function listCustomers(
  merchantId: string,
  filters: { page?: number; limit?: number },
  client?: PoolClient
) {
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  return customerRepo.listCustomersByMerchant(merchantId, { page, limit }, client);
}
