// @vitest-environment jsdom
// The renderer's error-reporting seam: what reaches `telemetry:trackError` and
// what is dropped before it. The filter is asserted through `reportError` (not
// only on the pure predicate) because the wiring is the part that can regress —
// a report that slips past it spends a capped monthly quota on browser noise.
import { describe, it, expect, afterEach } from 'vitest';
import { installFakeElectronAPI, type FakeBridge } from './helpers/fake-electron-api';
import { isBenignBrowserNoise, reportError } from '../src/lib/telemetry';

let bridge: FakeBridge | null = null;

afterEach(() => {
  bridge?.restore();
  bridge = null;
});

describe('isBenignBrowserNoise', () => {
  it('matches both ResizeObserver wordings, prefixed or not', () => {
    expect(
      isBenignBrowserNoise('ResizeObserver loop completed with undelivered notifications.')
    ).toBe(true);
    expect(isBenignBrowserNoise('ResizeObserver loop limit exceeded')).toBe(true);
    expect(
      isBenignBrowserNoise(
        'Uncaught Error: ResizeObserver loop completed with undelivered notifications'
      )
    ).toBe(true);
  });

  it('leaves a real ResizeObserver defect alone', () => {
    expect(
      isBenignBrowserNoise(
        "Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'."
      )
    ).toBe(false);
  });
});

describe('reportError', () => {
  it('drops browser noise before it reaches the main process', () => {
    bridge = installFakeElectronAPI();
    reportError('ResizeObserver loop completed with undelivered notifications.', 'unhandled');
    expect(bridge.api.telemetry.trackError).not.toHaveBeenCalled();
  });

  it('forwards a real error with its name, message and stack', () => {
    bridge = installFakeElectronAPI();
    const err = new TypeError('cannot read x of undefined');
    reportError(err, 'unhandled');
    expect(bridge.api.telemetry.trackError).toHaveBeenCalledWith(
      { name: 'TypeError', message: 'cannot read x of undefined', stack: err.stack },
      'unhandled',
      'error'
    );
  });

  it('ignores an empty message', () => {
    bridge = installFakeElectronAPI();
    reportError('');
    expect(bridge.api.telemetry.trackError).not.toHaveBeenCalled();
  });
});
