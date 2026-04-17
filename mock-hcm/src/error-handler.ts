import { FastifyReply } from 'fastify';
import { HcmStore } from './store';

/**
 * Simulates an HCM error based on the current error mode.
 * Returns true if an error was simulated (response already sent),
 * false if no error was triggered and the caller should proceed normally.
 */
export async function maybeSimulateError(store: HcmStore, reply: FastifyReply): Promise<boolean> {
  if (!store.shouldError()) return false;

  const mode = store.errorMode;

  switch (mode.errorType) {
    case 'timeout':
      await new Promise((resolve) => setTimeout(resolve, 30000));
      reply.status(504).send({ error: 'Gateway Timeout', code: 'TIMEOUT' });
      return true;

    case '500':
      reply.status(500).send({ error: 'Internal Server Error', code: 'HCM_INTERNAL_ERROR' });
      return true;

    case '400':
      reply.status(400).send({ error: 'Bad Request', code: 'HCM_BAD_REQUEST' });
      return true;

    case 'validation':
      reply.status(422).send({ error: 'Validation failed', code: 'HCM_VALIDATION_ERROR' });
      return true;

    default:
      reply.status(500).send({ error: 'Internal Server Error', code: 'HCM_INTERNAL_ERROR' });
      return true;
  }
}