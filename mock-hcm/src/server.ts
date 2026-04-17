import Fastify from 'fastify';
import { HcmStore, store as defaultStore } from './store';
import { balanceRoutes } from './routes/balances';
import { timeOffRoutes } from './routes/time-off';
import { simulateRoutes } from './routes/simulate';

export interface MockHcmServerOptions {
  port?: number;
  host?: string;
  store?: HcmStore;
  logger?: boolean;
}

export async function buildServer(options: MockHcmServerOptions = {}) {
  const {
    store = defaultStore,
    logger = true,
  } = options;

  const fastify = Fastify({ logger });

  await fastify.register(balanceRoutes, { store });
  await fastify.register(timeOffRoutes, { store });
  await fastify.register(simulateRoutes, { store });

  fastify.get('/hcm/health', async () => ({
    status: 'ok',
    service: 'mock-hcm',
    timestamp: new Date().toISOString(),
  }));

  return fastify;
}

async function start() {
  const port = parseInt(process.env.HCM_PORT || '3001', 10);
  const host = process.env.HCM_HOST || '0.0.0.0';

  const server = await buildServer({ logger: true });

  try {
    await server.listen({ port, host });
    console.log(`Mock HCM server running at http://${host}:${port}`);
    console.log('Endpoints:');
    console.log('  GET  /hcm/health');
    console.log('  GET  /hcm/balances/:employeeId/:locationId');
    console.log('  GET  /hcm/balances/batch');
    console.log('  POST /hcm/time-off');
    console.log('  DELETE /hcm/time-off/:referenceId');
    console.log('  POST /hcm/simulate/seed');
    console.log('  POST /hcm/simulate/anniversary');
    console.log('  POST /hcm/simulate/error-mode');
    console.log('  POST /hcm/simulate/reset');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}