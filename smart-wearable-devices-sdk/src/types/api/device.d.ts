/** 设备信息类型定义 */
export type DeviceInfo = {
  /** 设备id */
  id: number; // integer<int64> 对应 TS 中的 number（或 bigint，若数值超过 Number.MAX_SAFE_INTEGER）
  /** 用户id */
  userId: number; // integer<int64>
  /** 设备型号id */
  modelId: number; // integer<int64>
  /** 设备名称 */
  deviceName: string;
  /** 固件版本 */
  firmwareVersion: string;
  /** 硬件版本 */
  hardwareVersion: string;
  /** 序列号 */
  sn: string;
  /** MAC地址 */
  mac: string;
  /** 二维码地址 */
  qrcodeUrl: string;
  /** 在线状态（0:离线; 1:在线） */
  online: 0 | 1; // 用字面量类型限定取值范围
  /** 设备电量 */
  battery: number;
  /** 最后同步地址 */
  lastSyncAddress: string;
  /** 最后同步时间（时间格式） */
  lastSyncTime: string; // @datetime 对应 TS 中的 string（通常是 ISO 格式）
  /** 型号唯一标识符 */
  modelKey: string;
  /** 型号名称 */
  modelName: string;
  /** 设备大小 */
  deviceSize: number;
  /** 设备版本 */
  deviceVersion: string;
  /** 服务id */
  serviceId: string;
};
export type DeviceModel = {
  /** 设备型号id */
  id: number; // integer<int64> 对应 TS 的 number（若数值超范围可改用 bigint）
  /** 型号唯一标识符 */
  modelKey: string;
  /** 型号名称 */
  modelName: string;
  /** 设备大小 */
  deviceSize: number;
  /** 设备版本 */
  deviceVersion: string;
  /** 删除标志（0代表存在 1代表删除） */
  delFlag: '0' | '1'; // 用字面量类型限定取值范围
  /** 创建时间（时间格式，通常为 ISO 格式字符串） */
  createTime: string; // @datetime 对应 string 类型
  /** 更新时间（时间格式，通常为 ISO 格式字符串） */
  updateTime: string; // @datetime 对应 string 类型
};
