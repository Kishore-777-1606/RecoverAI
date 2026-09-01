export interface NotificationRequest {
  recipient: string; // e.g. "+919876543210" or "cust@email.com"
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
  templateRef: string;
  variables: Record<string, string>;
  recoveryId: string;
  customerId: string;
}

export interface NotificationResponse {
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
  recipient: string;
  rawResponse: any;
  errorMessage?: string;
}

/**
 * Standard Notification Provider interface.
 * Decouples the application layer from external messaging APIs.
 */
export interface NotificationProvider {
  /**
   * Dispatches outbound templates (SMS/Email/WhatsApp) to customers.
   */
  sendNotification(request: NotificationRequest): Promise<NotificationResponse>;
}
