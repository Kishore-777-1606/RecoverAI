import { NotificationProvider, NotificationRequest, NotificationResponse } from './NotificationProvider';
import { generateUUID } from '../../shared/utils/id';
import { logger } from '../../shared/logging/logger';

/**
 * Demo Simulation Notification Provider.
 * Honest, zero-network simulator that produces deterministic simulation message IDs
 * and records dispatches cleanly without calling external gateways like Twilio/EmailJS/SMSLocal.
 */
export class SimulationNotificationProvider implements NotificationProvider {
  public async sendNotification(request: NotificationRequest): Promise<NotificationResponse> {
    const outcome = request.variables?.simulateOutcome || 'SENT';
    const simMessageId = `SIM-MSG-${generateUUID()}`;

    logger.info('Simulation Notification Provider dispatched outreach', {
      channel: request.channel,
      recipient: request.recipient,
      simMessageId,
      templateRef: request.templateRef,
      recoveryId: request.recoveryId,
      mode: 'SIMULATION'
    });

    if (outcome === 'FAILED') {
      return {
        providerMessageId: simMessageId,
        status: 'FAILED',
        channel: request.channel,
        recipient: request.recipient,
        rawResponse: {
          mode: 'SIMULATION',
          note: 'SIMULATED — notification dispatch simulated failure without external gateway.',
          simMessageId
        },
        errorMessage: 'SIMULATED: Outbound dispatch failed in simulation mode.'
      };
    }

    return {
      providerMessageId: simMessageId,
      status: 'SENT',
      channel: request.channel,
      recipient: request.recipient,
      rawResponse: {
        mode: 'SIMULATION',
        note: 'SIMULATED — notification dispatch completed without contacting external gateway.',
        simMessageId,
        template: request.templateRef,
        variables: request.variables
      }
    };
  }
}
