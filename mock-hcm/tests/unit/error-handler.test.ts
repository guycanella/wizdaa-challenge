import { maybeSimulateError } from '../../src/error-handler';
import { HcmStore } from '../../src/store';

// Mock FastifyReply
function createMockReply() {
  const reply: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: any) {
      reply.body = body;
      return reply;
    },
  };
  return reply;
}

describe('maybeSimulateError', () => {
  let store: HcmStore;

  beforeEach(() => {
    store = new HcmStore();
  });

  it('should return false when error mode is disabled', async () => {
    const reply = createMockReply();
    const result = await maybeSimulateError(store, reply);
    expect(result).toBe(false);
  });

  it('should return false when error rate is 0', async () => {
    store.setErrorMode({ enabled: true, errorType: '500', errorRate: 0 });
    const reply = createMockReply();
    const result = await maybeSimulateError(store, reply);
    expect(result).toBe(false);
  });

  it('should return 500 for error type "500"', async () => {
    store.setErrorMode({ enabled: true, errorType: '500', errorRate: 1 });
    const reply = createMockReply();
    const result = await maybeSimulateError(store, reply);
    expect(result).toBe(true);
    expect(reply.statusCode).toBe(500);
    expect(reply.body.code).toBe('HCM_INTERNAL_ERROR');
  });

  it('should return 400 for error type "400"', async () => {
    store.setErrorMode({ enabled: true, errorType: '400', errorRate: 1 });
    const reply = createMockReply();
    const result = await maybeSimulateError(store, reply);
    expect(result).toBe(true);
    expect(reply.statusCode).toBe(400);
    expect(reply.body.code).toBe('HCM_BAD_REQUEST');
  });

  it('should return 422 for error type "validation"', async () => {
    store.setErrorMode({ enabled: true, errorType: 'validation', errorRate: 1 });
    const reply = createMockReply();
    const result = await maybeSimulateError(store, reply);
    expect(result).toBe(true);
    expect(reply.statusCode).toBe(422);
    expect(reply.body.code).toBe('HCM_VALIDATION_ERROR');
  });

  it('should return 504 for error type "timeout"', async () => {
    // Override setTimeout to avoid waiting 30s
    jest.useFakeTimers();
    store.setErrorMode({ enabled: true, errorType: 'timeout', errorRate: 1 });
    const reply = createMockReply();

    const promise = maybeSimulateError(store, reply);
    jest.advanceTimersByTime(30000);
    const result = await promise;

    expect(result).toBe(true);
    expect(reply.statusCode).toBe(504);
    expect(reply.body.code).toBe('TIMEOUT');

    jest.useRealTimers();
  });
});