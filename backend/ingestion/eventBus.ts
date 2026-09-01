import { logger } from '../shared/logging/logger';

type EventHandler = (data: any) => Promise<void> | void;

/**
 * Lightweight, safe in-memory Event Bus.
 * Handles publish/subscribe dispatching within the modular monolith.
 */
class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();

  /**
   * Registers a callback listener for a specific internal event key.
   */
  public subscribe(eventName: string, handler: EventHandler): void {
    const list = this.handlers.get(eventName) || [];
    list.push(handler);
    this.handlers.set(eventName, list);
    logger.debug(`Subscriber registered for internal event: ${eventName}`);
  }

  /**
   * Dispatches event payload to all registered listeners.
   * Catches errors in individual listeners so one failing handler does not crash others.
   */
  public async publish(eventName: string, data: any): Promise<void> {
    logger.info(`Publishing internal event: ${eventName}`);
    const list = this.handlers.get(eventName) || [];

    const dispatches = list.map(async (handler) => {
      try {
        await handler(data);
      } catch (err: any) {
        logger.error(`Error executing event subscriber for: ${eventName}`, {
          error: err.message,
          stack: err.stack
        });
      }
    });

    await Promise.all(dispatches);
  }

  /**
   * Resets all subscribers (useful to isolate test suites runs).
   */
  public clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
