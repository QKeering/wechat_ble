export enum LegacyRingCommand {
  HardwareVersion = 'hardwareVersion',
  SoftwareVersion = 'softwareVersion',
  Battery = 'battery',
  ActiveMeasure = 'activeMeasure',
  BloodOxygen = 'bloodOxygen',
  BodyTemperature = 'bodyTemperature',
  ReadLocalData = 'readLocalData',
  ReadDeviceTime = 'readDeviceTime',
  UpdateDeviceTime = 'updateDeviceTime',
  DeleteAllLocalData = 'deleteAllLocalData',
  FactoryReset = 'factoryReset',
  SetCollectPeriod = 'setCollectPeriod',
  ReadCollectPeriod = 'readCollectPeriod'
}

export interface RingCommandPacket {
  cmd: number;
  subcmd: number;
  payload?: number[];
}

export const legacyCommandPackets: Record<LegacyRingCommand, RingCommandPacket> = {
  [LegacyRingCommand.HardwareVersion]: { cmd: 0x11, subcmd: 0x01 },
  [LegacyRingCommand.SoftwareVersion]: { cmd: 0x11, subcmd: 0x00 },
  [LegacyRingCommand.Battery]: { cmd: 0x12, subcmd: 0x00 },
  [LegacyRingCommand.ActiveMeasure]: { cmd: 0x31, subcmd: 0x00 },
  [LegacyRingCommand.BloodOxygen]: { cmd: 0x32, subcmd: 0x00 },
  [LegacyRingCommand.BodyTemperature]: { cmd: 0x34, subcmd: 0x00 },
  [LegacyRingCommand.ReadLocalData]: { cmd: 0x36, subcmd: 0x01 },
  [LegacyRingCommand.ReadDeviceTime]: { cmd: 0x10, subcmd: 0x01 },
  [LegacyRingCommand.UpdateDeviceTime]: { cmd: 0x10, subcmd: 0x00 },
  [LegacyRingCommand.DeleteAllLocalData]: { cmd: 0x36, subcmd: 0x03 },
  [LegacyRingCommand.FactoryReset]: { cmd: 0x37, subcmd: 0x02 },
  [LegacyRingCommand.SetCollectPeriod]: { cmd: 0x37, subcmd: 0x00 },
  [LegacyRingCommand.ReadCollectPeriod]: { cmd: 0x37, subcmd: 0x01 }
};

export const getLegacyCommandPacket = (command: LegacyRingCommand) => legacyCommandPackets[command];
