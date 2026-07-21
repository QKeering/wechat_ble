import { handleRingParsedData, resetRingRuntimeState } from './storeBridge';
import { buildRingBusinessMetrics } from './businessMetrics';
import type { RingParsedData, RingStoreBridgeTarget } from './types';

const received: RingParsedData[] = [];
const normalized: any[] = [];
let deviceInfo: Record<string, any> = {
  deviceId: '3E:00:00:00:05:1B',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
};

const bridge: RingStoreBridgeTarget = {
  get deviceInfo() {
    return deviceInfo;
  },
  get receivedData() {
    return received;
  },
  get normalizedRingData() {
    return normalized;
  },
  handleParsedData(parsed) {
    received.push(parsed);
  },
  handleNormalizedRingData(item) {
    normalized.push(item);
  },
  updateDeviceInfo(payload) {
    deviceInfo = payload;
  },
  updateReceivedData(payload) {
    received.splice(0, received.length, ...payload);
  },
  updateNormalizedRingData(payload) {
    normalized.splice(0, normalized.length, ...payload);
  }
};

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  battery: 57,
  chargingStatusText: '未充电'
});

handleRingParsedData(bridge, {
  type: 'qkeer_v2_last_data',
  protocol: 'qkeer-v2',
  step: 1234,
  isWorn: true
});

if (
  getRuntimeLength(received) !== 1 ||
  getRuntimeLength(normalized) !== 1 ||
  normalized[0].sourceType !== 'battery' ||
  normalized[0].metrics.battery !== 57
) {
  throw new Error(`Store bridge should ignore parsed data from another protocol: ${JSON.stringify({ received, normalized })}`);
}

deviceInfo = {
  deviceId: 'unknown-protocol-device'
};

handleRingParsedData(bridge, {
  type: 'qkeer_v2_last_data',
  protocol: 'qkeer-v2',
  step: 1234,
  isWorn: true
});

if (
  getRuntimeLength(received) !== 2 ||
  getRuntimeLength(normalized) !== 2 ||
  normalized[1].sourceType !== 'qkeer_v2_last_data' ||
  normalized[1].metrics.stepCount !== 1234 ||
  normalized[1].metrics.isWorn !== true
) {
  throw new Error(`Store bridge should accept protocol data while the current device protocol is still unknown: ${JSON.stringify({ received, normalized })}`);
}

deviceInfo = {
  deviceId: '3E:00:00:00:05:1B',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
};

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  deviceId: 'old-device',
  battery: 99
});

if (getRuntimeLength(received) !== 2 || getRuntimeLength(normalized) !== 2) {
  throw new Error(`Store bridge should ignore parsed data from a stale device: ${JSON.stringify({ received, normalized })}`);
}

deviceInfo = {
  deviceId: '111111ABCDEF',
  protocol: 'rw'
};

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  deviceId: '222222ABCDEF',
  battery: 98
});

if (getRuntimeLength(received) !== 2 || getRuntimeLength(normalized) !== 2) {
  throw new Error(`Store bridge should not tail-match random RW platform device ids: ${JSON.stringify({ received, normalized })}`);
}

deviceInfo = {
  deviceId: '3E:00:00:00:05:1B',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
};

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  mac: '00:05:1B',
  battery: 58
});

if (getRuntimeLength(received) !== 3 || getRuntimeLength(normalized) !== 3 || normalized[2].metrics.battery !== 58) {
  throw new Error(`Store bridge should accept RW parsed data matched by stable MAC tail: ${JSON.stringify({ received, normalized })}`);
}

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  battery: 59
});

if (getRuntimeLength(received) !== 4 || getRuntimeLength(normalized) !== 4 || normalized[3].metrics.battery !== 59) {
  throw new Error(`Store bridge should accept RW parsed data matched by advertis macInfo: ${JSON.stringify({ received, normalized })}`);
}

handleRingParsedData(bridge, {
  type: 'rw_health_data_pending',
  protocol: 'rw',
  name: 'heart_rate',
  status: 'pending',
  message: 'pending'
});

if (getRuntimeLength(received) !== 5) {
  throw new Error(`Store bridge should keep parsed status packets without a device identity: ${JSON.stringify({ received })}`);
}

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  deviceId: '3E:00:00:00:05:1B',
  battery: 58
});

if (getRuntimeLength(received) !== 6 || getRuntimeLength(normalized) !== 6 || normalized[5].metrics.battery !== 58) {
  throw new Error(`Store bridge should accept parsed data from the active device: ${JSON.stringify({ received, normalized })}`);
}

const runtimeMetricStartIndex = normalized.length;
const rwRuntimeMetricPackets: RingParsedData[] = [
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'heart_rate',
    key: 0x0224,
    value: 46,
    data: [46]
  } as RingParsedData,
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'blood_oxygen',
    key: 0x024e,
    value: 97,
    data: [97]
  } as RingParsedData,
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'temperature',
    key: 0x0230,
    value: 36.5,
    data: [0x42, 0x0e]
  } as RingParsedData,
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'hrv',
    key: 0x0269,
    value: 62,
    data: [62]
  } as RingParsedData,
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'stress',
    key: 0x024f,
    value: 34,
    data: [34]
  } as RingParsedData,
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'blood_sugar',
    key: 0x026c,
    value: 59,
    data: [59]
  } as RingParsedData,
  {
    type: 'rw_health_data',
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    name: 'blood_pressure',
    key: 0x0231,
    value: { systolic: 121, diastolic: 80 },
    data: [0x11, 121, 80]
  } as RingParsedData
];

rwRuntimeMetricPackets.forEach((packet) => handleRingParsedData(bridge, packet));

const runtimeMetricRecords = normalized.slice(runtimeMetricStartIndex);
const runtimeMetrics = buildRingBusinessMetrics(runtimeMetricRecords);

if (
  getRuntimeLength(received) !== 13 ||
  getRuntimeLength(normalized) !== 13 ||
  runtimeMetricRecords.length !== rwRuntimeMetricPackets.length ||
  runtimeMetrics.heartRate !== 46 ||
  runtimeMetrics.bloodOxygen !== 97 ||
  runtimeMetrics.temperature !== '36.5°C' ||
  runtimeMetrics.hrv !== 62 ||
  runtimeMetrics.stress !== 34 ||
  runtimeMetrics.bloodSugar !== 5.9 ||
  (runtimeMetrics.bloodPressure as any)?.systolic !== 121 ||
  (runtimeMetrics.bloodPressure as any)?.diastolic !== 80
) {
  throw new Error(
    `Store bridge should turn SY03 RW realtime packets into L19-compatible business metrics: ${JSON.stringify({
      received,
      runtimeMetricRecords,
      runtimeMetrics
    })}`
  );
}

resetRingRuntimeState(bridge);

const receivedCountAfterReset: number = received.length;
const normalizedCountAfterReset: number = normalized.length;

if (deviceInfo.deviceId || receivedCountAfterReset !== 0 || normalizedCountAfterReset !== 0) {
  throw new Error(`Store bridge reset should clear selected device and runtime data: ${JSON.stringify({ deviceInfo, received, normalized })}`);
}

handleRingParsedData(bridge, {
  type: 'rw_health_data_pending',
  protocol: 'rw',
  name: 'heart_rate',
  status: 'pending',
  message: 'pending'
});

handleRingParsedData(bridge, {
  type: 'battery',
  protocol: 'rw',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  battery: 60
});

if (getRuntimeLength(received) !== 0 || getRuntimeLength(normalized) !== 0) {
  throw new Error(`Store bridge should reject late parsed packets after runtime reset: ${JSON.stringify({ received, normalized })}`);
}

export const storeBridgeParityPassed = true;

function getRuntimeLength(items: unknown[]) {
  return [...items].length;
}
