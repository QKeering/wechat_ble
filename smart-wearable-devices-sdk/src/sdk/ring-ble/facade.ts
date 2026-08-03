import type { RingBleRuntime, RingBleState, RingDeviceInfo, RingProtocolKind } from './types';
import { createLegacyRingAdapter, type LegacyRingAdapter } from './legacy/adapter';
import { createRwRingAdapter } from './rw';
export { getRingProtocolDetectors, registerRingProtocolDetector, resolveRingProtocol } from './protocolRegistry';

export const createRingBleFacade = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  return createLegacyRingAdapter(state, runtime);
};

export const createRingBleAdapterByProtocol = (protocol: RingProtocolKind, state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  if (protocol === 'rw') {
    return createRwRingAdapter(state, runtime);
  }

  // legacy 作为默认兜底
  return createLegacyRingAdapter(state, runtime);
};

/** 异步创建适配器，qkeer-v2 通过动态 import 按需加载，减小主包体积 */
export const createRingBleAdapterByProtocolAsync = async (protocol: RingProtocolKind, state: RingBleState, runtime?: RingBleRuntime): Promise<LegacyRingAdapter> => {
  if (protocol === 'qkeer-v2') {
    const { createQkeerV2RingAdapter } = await import('./qkeer-v2');
    return createQkeerV2RingAdapter(state, runtime);
  }

  // rw 和 legacy 保持同步创建
  return createRingBleAdapterByProtocol(protocol, state, runtime);
};
