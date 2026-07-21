export interface RingOtaPartition {
  baseAddr: number;
  offset: number;
  data: Uint8Array;
  firstLineAddr: number;
  rawLines: Uint8Array[];
}

export type RingOtaProgressCallback = (percentage: number, stepName: string) => void;

export interface RingOtaOptions {
  mtu?: number;
  responseTimeoutMs?: number;
  chunkSize?: number;
  groupSize?: number;
  writeDelayMs?: number;
}

export interface RingOtaUuids {
  service: string;
  command: string;
  notify: string;
  data: string;
}

export interface RingOtaResponseCodes {
  partitionCountOk: string;
  partitionInfoOk: string;
  blockOk: string;
  partitionDone: string;
  allDone: string;
}

