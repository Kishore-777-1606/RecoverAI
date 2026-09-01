import dotenv from 'dotenv';
import { z } from 'zod';

// Load environmental variables
dotenv.config();

const envSchema = z.object({
  APP_MODE: z.enum(['demo', 'live', 'test']).default('demo'),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid connection string" }),
  PAYMENT_PROVIDER: z.string().default('mock'),
  NOTIFICATION_PROVIDER: z.string().default('mock'),
  NOTIFICATION_MODE: z.enum(['simulation', 'real']).default('simulation'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  WEBHOOK_SHARED_SECRET: z.string().optional(),
  DEFAULT_AUTO_RECOVERY_ENABLED: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ).default(true),
  DEFAULT_MAX_AUTO_RECOVERY_AMOUNT: z.preprocess(
    (val) => Number(val),
    z.number().positive()
  ).default(5000),
  DEFAULT_MAX_RETRY_ATTEMPTS: z.preprocess(
    (val) => val !== undefined ? Number(val) : undefined,
    z.number().int().nonnegative()
  ).default(2),
  DEFAULT_RETRY_DELAY_MINUTES: z.preprocess(
    (val) => val !== undefined ? Number(val) : undefined,
    z.number().int().positive()
  ).default(60),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_FROM_SMS: z.string().optional(),
  TWILIO_FROM_WHATSAPP: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.NOTIFICATION_MODE === 'real' && data.NOTIFICATION_PROVIDER === 'twilio') {
    if (!data.TWILIO_ACCOUNT_SID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'TWILIO_ACCOUNT_SID is required when NOTIFICATION_PROVIDER is twilio'
      });
    }
    const hasAuthToken = !!data.TWILIO_AUTH_TOKEN;
    const hasApiKey = !!(data.TWILIO_API_KEY_SID && data.TWILIO_API_KEY_SECRET);
    if (!hasAuthToken && !hasApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_AUTH_TOKEN'],
        message: 'Either TWILIO_AUTH_TOKEN or both TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET must be configured when NOTIFICATION_PROVIDER is twilio'
      });
    }
    if (!data.TWILIO_FROM_SMS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_FROM_SMS'],
        message: 'TWILIO_FROM_SMS is required when NOTIFICATION_PROVIDER is twilio'
      });
    }
    if (!data.TWILIO_FROM_WHATSAPP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_FROM_WHATSAPP'],
        message: 'TWILIO_FROM_WHATSAPP is required when NOTIFICATION_PROVIDER is twilio'
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type EnvType = z.infer<typeof envSchema>;
