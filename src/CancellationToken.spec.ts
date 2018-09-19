import 'jest'
import CancellationToken from './CancellationToken'

/**
 * The number of iterations to run a loop that allocates memory that
 * should be released in each iteration.
 * @description This number is large enough that a leak will cause the test
 * to take a VERY long time due to constant GC (or crash from OOM).
 * It's also small enough for the test to pass quickly if there is no leak.
 */
const LEAK_LOOP_COUNT = 100000;

describe('A cancellation token', () => {

  describe('that was created independently', () => {

    let cancel: (reason?: any) => void;
    let token: CancellationToken;
    const reason = {};

    beforeEach(() => {
      ({ cancel, token } = CancellationToken.create());
    });

    it('claims to be cancelable', () => {
      expect(token.canBeCancelled).toBe(true);
    });

    it('should not be cancelled immediately after creation', () => {
      expect(token.isCancellationRequested).toBe(false);
    });

    it('should cancel correctly', () => {
      cancel(reason);
      expect(token.isCancellationRequested).toBe(true);
      expect(token.reason).toBe(reason);
    });

    it('should execute registered handlers upon cancellation', (done) => {
      token.onCancellationRequested((actualReason) => {
        expect(actualReason).toBe(reason);
        done();
      });
      cancel(reason);
    });

    it('should execute registered handlers immediately if canceled', () => {
      cancel(reason);
      let cbInvoked = false;
      const unregister = token.onCancellationRequested((actualReason) => {
        expect(actualReason).toBe(reason);
        cbInvoked = true;
      });
      expect(cbInvoked).toBe(true);
      unregister(); // no-op, but valid function
    });

    it('should not execute registered and removed handlers upon cancellation', () => {
      const disposeHandler = token.onCancellationRequested((actualReason) => {
        fail("Unexpected callback of disposed handler.");
      });
      disposeHandler();
      cancel(reason);
    });

    it('should throw a CancelledError when throwIfCancellationRequested is called and the token is cancelled', () => {
      cancel(reason);
      try {
        token.throwIfCancellationRequested();
        fail('Expected CancellationToken.Cancelled to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CancellationToken.CancellationError);
        expect(err.reason).toBe(reason);
      }
    });

    it('should not throw an error when throwIfCancellationRequested is called and the token is not cancelled', () => {
      token.throwIfCancellationRequested(); // should not throw
    })

    it('should throw an error when accessing the reason before the token is cancelled', () => {
      expect(() => token.reason).toThrow();
    });

    it('Can be raced against a promise and lose to fulfillment', async () => {
      const promise = new Promise<number>((resolve) => {
        setTimeout(resolve(5), 1);
      });
      const result = await token.racePromise(promise);
      expect(result).toEqual(5);
    });

    it('Can be raced against a promise and lose to rejection', async () => {
      const promise = new Promise<number>((resolve, reject) => {
        setTimeout(reject('oops'), 1);
      });
      try {
        await token.racePromise(promise);
        fail("Expected exception not thrown.");
      }
      catch (err) {
        expect(err).toEqual('oops');
      }
    });

    it('Can be raced against a promise and win', async () => {
      const promise = new Promise<number>(r => { });
      setTimeout(() => {
        cancel(reason);
      }, 10);
      try {
        await token.racePromise(promise);
        fail("expected error not thrown.");
      } catch (err) {
        expect(err).toBeInstanceOf(CancellationToken.CancellationError);
        expect(err.reason).toBe(reason);
      }
    });
  });

  describe('that was created via all', () => {

    let cancel1: (reason: any) => void;
    let cancel2: (reason: any) => void;
    let token1: CancellationToken;
    let token2: CancellationToken;
    let token: CancellationToken;
    const reason1 = {};
    const reason2 = {};

    beforeEach(() => {
      ({ cancel: cancel1, token: token1 } = CancellationToken.create());
      ({ cancel: cancel2, token: token2 } = CancellationToken.create());
      token = CancellationToken.all(token1, token2);
    });

    it('should be cancelled when all of the given tokens are cancelled', () => {
      // Cancel in reverse order to test that the reason array is ordered per the original `all` array.
      cancel2(reason2);
      cancel1(reason1);
      expect(token.isCancellationRequested).toBe(true);
      expect(token.reason).toHaveLength(2);
      expect(token.reason).toEqual(expect.arrayContaining([reason1, reason2]));
    });

    it('should not be cancelled when some of the given tokens are not cancelled', () => {
      cancel1(reason1);
      expect(token.isCancellationRequested).toBe(false);
    });

    it('should be cancelled immediately after creation if all of the given tokens are already cancelled', () => {
      cancel1(reason1);
      cancel2(reason2);
      const token = CancellationToken.all(token1, token2);
      expect(token.isCancellationRequested).toBe(true);
      expect(token.reason).toHaveLength(2);
      expect(token.reason).toEqual(expect.arrayContaining([reason1, reason2]));
    });

    it('Is CONTINUE if any are CONTINUE', () => {
      const token = CancellationToken.all(CancellationToken.CONTINUE, token1);
      expect(token).toBe(CancellationToken.CONTINUE);
    });
  });

  describe('that was created via race', () => {

    let cancel1: (reason?: any) => void;
    let cancel2: (reason?: any) => void;
    let token1: CancellationToken;
    let token2: CancellationToken;
    let token: CancellationToken;
    const reason = {};

    beforeEach(() => {
      ({ cancel: cancel1, token: token1 } = CancellationToken.create());
      ({ cancel: cancel2, token: token2 } = CancellationToken.create());
      token = CancellationToken.race(token1, token2);
    });

    it('should be cancelled when at least one of the given tokens is cancelled', () => {
      cancel1(reason);
      expect(token.isCancellationRequested).toBe(true);
      expect(token.reason).toBe(reason);
    });

    it('should not be cancelled when none of the given tokens are cancelled', () => {
      expect(token.isCancellationRequested).toBe(false);
    });

    it('should be cancelled immediately after creation if one of the given tokens is already cancelled', () => {
      cancel1(reason);
      token = CancellationToken.race(token1, token2);
      expect(token.isCancellationRequested).toBe(true);
      expect(token.reason).toBe(reason);
    });

    it('cancellation inherits reason from first token in array when both are canceled', () => {
      cancel1(reason);
      cancel2({});
      token = CancellationToken.race(token1, token2);
      expect(token.isCancellationRequested).toBe(true);
      expect(token.reason).toBe(reason);
    });
  });

  describe('that is long-lived', () => {
    it('works in common async pattern', async () => {
      const { token, cancel } = CancellationToken.create()
      for (let i = 0; i < 10; i++) {
        await someOperationAsync(token);
      }
    });

    async function someOperationAsync(token: CancellationToken): Promise<void> {
      token.throwIfCancellationRequested();

      let timer: NodeJS.Timer;
      let rejectPromise: (reason?: any) => void;

      const unregister = token.onCancellationRequested((reason) => {
        clearTimeout(timer);
        rejectPromise(new CancellationToken.CancellationError(reason));
      });

      const promise = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => { resolve(); unregister(); }, 0);
        rejectPromise = reject;
      });

      return promise;
    }

    it('does not leak resolving promises', async () => {
      const { token, cancel } = CancellationToken.create()
      for (let i = 0; i < LEAK_LOOP_COUNT; i++) {
        await someFastOperationAsync(token);
      }
    });

    async function someFastOperationAsync(token: CancellationToken): Promise<void> {
      token.throwIfCancellationRequested();

      let rejectPromise: (reason?: any) => void;

      const unregister = token.onCancellationRequested((reason) => {
        rejectPromise(new CancellationToken.CancellationError(reason));
      });

      const promise = new Promise<void>(resolve => resolve());
      unregister();

      return promise;
    }
  });
})

describe('The CONTINUE cancellation token', () => {

  it('claims to NOT be cancelable', () => {
    expect(CancellationToken.CONTINUE.canBeCancelled).toBe(false);
  });

  it('is not cancelled', () => {
    expect(CancellationToken.CONTINUE.isCancellationRequested).toBe(false);
  });

  it('does not leak from onCancellationRequested', () => {
    // Any event handlers to it should be immediately dropped rather than being stored,
    // forever leaking unbounded memory.
    for (var i = 0; i < LEAK_LOOP_COUNT; i++) {
      CancellationToken.CONTINUE.onCancellationRequested(() => { });
    }
  });

  it('does not leak from or with completed promise', () => {
    for (var i = 0; i < LEAK_LOOP_COUNT; i++) {
      CancellationToken.CONTINUE.racePromise(Promise.resolve());
    }
  });
})

describe('The CANCEL cancellation token', () => {

  it('is cancelled', () => {
    expect(CancellationToken.CANCELLED.isCancellationRequested).toBe(true);
  });

  it('claims to be cancelable', () => {
    expect(CancellationToken.CANCELLED.canBeCancelled).toBe(true);
  });
});
