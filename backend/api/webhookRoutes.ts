import { Router } from 'express';
import { handleWebhook, handleTwilioCallback } from '../ingestion/webhookController';

const router = Router();

router.post('/twilio/status', handleTwilioCallback);
router.post('/:provider', handleWebhook);

export default router;
