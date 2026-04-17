import { FastifyInstance } from 'fastify';
import { HcmStore } from '../store';
import { LeaveType } from '../schemas';
import { maybeSimulateError } from '../error-handler';

export async function balanceRoutes(fastify: FastifyInstance, opts: { store: HcmStore }) {
  const { store } = opts;

  fastify.get<{
    Params: { employeeId: string; locationId: string };
    Querystring: { leaveType?: string };
  }>('/hcm/balances/:employeeId/:locationId', async (request, reply) => {
    if (await maybeSimulateError(store, reply)) return;

    const { employeeId, locationId } = request.params;
    const { leaveType } = request.query;

    if (leaveType) {
      const parsed = LeaveType.safeParse(leaveType);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid leave type',
          code: 'INVALID_LEAVE_TYPE',
          details: `Must be one of: ${LeaveType.options.join(', ')}`,
        });
      }

      const balance = store.getBalance(employeeId, locationId, parsed.data);
      if (!balance) {
        return reply.status(404).send({ error: 'Balance not found', code: 'NOT_FOUND' });
      }
      return reply.send(balance);
    }

    const allBalances = store.getBalancesByEmployee(employeeId)
      .filter((b) => b.locationId === locationId);

    if (allBalances.length === 0) {
      return reply.status(404).send({
        error: 'No balances found for this employee at this location',
        code: 'NOT_FOUND',
      });
    }

    return reply.send({ employeeId, locationId, balances: allBalances });
  });

  fastify.get('/hcm/balances/batch', async (request, reply) => {
    if (await maybeSimulateError(store, reply)) return;

    const balances = store.getAllBalances();
    return reply.send({
      balances,
      total: balances.length,
      generatedAt: new Date().toISOString(),
    });
  });
}