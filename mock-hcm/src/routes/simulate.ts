import { FastifyInstance } from 'fastify';
import { HcmStore } from '../store';
import { SimulateAnniversaryRequest, SimulateErrorModeRequest, SeedBalanceRequest } from '../schemas';

export async function simulateRoutes(fastify: FastifyInstance, opts: { store: HcmStore }) {
  const { store } = opts;

  fastify.post<{ Body: unknown }>('/hcm/simulate/seed', async (request, reply) => {
    const parsed = SeedBalanceRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid seed data',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    store.seedBalances(parsed.data);

    return reply.send({
      message: 'Balances seeded successfully',
      count: parsed.data.length,
    });
  });

  fastify.post<{ Body: unknown }>('/hcm/simulate/anniversary', async (request, reply) => {
    const parsed = SimulateAnniversaryRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    const { employeeId, locationId, leaveType, bonusDays } = parsed.data;
    const newBalance = store.addAnniversaryBonus(employeeId, locationId, leaveType, bonusDays);

    if (!newBalance) {
      return reply.status(404).send({
        error: 'Balance not found for the given dimensions',
        code: 'NOT_FOUND',
      });
    }

    return reply.send({
      message: 'Anniversary bonus applied',
      employeeId,
      locationId,
      leaveType,
      bonusDays,
      newBalance,
    });
  });

  fastify.post<{ Body: unknown }>('/hcm/simulate/error-mode', async (request, reply) => {
    const parsed = SimulateErrorModeRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    store.setErrorMode({
      enabled: parsed.data.enabled,
      errorType: parsed.data.errorType || '500',
      errorRate: parsed.data.errorRate,
    });

    return reply.send({
      message: parsed.data.enabled ? 'Error mode enabled' : 'Error mode disabled',
      config: store.errorMode,
    });
  });

  fastify.post('/hcm/simulate/reset', async (request, reply) => {
    store.reset();
    return reply.send({
      message: 'HCM state reset successfully',
    });
  });
}