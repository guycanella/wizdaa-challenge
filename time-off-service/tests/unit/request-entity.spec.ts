import { TimeOffRequest, RequestStatus, VALID_TRANSITIONS } from '../../src/request/request.entity';

describe('TimeOffRequest Entity', () => {
  function createRequest(status: RequestStatus): TimeOffRequest {
    const request = new TimeOffRequest();
    request.status = status;
    return request;
  }

  describe('canTransitionTo', () => {
    it('PENDING → APPROVED should be valid', () => {
      const request = createRequest(RequestStatus.PENDING);
      expect(request.canTransitionTo(RequestStatus.APPROVED)).toBe(true);
    });

    it('PENDING → REJECTED should be valid', () => {
      const request = createRequest(RequestStatus.PENDING);
      expect(request.canTransitionTo(RequestStatus.REJECTED)).toBe(true);
    });

    it('PENDING → CANCELLED should be valid', () => {
      const request = createRequest(RequestStatus.PENDING);
      expect(request.canTransitionTo(RequestStatus.CANCELLED)).toBe(true);
    });

    it('PENDING → CONFIRMED should be invalid', () => {
      const request = createRequest(RequestStatus.PENDING);
      expect(request.canTransitionTo(RequestStatus.CONFIRMED)).toBe(false);
    });

    it('PENDING → SUBMITTED_TO_HCM should be invalid', () => {
      const request = createRequest(RequestStatus.PENDING);
      expect(request.canTransitionTo(RequestStatus.SUBMITTED_TO_HCM)).toBe(false);
    });

    it('APPROVED → SUBMITTED_TO_HCM should be valid', () => {
      const request = createRequest(RequestStatus.APPROVED);
      expect(request.canTransitionTo(RequestStatus.SUBMITTED_TO_HCM)).toBe(true);
    });

    it('APPROVED → CANCELLED should be invalid', () => {
      const request = createRequest(RequestStatus.APPROVED);
      expect(request.canTransitionTo(RequestStatus.CANCELLED)).toBe(false);
    });

    it('SUBMITTED_TO_HCM → CONFIRMED should be valid', () => {
      const request = createRequest(RequestStatus.SUBMITTED_TO_HCM);
      expect(request.canTransitionTo(RequestStatus.CONFIRMED)).toBe(true);
    });

    it('SUBMITTED_TO_HCM → HCM_REJECTED should be valid', () => {
      const request = createRequest(RequestStatus.SUBMITTED_TO_HCM);
      expect(request.canTransitionTo(RequestStatus.HCM_REJECTED)).toBe(true);
    });

    it('SUBMITTED_TO_HCM → CANCELLED should be invalid', () => {
      const request = createRequest(RequestStatus.SUBMITTED_TO_HCM);
      expect(request.canTransitionTo(RequestStatus.CANCELLED)).toBe(false);
    });

    it('CONFIRMED → CANCELLED should be valid', () => {
      const request = createRequest(RequestStatus.CONFIRMED);
      expect(request.canTransitionTo(RequestStatus.CANCELLED)).toBe(true);
    });

    it('CONFIRMED → PENDING should be invalid', () => {
      const request = createRequest(RequestStatus.CONFIRMED);
      expect(request.canTransitionTo(RequestStatus.PENDING)).toBe(false);
    });

    it('REJECTED → any should be invalid (terminal state)', () => {
      const request = createRequest(RequestStatus.REJECTED);
      for (const status of Object.values(RequestStatus)) {
        expect(request.canTransitionTo(status)).toBe(false);
      }
    });

    it('HCM_REJECTED → any should be invalid (terminal state)', () => {
      const request = createRequest(RequestStatus.HCM_REJECTED);
      for (const status of Object.values(RequestStatus)) {
        expect(request.canTransitionTo(status)).toBe(false);
      }
    });

    it('CANCELLED → any should be invalid (terminal state)', () => {
      const request = createRequest(RequestStatus.CANCELLED);
      for (const status of Object.values(RequestStatus)) {
        expect(request.canTransitionTo(status)).toBe(false);
      }
    });
  });

  describe('VALID_TRANSITIONS completeness', () => {
    it('should have an entry for every RequestStatus', () => {
      for (const status of Object.values(RequestStatus)) {
        expect(VALID_TRANSITIONS[status]).toBeDefined();
      }
    });

    it('terminal states should have empty transition arrays', () => {
      expect(VALID_TRANSITIONS[RequestStatus.REJECTED]).toEqual([]);
      expect(VALID_TRANSITIONS[RequestStatus.HCM_REJECTED]).toEqual([]);
      expect(VALID_TRANSITIONS[RequestStatus.CANCELLED]).toEqual([]);
    });
  });
});