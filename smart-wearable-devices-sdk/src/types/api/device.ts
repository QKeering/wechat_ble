export interface DeviceInfo {
  mac?: string;
  deviceId?: string;
  deviceName?: string;
  name?: string;
  serviceId?: string;
  deviceSize?: string;
  deviceVersion?: string;
  firmwareVersion?: string;
  productId?: string;
  sn?: string;
  [key: string]: any;
}

export interface DeviceModel {
  id?: string | number;
  name?: string;
  productId?: string;
  model?: string;
  [key: string]: any;
}
