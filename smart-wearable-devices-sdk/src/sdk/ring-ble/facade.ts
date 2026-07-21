import type { RingBleRuntime, RingBleState, RingDeviceInfo, RingProtocolKind } from './types';
import { createLegacyRingAdapter, type LegacyRingAdapter } from './legacy/adapter';
import { createQkeerV2RingAdapter } from './qkeer-v2';
import { createRwRingAdapter } from './rw';
export { getRingProtocolDetectors, registerRingProtocolDetector, resolveRingProtocol } from './protocolRegistry';

export const createRingBleFacade = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  return createLegacyRingAdapter(state, runtime);
};

export const createRingBleAdapterByProtocol = (
  protocol: RingProtocolKind,
  state: RingBleState,
  runtime?: RingBleRuntime
): LegacyRingAdapter => {
  if (protocol === 'qkeer-v2') {
    return createQkeerV2RingAdapter(state, runtime);
  }

  if (protocol === 'rw') {
    return createRwRingAdapter(state, runtime);
  }

  return createLegacyRingAdapter(state, runtime);
};
