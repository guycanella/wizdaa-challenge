import { FastifyInstance } from 'fastify';
import { HcmStore } from '../store';
import { FileTimeOffRequest } from '../schemas';
import { maybeSimulateError } from '../error-handler';

export async function timeOffRoutes(fastify: FastifyInstance, opts: { store: HcmStore }) {
  const { store } = opts;

  fastify.post<{ Body: unknown }>('/hcm/time-off', async (request, reply) => {
    if (await maybeSimulateError(store, reply)) return;

    const parsed = FileTimeOffRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    const result = store.fileTimeOff(parsed.data);

    if (!result.success) {
      const statusCode = result.code === 'INSUFFICIENT_BALANCE' ? 409 : 400;
      return reply.status(statusCode).send({
        error: result.error,
        code: result.code,
      });
    }

    return reply.status(201).send({
      referenceId: result.record.referenceId,
      status: 'CONFIRMED',
      employeeId: result.record.employeeId,
      locationId: result.record.locationId,
      leaveType: result.record.leaveType,
      days: result.record.days,
      newBalance: result.newBalance,
    });
  });

  fastify.delete<{ Params: { referenceId: string } }>('/hcm/time-off/:referenceId', async (request, reply) => {
    if (await maybeSimulateError(store, reply)) return;

    const { referenceId } = request.params;
    const result = store.cancelTimeOff(referenceId);

    if (!result.success) {
      const statusCode = result.code === 'NOT_FOUND' ? 404 : 409;
      return reply.status(statusCode).send({
        error: result.error,
        code: result.code,
      });
    }

    return reply.send({
      referenceId,
      status: 'CANCELLED',
      restoredDays: result.restoredDays,
      newBalance: result.newBalance,
    });
  });
}