import type { Ref } from 'vue';

export type RingProtocolKind = 'legacy' | 'qkeer' | 'qkeer-v2' | 'rw';

export const RING_PARSED_EMITTED = Symbol.for('ring-ble.parsed.emitted');

export interface RingDeviceInfo {
  deviceId?: string;
  name?: string;
  serviceId?: string;
  cmdCharId?: string;
  dataCharId?: string;
  mac?: string;
  protocol?: RingProtocolKind;
  [key: string]: any;
}

export interface RingParsedData {
  type: string;
  status?: string;
  timestamp?: number;
  raw?: number[];
  records?: any[];
  [key: string]: any;
}

export interface RingBleState {
  devices: Ref<RingDeviceInfo[]>;
  isScanning: Ref<boolean>;
}

export interface RingBleAdapter {
  protocol: RingProtocolKind;
  state: RingBleState;
}

export interface RingProtocolDetector {
  protocol: RingProtocolKind;
  namePrefixes?: string[];
  productIds?: string[];
  serviceMarkers?: string[];
  match?: (device: RingDeviceInfo) => boolean;
}

export interface RingBleWriteDevice {
  deviceId?: string;
  serviceId?: string;
  cmdCharId?: string;
  dataCharId?: string;
}

export interface RingBleRuntime {
  getDeviceInfo: () => RingBleWriteDevice;
  onParsedData?: (parsed: RingParsedData) => void;
  onDeviceReady?: (device: RingDeviceInfo) => void;
  onDisconnected?: (reason?: unknown) => void;
  onBluetoothReadyChange?: (ready: boolean) => void;
  onReconnectStatusChange?: (status: RingReconnectStatus) => void;
  onReconnectResultChange?: (success: boolean | null) => void;
  onUploadingStatusChange?: (status: RingUploadingStatus) => void;
  uploadHistoricalRecords?: (records: RingHistoricalRecord[], parsed: RingParsedData) => Promise<unknown>;
  getBoundDevice?: () => Promise<RingBoundDevice | null | undefined>;
  bindDevice?: (payload: RingBindPayload) => Promise<unknown>;
  unbindDevice?: (payload: RingUnbindPayload) => Promise<unknown>;
}

export type RingReconnectStatus = 'idle' | 'reconnecting' | 'success' | 'failed';
export type RingUploadingStatus = 'idle' | 'uploading' | 'success' | 'failed';

export interface RingBoundDevice {
  deviceId?: string;
  mac?: string;
  name?: string;
  deviceName?: string;
  serviceId?: string;
  cmdCharId?: string;
  dataCharId?: string;
  dataServiceId?: string;
  uniMacId?: string;
  protocol?: RingProtocolKind;
  advertis?: Record<string, any>;
}

export interface RingBindPayload {
  mac: string;
  deviceId?: string;
  serviceId?: string;
  cmdCharId?: string;
  dataCharId?: string;
  dataServiceId?: string;
  uniMacId?: string;
  deviceName?: string;
  protocol?: RingProtocolKind;
  advertis?: Record<string, any>;
  replace?: boolean;
}

export interface RingUnbindPayload {
  mac: string;
}

export type RingHistoricalRecord = Record<string, any>;

export interface RingStoreBridgeTarget {
  handleParsedData?: (parsed: RingParsedData) => void;
  handleNormalizedRingData?: (normalized: any) => void;
  updateDeviceInfo?: (payload: RingDeviceInfo) => void;
  updateReceivedData?: (payload: RingParsedData[]) => void;
  updateNormalizedRingData?: (payload: any[]) => void;
  deviceInfo?: RingDeviceInfo;
  receivedData?: RingParsedData[];
  normalizedRingData?: any[];
}
