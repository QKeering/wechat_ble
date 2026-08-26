export interface DeviceInfo {
  mac?: string;
  deviceId?: string;
  deviceName?: string;
  name?: string;
  modelName?: string;
  productName?: string;
  bleName?: string;
  serviceId?: string;
  deviceSize?: string;
  deviceVersion?: string;
  firmwareVersion?: string;
  softwareVersion?: string;
  uiVersion?: string;
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
