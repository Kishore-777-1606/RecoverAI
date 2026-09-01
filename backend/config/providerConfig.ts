import { env } from './env';

export const providerConfig = {
  payment: {
    activeProvider: env.PAYMENT_PROVIDER,
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID || '',
      keySecret: env.RAZORPAY_KEY_SECRET || '',
    },
  },
  notification: {
    mode: env.NOTIFICATION_MODE,
    activeProvider: env.NOTIFICATION_PROVIDER,
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || '',
      authToken: env.TWILIO_AUTH_TOKEN || '',
      apiKeySid: env.TWILIO_API_KEY_SID || '',
      apiKeySecret: env.TWILIO_API_KEY_SECRET || '',
      fromSms: env.TWILIO_FROM_SMS || '',
      fromWhatsapp: env.TWILIO_FROM_WHATSAPP || '',
    },
  },
  webhook: {
    sharedSecret: env.WEBHOOK_SHARED_SECRET || '',
  },
};
