import {
  buildRwReadFileListCommand,
  buildRwReadLocalDataCommand,
  buildRwReadBatteryCommand,
  buildRwBatteryCommandVariants,
  buildRwFirmwareVersionCommandVariants,
  buildRwControlHealthDataCommand,
  buildRwReadFirmwareVersionCommand,
  buildRwDeleteHealthDataCommand,
  buildRwReadHealthDataCommand,
  buildRwReadHealthMonitoringCommand,
  buildRwSetBodyTemperatureDetectingCommand,
  buildRwSetHealthMonitoringCommand,
  buildRwSetUserProfileCommand,
  buildRwReadDateTimeKeyCommand,
  buildRwReadTimeCommand,
  buildRwFrame,
  buildRwLegacyCompatSyncTimeCommand,
  buildRwRequestUploadCommand,
  buildRwSetDateTimeKeyCommand,
  buildRwSyncTimeCommand,
  RwHealthDataControlKey,
  RwKey,
  bytesToHex,
  hexToBytes
} from './protocol';
import { parseRwRingData } from './parser';
import { normalizeRingData } from '../legacy/normalizer';
import { buildRingBusinessMetrics } from '../businessMetrics';
import { parseLegacyRingData } from '../legacy/parser';

const syncTime = buildRwSyncTimeCommand(1696687197195, 8);
if (bytesToHex(syncTime).slice(0, 8) !== '00011000') {
  throw new Error(`Unexpected RW sync-time header: ${bytesToHex(syncTime)}`);
}

if (syncTime.length !== 13 || syncTime[12] !== 8) {
  throw new Error(`Unexpected RW sync-time payload: ${bytesToHex(syncTime)}`);
}

if (bytesToHex(buildRwReadTimeCommand()).slice(0, 8) !== '00021001') {
  throw new Error('Unexpected RW read-time command.');
}

const rwDateTimeKey = buildRwSetDateTimeKeyCommand(new Date(2026, 6, 18, 20, 44, 24).getTime());
if (
  bytesToHex(rwDateTimeKey).slice(0, 8) !== 'ab010009' ||
  rwDateTimeKey.length !== 15 ||
  rwDateTimeKey[6] !== 0x02 ||
  rwDateTimeKey[7] !== 0x01 ||
  rwDateTimeKey[8] !== 0x00 ||
  rwDateTimeKey[9] !== 26 ||
  rwDateTimeKey[10] !== 7 ||
  rwDateTimeKey[11] !== 18 ||
  rwDateTimeKey[12] !== 20 ||
  rwDateTimeKey[13] !== 44 ||
  rwDateTimeKey[14] !== 24
) {
  throw new Error(`Unexpected RW JL date-time key command: ${bytesToHex(rwDateTimeKey)}`);
}

const rwReadDateTimeKey = buildRwReadDateTimeKeyCommand();
if (
  bytesToHex(rwReadDateTimeKey).slice(0, 8) !== 'ab010003' ||
  rwReadDateTimeKey.length !== 9 ||
  rwReadDateTimeKey[6] !== 0x02 ||
  rwReadDateTimeKey[7] !== 0x01 ||
  rwReadDateTimeKey[8] !== 0x10
) {
  throw new Error(`Unexpected RW JL read date-time key command: ${bytesToHex(rwReadDateTimeKey)}`);
}

const legacyCompatSyncTime = buildRwLegacyCompatSyncTimeCommand(1696687197195, 8);
if (
  legacyCompatSyncTime[0] !== 0x01 ||
  legacyCompatSyncTime[2] !== 0x10 ||
  legacyCompatSyncTime[3] !== 0x00 ||
  legacyCompatSyncTime.length !== 13 ||
  legacyCompatSyncTime[12] !== 8
) {
  throw new Error(`Unexpected RW legacy-compatible sync-time command: ${bytesToHex(legacyCompatSyncTime)}`);
}

if (bytesToHex(buildRwReadFileListCommand()).slice(0, 8) !== '00043610') {
  throw new Error('Unexpected RW file-list command.');
}

if (
  bytesToHex(buildRwReadLocalDataCommand(0x01020304, false)).slice(0, 16) !== '0005360004030201' ||
  bytesToHex(buildRwReadLocalDataCommand(0, true)).slice(0, 16) !== '0006360100000000'
) {
  throw new Error('Unexpected RW L19-compatible local-data command.');
}

if (bytesToHex(buildRwRequestUploadCommand(2)).slice(0, 10) !== '0007361a02') {
  throw new Error('Unexpected RW request-upload command.');
}

if (bytesToHex(buildRwReadBatteryCommand()) !== 'ab010003020310') {
  throw new Error(`Unexpected RW read-battery command: ${bytesToHex(buildRwReadBatteryCommand())}`);
}

const batteryCommandVariants = buildRwBatteryCommandVariants().map((item) => `${item.label}:${bytesToHex(item.bytes)}`);
const legacyBatteryVariant = batteryCommandVariants.find((variant) => variant.startsWith('legacy-l19:'));
if (
  batteryCommandVariants[0] !== 'ab-no-crc:ab010003020310' ||
  !legacyBatteryVariant ||
  !legacyBatteryVariant.endsWith('120000')
) {
  throw new Error(`RW battery command variants should prefer the confirmed SY03 no-CRC App SDK command and retain L19 fallback: ${JSON.stringify(batteryCommandVariants)}`);
}
for (const variant of [
  'ab-no-crc:ab010003020310',
  'app-sdk-ab-crc-read:ab010003fca0020310',
  'c6-pdf:c60100034045020310',
  'c6-key-le:c60100034045030210'
]) {
  if (!batteryCommandVariants.includes(variant)) {
    throw new Error(`RW battery command variants should keep historical SY03 fallbacks: ${JSON.stringify(batteryCommandVariants)}`);
  }
}

if (bytesToHex(buildRwReadFirmwareVersionCommand()) !== 'ab010003020410') {
  throw new Error(`Unexpected RW read-firmware command: ${bytesToHex(buildRwReadFirmwareVersionCommand())}`);
}

const hardwareVersionCommandVariants = buildRwFirmwareVersionCommandVariants('hardwareVersion').map((item) => `${item.label}:${bytesToHex(item.bytes)}`);
const softwareVersionCommandVariants = buildRwFirmwareVersionCommandVariants('softwareVersion').map((item) => `${item.label}:${bytesToHex(item.bytes)}`);
if (
  hardwareVersionCommandVariants[0] !== 'ab-no-crc:ab010003020410' ||
  !hardwareVersionCommandVariants.some((item) => item.startsWith('legacy-l19-hardware:') && item.endsWith('110100')) ||
  !hardwareVersionCommandVariants.includes('app-sdk-ab-crc-read:ab010003cca2020410') ||
  !hardwareVersionCommandVariants.includes('c6-pdf:c60100034045020410') ||
  !hardwareVersionCommandVariants.includes('c6-key-le:c60100034045040210') ||
  softwareVersionCommandVariants[0] !== 'ab-no-crc:ab010003020410' ||
  !softwareVersionCommandVariants.some((item) => item.startsWith('legacy-l19-software:') && item.endsWith('110000')) ||
  !softwareVersionCommandVariants.includes('app-sdk-ab-crc-read:ab010003cca2020410') ||
  !softwareVersionCommandVariants.includes('c6-pdf:c60100034045020410') ||
  !softwareVersionCommandVariants.includes('c6-key-le:c60100034045040210')
) {
  throw new Error(
    `RW firmware command variants should prefer the confirmed SY03 no-CRC App SDK read and retain L19 fallback: ${JSON.stringify({
      hardwareVersionCommandVariants,
      softwareVersionCommandVariants
    })}`
  );
}

const monitoringCommands = new Map([
  [RwKey.HrMonitoring, 'ab0100036cae021610'],
  [RwKey.TemperatureDetecting, 'ab010003fcaa021b10'],
  [RwKey.Spo2Monitoring, 'ab0100039cba022510'],
  [RwKey.HrvMonitoring, 'ab010003ac8e026a10'],
  [RwKey.StressMonitoring, 'ab0100033c8f026b10'],
  [RwKey.BloodSugarMonitoring, 'ab0100036c8c026e10'],
  [RwKey.BloodPressureMonitoring, 'ab010003cc80027c10'],
  [RwKey.TemperatureMonitoring, 'ab0100035c81027d10']
]);

for (const [key, hex] of monitoringCommands.entries()) {
  const actual = bytesToHex(buildRwReadHealthMonitoringCommand(key));
  if (actual !== hex) throw new Error(`Unexpected RW monitoring command for ${key}: ${actual}`);
}

const healthDataCommands = new Map([
  [RwKey.HeartRate, 'ab0100033d11050310'],
  [RwKey.BloodPressure, 'ab0100030d13050410'],
  [RwKey.Temperature, 'ab0100030d16050810'],
  [RwKey.BloodOxygen, 'ab0100039d17050910'],
  [RwKey.Hrv, 'ab0100036d17050a10'],
  [RwKey.Stress, 'ab0100035d15050d10'],
  [RwKey.BloodSugar, 'ab0100030d1c051010']
]);

for (const [key, hex] of healthDataCommands.entries()) {
  const actual = bytesToHex(buildRwReadHealthDataCommand(key));
  if (actual !== hex) throw new Error(`Unexpected RW health-data command for ${key}: ${actual}`);
}

if (bytesToHex(buildRwDeleteHealthDataCommand(RwKey.BloodOxygen)) !== 'ab0100034516050930') {
  throw new Error(`Unexpected RW delete blood-oxygen command: ${bytesToHex(buildRwDeleteHealthDataCommand(RwKey.BloodOxygen))}`);
}

if (bytesToHex(buildRwDeleteHealthDataCommand(RwKey.Temperature)) !== 'ab010003d517050830') {
  throw new Error(`Unexpected RW delete temperature command: ${bytesToHex(buildRwDeleteHealthDataCommand(RwKey.Temperature))}`);
}

const controlHealthDataCommands = new Map<RwKey | RwHealthDataControlKey, string>([
  [RwKey.HeartRate, 'ab010006f7ee060900030501'],
  [RwKey.BloodOxygen, 'ab010006f5ce060900090501'],
  [RwKey.Temperature, 'ab010006359f060900080501'],
  [RwHealthDataControlKey.BloodPressure, 'ab010006365f060900040501'],
  [RwHealthDataControlKey.Hrv, 'ab010006f53e0609000a0501'],
  [RwHealthDataControlKey.Stress, 'ab010006348f0609000d0501'],
  [RwHealthDataControlKey.BloodSugar, 'ab010006321f060900100501']
]);

for (const [key, hex] of controlHealthDataCommands.entries()) {
  const actual = bytesToHex(buildRwControlHealthDataCommand(key, true));
  if (actual !== hex) throw new Error(`Unexpected RW control-health-data command for ${key}: ${actual}`);
}

if (bytesToHex(buildRwControlHealthDataCommand(RwKey.HeartRate, false)) !== 'ab010006372f060900030500') {
  throw new Error(`Unexpected RW close heart-rate control command: ${bytesToHex(buildRwControlHealthDataCommand(RwKey.HeartRate, false))}`);
}

const parsedBattery = parseRwRingData(hexToBytes('c611000412340203101e'));
if (
  parsedBattery?.type !== 'battery' ||
  parsedBattery.value !== '30%' ||
  parsedBattery.battery !== 30 ||
  parsedBattery.numericValue !== 30 ||
  parsedBattery.status !== 'normal' ||
  typeof parsedBattery.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW battery parse result: ${JSON.stringify(parsedBattery)}`);
}

const parsedChargingBattery = parseRwRingData(hexToBytes('c6110004123402031065'));
if (
  parsedChargingBattery?.type !== 'battery' ||
  parsedChargingBattery.battery !== 101 ||
  parsedChargingBattery.status !== 'charging' ||
  parsedChargingBattery.value !== '\u5145\u7535\u4e2d'
) {
  throw new Error(`Unexpected RW charging battery parse result: ${JSON.stringify(parsedChargingBattery)}`);
}

const parsedMiniBattery = parseRwRingData(hexToBytes('0001031002034e00'));
if (
  parsedMiniBattery?.type !== 'battery' ||
  parsedMiniBattery.protocol !== 'rw' ||
  parsedMiniBattery.packetShape !== 'mini' ||
  parsedMiniBattery.battery !== 78 ||
  parsedMiniBattery.value !== '78%' ||
  parsedMiniBattery.status !== 'normal' ||
  parsedMiniBattery.chargingStatusText !== '未充电'
) {
  throw new Error(`Unexpected RW mini battery parse result: ${JSON.stringify(parsedMiniBattery)}`);
}

const parsedMiniLeBattery = parseRwRingData(hexToBytes('0002031003024f'));
if (
  parsedMiniLeBattery?.type !== 'battery' ||
  parsedMiniLeBattery.packetShape !== 'mini' ||
  parsedMiniLeBattery.battery !== 79 ||
  parsedMiniLeBattery.value !== '79%'
) {
  throw new Error(`Unexpected RW mini little-endian battery parse result: ${JSON.stringify(parsedMiniLeBattery)}`);
}

const parsedLegacyCompatBattery = parseRwRingData(hexToBytes('000112004e00'));
if (
  parsedLegacyCompatBattery?.type !== 'battery' ||
  parsedLegacyCompatBattery.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatBattery.battery !== 78 ||
  parsedLegacyCompatBattery.value !== '78%' ||
  normalizeRingData(parsedLegacyCompatBattery)?.metrics.battery !== 78
) {
  throw new Error(`Unexpected RW legacy-compatible battery parse result: ${JSON.stringify(parsedLegacyCompatBattery)}`);
}

const parsedAbBattery = parseRwRingData(hexToBytes('ab1100065dcd020310641081'));
if (
  parsedAbBattery?.type !== 'battery' ||
  parsedAbBattery.value !== '100%' ||
  parsedAbBattery.battery !== 100 ||
  parsedAbBattery.numericValue !== 100 ||
  parsedAbBattery.status !== 'normal' ||
  parsedAbBattery.chargingStatusText !== '未充电'
) {
  throw new Error(`Unexpected RW AB battery parse result: ${JSON.stringify(parsedAbBattery)}`);
}

const parsedC6LittleEndianBattery = parseRwRingData(hexToBytes('c611000412340302104f'));
if (
  parsedC6LittleEndianBattery?.type !== 'battery' ||
  parsedC6LittleEndianBattery.value !== '79%' ||
  parsedC6LittleEndianBattery.battery !== 79 ||
  parsedC6LittleEndianBattery.key !== RwKey.Battery ||
  normalizeRingData(parsedC6LittleEndianBattery)?.metrics.battery !== 79
) {
  throw new Error(`Unexpected RW C6 little-endian key battery parse result: ${JSON.stringify(parsedC6LittleEndianBattery)}`);
}

for (const emptyBatteryAckHex of ['c60100034045020310', 'c60100034045030210', 'ab010003fca0020310']) {
  const parsedEmptyBatteryAck = parseRwRingData(hexToBytes(emptyBatteryAckHex));
  const normalizedEmptyBatteryAck = parsedEmptyBatteryAck ? normalizeRingData(parsedEmptyBatteryAck) : null;
  if (
    parsedEmptyBatteryAck?.type !== 'rw_health_data_pending' ||
    parsedEmptyBatteryAck.name !== 'battery' ||
    normalizedEmptyBatteryAck?.sourceType !== 'rw_health_data_pending' ||
    normalizedEmptyBatteryAck.metrics.name !== 'battery' ||
    normalizedEmptyBatteryAck.metrics.battery != null
  ) {
    throw new Error(`RW empty battery key-frame ack should not be normalized as 0% battery: ${JSON.stringify({
      emptyBatteryAckHex,
      parsedEmptyBatteryAck,
      normalizedEmptyBatteryAck
    })}`);
  }
}

const normalizedBattery = normalizeRingData(parsedAbBattery);
if (
  normalizedBattery?.metrics.battery !== 100 ||
  normalizedBattery.metrics.batteryStatus !== '未充电' ||
  normalizedBattery.metrics.chargingStatusText !== '未充电'
) {
  throw new Error(`Unexpected RW battery normalize result: ${JSON.stringify(normalizedBattery)}`);
}

const parsedFirmware = parseRwRingData(hexToBytes('c6110017123402041000020200f0002801304130353034303200000202'));
if (
  parsedFirmware?.type !== 'firmware_version' ||
  parsedFirmware.firmwareVersion !== '0.2.2' ||
  parsedFirmware.softwareVersion !== '0A050402' ||
  parsedFirmware.screenWidth !== 240 ||
  parsedFirmware.screenHeight !== 296 ||
  parsedFirmware.uiVersion !== '0A050402' ||
  typeof parsedFirmware.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW firmware parse result: ${JSON.stringify(parsedFirmware)}`);
}

const parsedEmptyFirmwareAck = parseRwRingData(hexToBytes('ab010003cca2020410'));
const normalizedEmptyFirmwareAck = parsedEmptyFirmwareAck ? normalizeRingData(parsedEmptyFirmwareAck) : null;
if (
  parsedEmptyFirmwareAck?.type !== 'rw_health_data_pending' ||
  parsedEmptyFirmwareAck.name !== 'firmware_version' ||
  normalizedEmptyFirmwareAck?.sourceType !== 'rw_health_data_pending' ||
  normalizedEmptyFirmwareAck.metrics.name !== 'firmware_version' ||
  normalizedEmptyFirmwareAck.metrics.firmwareVersion != null ||
  normalizedEmptyFirmwareAck.metrics.softwareVersion != null
) {
  throw new Error(`RW empty firmware key-frame ack should not be normalized as blank firmware/software version: ${JSON.stringify({
    parsedEmptyFirmwareAck,
    normalizedEmptyFirmwareAck
  })}`);
}

const parsedAsciiFirmware = parseRwRingData(hexToBytes('c611000b1234020410322e332e382e3931'));
if (
  parsedAsciiFirmware?.type !== 'firmware_version' ||
  parsedAsciiFirmware.firmwareVersion !== '2.3.8.91' ||
  parsedAsciiFirmware.hardwareVersion !== '2.3.8.91' ||
  parsedAsciiFirmware.softwareVersion !== '2.3.8.91' ||
  parsedAsciiFirmware.screenWidth !== undefined ||
  parsedAsciiFirmware.screenHeight !== undefined
) {
  throw new Error(`Unexpected RW ASCII firmware parse result: ${JSON.stringify(parsedAsciiFirmware)}`);
}

const parsedC6LittleEndianFirmware = parseRwRingData(hexToBytes('c611000b1234040210322e332e382e3931'));
if (
  parsedC6LittleEndianFirmware?.type !== 'firmware_version' ||
  parsedC6LittleEndianFirmware.key !== RwKey.FirmwareVersion ||
  parsedC6LittleEndianFirmware.firmwareVersion !== '2.3.8.91' ||
  parsedC6LittleEndianFirmware.hardwareVersion !== '2.3.8.91' ||
  parsedC6LittleEndianFirmware.softwareVersion !== '2.3.8.91' ||
  parsedC6LittleEndianFirmware.screenWidth !== undefined ||
  parsedC6LittleEndianFirmware.screenHeight !== undefined ||
  normalizeRingData(parsedC6LittleEndianFirmware)?.metrics.firmwareVersion !== '2.3.8.91'
) {
  throw new Error(`Unexpected RW C6 little-endian key firmware parse result: ${JSON.stringify(parsedC6LittleEndianFirmware)}`);
}

const parsedEmptyLittleEndianFirmwareAck = parseRwRingData(hexToBytes('c60100034045040210'));
const normalizedEmptyLittleEndianFirmwareAck = parsedEmptyLittleEndianFirmwareAck
  ? normalizeRingData(parsedEmptyLittleEndianFirmwareAck)
  : null;
if (
  parsedEmptyLittleEndianFirmwareAck?.type !== 'rw_health_data_pending' ||
  parsedEmptyLittleEndianFirmwareAck.name !== 'firmware_version' ||
  normalizedEmptyLittleEndianFirmwareAck?.sourceType !== 'rw_health_data_pending' ||
  normalizedEmptyLittleEndianFirmwareAck.metrics.firmwareVersion != null ||
  normalizedEmptyLittleEndianFirmwareAck.metrics.softwareVersion != null
) {
  throw new Error(`RW little-endian empty firmware ack should stay pending instead of blanking versions: ${JSON.stringify({
    parsedEmptyLittleEndianFirmwareAck,
    normalizedEmptyLittleEndianFirmwareAck
  })}`);
}

const parsedLegacyCompatHardware = parseRwRingData(hexToBytes('00071101322e332e382e39312020'));
if (
  parsedLegacyCompatHardware?.type !== 'hardwareVersion' ||
  parsedLegacyCompatHardware.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatHardware.value !== '2.3.8.91' ||
  normalizeRingData(parsedLegacyCompatHardware)?.metrics.hardwareVersion !== '2.3.8.91'
) {
  throw new Error(`Unexpected RW legacy-compatible hardware parse result: ${JSON.stringify(parsedLegacyCompatHardware)}`);
}

const parsedLegacyCompatSoftware = parseRwRingData(hexToBytes('00081100322e332e382e39312020'));
if (
  parsedLegacyCompatSoftware?.type !== 'softwareVersion' ||
  parsedLegacyCompatSoftware.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatSoftware.value !== '2.3.8.91' ||
  normalizeRingData(parsedLegacyCompatSoftware)?.metrics.softwareVersion !== '2.3.8.91'
) {
  throw new Error(`Unexpected RW legacy-compatible software parse result: ${JSON.stringify(parsedLegacyCompatSoftware)}`);
}

const parsedLegacyCompatHeartRate = parseRwRingData(hexToBytes('0009310001461e24'));
const normalizedLegacyCompatHeartRate = parsedLegacyCompatHeartRate ? normalizeRingData(parsedLegacyCompatHeartRate) : null;
const legacyCompatHeartRateMetrics = normalizedLegacyCompatHeartRate
  ? buildRingBusinessMetrics([normalizedLegacyCompatHeartRate])
  : null;
if (
  parsedLegacyCompatHeartRate?.type !== 'active_measure' ||
  parsedLegacyCompatHeartRate.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatHeartRate.heartRate !== 70 ||
  parsedLegacyCompatHeartRate.heartRateVariability !== 30 ||
  normalizedLegacyCompatHeartRate?.metrics.heartRate !== 70 ||
  normalizedLegacyCompatHeartRate.metrics.hrv !== 30 ||
  legacyCompatHeartRateMetrics?.heartRate !== 70 ||
  legacyCompatHeartRateMetrics.hrv !== 30 ||
  legacyCompatHeartRateMetrics.stress !== 30
) {
  throw new Error(`Unexpected RW legacy-compatible heart-rate parse result: ${JSON.stringify(parsedLegacyCompatHeartRate)}`);
}

const parsedLegacyCompatBloodOxygen = parseRwRingData(hexToBytes('000a320001486124'));
const normalizedLegacyCompatBloodOxygen = parsedLegacyCompatBloodOxygen
  ? normalizeRingData(parsedLegacyCompatBloodOxygen)
  : null;
const legacyCompatBloodOxygenMetrics = normalizedLegacyCompatBloodOxygen
  ? buildRingBusinessMetrics([normalizedLegacyCompatBloodOxygen])
  : null;
if (
  parsedLegacyCompatBloodOxygen?.type !== 'active_OxyGenMeasure' ||
  parsedLegacyCompatBloodOxygen.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatBloodOxygen.heartRate !== 72 ||
  parsedLegacyCompatBloodOxygen.bloodOxygen !== 97 ||
  normalizedLegacyCompatBloodOxygen?.metrics.heartRate !== 72 ||
  normalizedLegacyCompatBloodOxygen.metrics.bloodOxygen !== 97 ||
  legacyCompatBloodOxygenMetrics?.heartRate !== 72 ||
  legacyCompatBloodOxygenMetrics.bloodOxygen !== 97
) {
  throw new Error(`Unexpected RW legacy-compatible blood-oxygen parse result: ${JSON.stringify(parsedLegacyCompatBloodOxygen)}`);
}

const parsedLegacyCompatTemperature = parseRwRingData(hexToBytes('000b3400016a0e'));
const normalizedLegacyCompatTemperature = parsedLegacyCompatTemperature
  ? normalizeRingData(parsedLegacyCompatTemperature)
  : null;
const legacyCompatTemperatureMetrics = normalizedLegacyCompatTemperature
  ? buildRingBusinessMetrics([normalizedLegacyCompatTemperature])
  : null;
if (
  parsedLegacyCompatTemperature?.type !== 'active_Temperature' ||
  parsedLegacyCompatTemperature.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatTemperature.temperature !== '36.90' ||
  parsedLegacyCompatTemperature.temperatureValue !== 36.9 ||
  normalizedLegacyCompatTemperature?.metrics.temperature !== '36.90' ||
  normalizedLegacyCompatTemperature.metrics.temperatureValue !== 36.9 ||
  legacyCompatTemperatureMetrics?.temperature !== '36.9\u00b0C'
) {
  throw new Error(`Unexpected RW legacy-compatible temperature parse result: ${JSON.stringify(parsedLegacyCompatTemperature)}`);
}

const parsedLegacyCompatCollectSet = parseRwRingData(hexToBytes('000c370001'));
if (
  parsedLegacyCompatCollectSet?.type !== 'collect_period_set' ||
  parsedLegacyCompatCollectSet.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatCollectSet.status !== 'success'
) {
  throw new Error(`Unexpected RW legacy-compatible collect-period set result: ${JSON.stringify(parsedLegacyCompatCollectSet)}`);
}

const parsedLegacyCompatCollectRead = parseRwRingData(hexToBytes('000d3701b0040000'));
if (
  parsedLegacyCompatCollectRead?.type !== 'collect_period_read' ||
  parsedLegacyCompatCollectRead.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatCollectRead.period !== 1200 ||
  parsedLegacyCompatCollectRead.minutes !== '20.0' ||
  normalizeRingData(parsedLegacyCompatCollectRead)?.metrics.period !== 1200
) {
  throw new Error(`Unexpected RW legacy-compatible collect-period read result: ${JSON.stringify(parsedLegacyCompatCollectRead)}`);
}

const parsedLegacyCompatDeleteLocal = parseRwRingData(hexToBytes('000e3603'));
if (
  parsedLegacyCompatDeleteLocal?.type !== 'delete_all_local_data' ||
  parsedLegacyCompatDeleteLocal.packetShape !== 'legacy_compat'
) {
  throw new Error(`Unexpected RW legacy-compatible delete-local-data result: ${JSON.stringify(parsedLegacyCompatDeleteLocal)}`);
}

const parsedLegacyCompatLocalData = parseRwRingData(
  hexToBytes('00103600010000000100000000f15365d20446621e146a0e0201370000')
);
const normalizedLegacyCompatLocalData = parsedLegacyCompatLocalData ? normalizeRingData(parsedLegacyCompatLocalData) : null;
const legacyCompatLocalMetrics = normalizedLegacyCompatLocalData
  ? buildRingBusinessMetrics([normalizedLegacyCompatLocalData])
  : null;
if (
  parsedLegacyCompatLocalData?.type !== 'local_data' ||
  parsedLegacyCompatLocalData.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatLocalData.status !== 'success' ||
  parsedLegacyCompatLocalData.totalNum !== 1 ||
  parsedLegacyCompatLocalData.records?.[0]?.stepCount !== 1234 ||
  parsedLegacyCompatLocalData.records?.[0]?.heartRate !== 70 ||
  parsedLegacyCompatLocalData.records?.[0]?.spo2 !== 98 ||
  parsedLegacyCompatLocalData.records?.[0]?.temperature !== 36.9 ||
  normalizedLegacyCompatLocalData?.metrics.records?.[0]?.hrv !== 30 ||
  legacyCompatLocalMetrics?.stepCount !== 1234 ||
  legacyCompatLocalMetrics.heartRate !== 70 ||
  legacyCompatLocalMetrics.bloodOxygen !== 98 ||
  legacyCompatLocalMetrics.hrv !== 30 ||
  legacyCompatLocalMetrics.stress !== 20 ||
  legacyCompatLocalMetrics.temperature !== '36.9\u00b0C'
) {
  throw new Error(
    `Unexpected RW legacy-compatible local-data result: ${JSON.stringify({
      parsedLegacyCompatLocalData,
      normalizedLegacyCompatLocalData,
      legacyCompatLocalMetrics
    })}`
  );
}

const parsedLegacyCompatRestore = parseRwRingData(hexToBytes('000f3702'));
if (
  parsedLegacyCompatRestore?.type !== 'restore_factory_settings' ||
  parsedLegacyCompatRestore.packetShape !== 'legacy_compat' ||
  parsedLegacyCompatRestore.success !== true
) {
  throw new Error(`Unexpected RW legacy-compatible restore result: ${JSON.stringify(parsedLegacyCompatRestore)}`);
}

const legacyCompatParitySamples = [
  { name: 'battery', hex: '001112004e', expectedType: 'battery', expectedPacketShape: 'legacy_compat' },
  { name: 'hardware', hex: '00121101322e332e382e39312020', expectedType: 'hardwareVersion', expectedPacketShape: 'legacy_compat' },
  { name: 'software', hex: '00131100322e332e382e39312020', expectedType: 'softwareVersion', expectedPacketShape: 'legacy_compat' },
  { name: 'active_measure', hex: '0014310001461e24', expectedType: 'active_measure', expectedPacketShape: 'legacy_compat' },
  { name: 'blood_oxygen', hex: '0015320001486124', expectedType: 'active_OxyGenMeasure', expectedPacketShape: 'legacy_compat' },
  { name: 'temperature', hex: '00163400016a0e', expectedType: 'active_Temperature', expectedPacketShape: 'legacy_compat' },
  { name: 'local_data_empty', hex: '0017360000000000', expectedType: 'local_data', expectedPacketShape: 'legacy_compat' },
  { name: 'device_time', hex: '0018100148b26f098b01000008', expectedType: 'device_time' },
  { name: 'delete_local', hex: '00193603', expectedType: 'delete_all_local_data', expectedPacketShape: 'legacy_compat' },
  { name: 'collect_set', hex: '001a370001', expectedType: 'collect_period_set', expectedPacketShape: 'legacy_compat' },
  { name: 'collect_read', hex: '001b3701b0040000', expectedType: 'collect_period_read', expectedPacketShape: 'legacy_compat' },
  { name: 'restore', hex: '001c3702', expectedType: 'restore_factory_settings', expectedPacketShape: 'legacy_compat' }
];

for (const sample of legacyCompatParitySamples) {
  const bytes = hexToBytes(sample.hex);
  const legacyParsed = parseLegacyRingData(bytes);
  const rwParsed = parseRwRingData(bytes);
  if (
    legacyParsed?.type !== sample.expectedType ||
    rwParsed?.type !== sample.expectedType ||
    rwParsed?.protocol !== 'rw' ||
    (sample.expectedPacketShape && rwParsed?.packetShape !== sample.expectedPacketShape)
  ) {
    throw new Error(
      `RW legacy-compatible parser should preserve L19 type and RW ownership for ${sample.name}: ${JSON.stringify({
        legacyParsed,
        rwParsed,
        expectedType: sample.expectedType,
        expectedPacketShape: sample.expectedPacketShape
      })}`
    );
  }
}

const parsedMonitoring = parseRwRingData(hexToBytes('c61100091234021610010000173b1e'));
if (
  parsedMonitoring?.type !== 'rw_health_monitoring' ||
  parsedMonitoring.name !== 'heart_rate' ||
  parsedMonitoring.enabled !== true ||
  parsedMonitoring.endHour !== 23 ||
  parsedMonitoring.endMinute !== 59 ||
  parsedMonitoring.interval !== 30 ||
  typeof parsedMonitoring.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW monitoring parse result: ${JSON.stringify(parsedMonitoring)}`);
}

const normalizedMonitoring = normalizeRingData(parsedMonitoring);
if (
  normalizedMonitoring?.metrics.name !== 'heart_rate' ||
  normalizedMonitoring.metrics.enabled !== true ||
  normalizedMonitoring.metrics.interval !== 30 ||
  normalizedMonitoring.metrics.period !== 1800 ||
  normalizedMonitoring.metrics.minutes !== 30
) {
  throw new Error(`Unexpected RW monitoring normalize result: ${JSON.stringify(normalizedMonitoring)}`);
}

const parsedBloodSugarMonitoring = parseRwRingData(hexToBytes('c61100091234026e10010000173b1e'));
if (
  parsedBloodSugarMonitoring?.type !== 'rw_health_monitoring' ||
  parsedBloodSugarMonitoring.name !== 'blood_sugar' ||
  parsedBloodSugarMonitoring.interval !== 30
) {
  throw new Error(`Unexpected RW blood-sugar monitoring parse result: ${JSON.stringify(parsedBloodSugarMonitoring)}`);
}

const parsedUserAck = parseRwRingData(hexToBytes('c61100031234020600'));
if (parsedUserAck?.type !== 'rw_user_profile_ack' || parsedUserAck.status !== 'success') {
  throw new Error(`Unexpected RW user profile ack parse result: ${JSON.stringify(parsedUserAck)}`);
}

const parsedHeartRateDataAck = parseRwRingData(hexToBytes('c61100031234050310'));
if (parsedHeartRateDataAck?.type !== 'rw_health_data_ack' || parsedHeartRateDataAck.name !== 'heart_rate') {
  throw new Error(`Unexpected RW heart-rate data ack: ${JSON.stringify(parsedHeartRateDataAck)}`);
}

const parsedHeartRateStatusAck = parseRwRingData(hexToBytes('ab110004000002241011'));
if (
  parsedHeartRateStatusAck?.type !== 'rw_health_data_ack' ||
  parsedHeartRateStatusAck.name !== 'heart_rate' ||
  parsedHeartRateStatusAck.status !== 'ack' ||
  parsedHeartRateStatusAck.statusCode !== 0x11 ||
  parsedHeartRateStatusAck.statusText !== 'ack' ||
  parsedHeartRateStatusAck.message !== '设备已确认测量请求，等待真实数据'
) {
  throw new Error(`Unexpected RW status-only heart-rate ack: ${JSON.stringify(parsedHeartRateStatusAck)}`);
}

const normalizedHeartRateStatusAck = normalizeRingData(parsedHeartRateStatusAck);
if (
  normalizedHeartRateStatusAck?.metrics.status !== 'ack' ||
  normalizedHeartRateStatusAck.metrics.statusCode !== 0x11 ||
  normalizedHeartRateStatusAck.metrics.statusText !== 'ack' ||
  !`${normalizedHeartRateStatusAck.metrics.message || ''}`.trim()
) {
  throw new Error(`RW normalized status-only ack should preserve status details: ${JSON.stringify(normalizedHeartRateStatusAck)}`);
}

const parsedHeartRateRealtime = parseRwRingData(hexToBytes('ab110004000002241050'));
if (
  parsedHeartRateRealtime?.type !== 'rw_health_data' ||
  parsedHeartRateRealtime.name !== 'heart_rate' ||
  parsedHeartRateRealtime.value !== 80 ||
  typeof parsedHeartRateRealtime.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW realtime heart-rate parse result: ${JSON.stringify(parsedHeartRateRealtime)}`);
}

const parsedRealHeartRateRealtime = parseRwRingData(hexToBytes('ab110009a47302240031d5ac6b4100'));
if (
  parsedRealHeartRateRealtime?.type !== 'rw_health_data' ||
  parsedRealHeartRateRealtime.name !== 'heart_rate' ||
  parsedRealHeartRateRealtime.value !== 65
) {
  throw new Error(`Unexpected RW real heart-rate parse result: ${JSON.stringify(parsedRealHeartRateRealtime)}`);
}

const parsedRealBloodOxygenRealtime = parseRwRingData(hexToBytes('ab11000997fc024e0031d5ac7e6300'));
if (
  parsedRealBloodOxygenRealtime?.type !== 'rw_health_data' ||
  parsedRealBloodOxygenRealtime.name !== 'blood_oxygen' ||
  parsedRealBloodOxygenRealtime.value !== 99
) {
  throw new Error(`Unexpected RW real blood-oxygen parse result: ${JSON.stringify(parsedRealBloodOxygenRealtime)}`);
}

const parsedTemperatureRealtime = parseRwRingData(hexToBytes('ab11000500000230107201'));
if (
  parsedTemperatureRealtime?.type !== 'rw_health_data' ||
  parsedTemperatureRealtime.name !== 'temperature' ||
  parsedTemperatureRealtime.value !== 37
) {
  throw new Error(`Unexpected RW realtime temperature parse result: ${JSON.stringify(parsedTemperatureRealtime)}`);
}

const parsedCentiTemperatureRealtime = parseRwRingData(hexToBytes('ab110009000002300031d5ac6b6a0e'));
const normalizedCentiTemperatureRealtime = parsedCentiTemperatureRealtime ? normalizeRingData(parsedCentiTemperatureRealtime) : null;
const centiTemperatureMetrics = normalizedCentiTemperatureRealtime
  ? buildRingBusinessMetrics([normalizedCentiTemperatureRealtime])
  : null;
if (
  parsedCentiTemperatureRealtime?.type !== 'rw_health_data' ||
  parsedCentiTemperatureRealtime.name !== 'temperature' ||
  parsedCentiTemperatureRealtime.value !== 36.9 ||
  normalizedCentiTemperatureRealtime?.metrics.value !== 36.9 ||
  centiTemperatureMetrics?.temperature !== '36.9\u00b0C'
) {
  throw new Error(
    `Unexpected RW centi-degree realtime temperature parse result: ${JSON.stringify({
      parsedCentiTemperatureRealtime,
      normalizedCentiTemperatureRealtime,
      centiTemperatureMetrics
    })}`
  );
}

const parsedBloodPressureRealtime = parseRwRingData(hexToBytes('ab1100050000023110784f'));
if (
  parsedBloodPressureRealtime?.type !== 'rw_health_data' ||
  parsedBloodPressureRealtime.name !== 'blood_pressure' ||
  parsedBloodPressureRealtime.value?.systolic !== 120 ||
  parsedBloodPressureRealtime.value?.diastolic !== 79
) {
  throw new Error(`Unexpected RW realtime blood-pressure parse result: ${JSON.stringify(parsedBloodPressureRealtime)}`);
}

const parsedRealTemperatureRealtime = parseRwRingData(hexToBytes('ab110009000002300031d5ac6b7201'));
if (
  parsedRealTemperatureRealtime?.type !== 'rw_health_data' ||
  parsedRealTemperatureRealtime.name !== 'temperature' ||
  parsedRealTemperatureRealtime.value !== 37
) {
  throw new Error(`Unexpected RW real temperature parse result: ${JSON.stringify(parsedRealTemperatureRealtime)}`);
}

const parsedDirectCentiTemperature = parseRwRingData(hexToBytes('ab11000500000508006a0e'));
const normalizedDirectCentiTemperature = parsedDirectCentiTemperature ? normalizeRingData(parsedDirectCentiTemperature) : null;
const directCentiTemperatureMetrics = normalizedDirectCentiTemperature
  ? buildRingBusinessMetrics([normalizedDirectCentiTemperature])
  : null;
if (
  parsedDirectCentiTemperature?.type !== 'rw_health_data' ||
  parsedDirectCentiTemperature.name !== 'temperature' ||
  parsedDirectCentiTemperature.value !== 36.9 ||
  normalizedDirectCentiTemperature?.metrics.value !== 36.9 ||
  directCentiTemperatureMetrics?.temperature !== null
) {
  throw new Error(
    `Unexpected RW centi-degree historical temperature parse result: ${JSON.stringify({
      parsedDirectCentiTemperature,
      normalizedDirectCentiTemperature,
      directCentiTemperatureMetrics
    })}`
  );
}

const parsedRealBloodPressureRealtime = parseRwRingData(hexToBytes('ab110009000002310031d5ac6b784f'));
if (
  parsedRealBloodPressureRealtime?.type !== 'rw_health_data' ||
  parsedRealBloodPressureRealtime.name !== 'blood_pressure' ||
  parsedRealBloodPressureRealtime.value?.systolic !== 120 ||
  parsedRealBloodPressureRealtime.value?.diastolic !== 79
) {
  throw new Error(`Unexpected RW real blood-pressure parse result: ${JSON.stringify(parsedRealBloodPressureRealtime)}`);
}

const parsedStressRealtime = parseRwRingData(hexToBytes('ab1100040000024f101f'));
if (
  parsedStressRealtime?.type !== 'rw_health_data' ||
  parsedStressRealtime.name !== 'stress' ||
  parsedStressRealtime.value !== 31
) {
  throw new Error(`Unexpected RW realtime stress parse result: ${JSON.stringify(parsedStressRealtime)}`);
}

const parsedRealStressRealtime = parseRwRingData(hexToBytes('ab1100090000024f0031d5ac6b1f00'));
if (
  parsedRealStressRealtime?.type !== 'rw_health_data' ||
  parsedRealStressRealtime.name !== 'stress' ||
  parsedRealStressRealtime.value !== 31
) {
  throw new Error(`Unexpected RW real stress parse result: ${JSON.stringify(parsedRealStressRealtime)}`);
}

const parsedHrvRealtime = parseRwRingData(hexToBytes('ab11000400000269102a'));
if (
  parsedHrvRealtime?.type !== 'rw_health_data' ||
  parsedHrvRealtime.name !== 'hrv' ||
  parsedHrvRealtime.value !== 42
) {
  throw new Error(`Unexpected RW realtime HRV parse result: ${JSON.stringify(parsedHrvRealtime)}`);
}

const parsedRealHrvRealtime = parseRwRingData(hexToBytes('ab110009000002690031d5ac6b2a00'));
if (
  parsedRealHrvRealtime?.type !== 'rw_health_data' ||
  parsedRealHrvRealtime.name !== 'hrv' ||
  parsedRealHrvRealtime.value !== 42
) {
  throw new Error(`Unexpected RW real HRV parse result: ${JSON.stringify(parsedRealHrvRealtime)}`);
}

const parsedBloodSugarRealtime = parseRwRingData(hexToBytes('ab1100040000026c1006'));
if (
  parsedBloodSugarRealtime?.type !== 'rw_health_data' ||
  parsedBloodSugarRealtime.name !== 'blood_sugar' ||
  parsedBloodSugarRealtime.value !== 6
) {
  throw new Error(`Unexpected RW realtime blood-sugar parse result: ${JSON.stringify(parsedBloodSugarRealtime)}`);
}

const parsedRealBloodSugarRealtime = parseRwRingData(hexToBytes('ab1100090000026c0031d5ac6b0600'));
if (
  parsedRealBloodSugarRealtime?.type !== 'rw_health_data' ||
  parsedRealBloodSugarRealtime.name !== 'blood_sugar' ||
  parsedRealBloodSugarRealtime.value !== 6
) {
  throw new Error(`Unexpected RW real blood-sugar parse result: ${JSON.stringify(parsedRealBloodSugarRealtime)}`);
}

const parsedControlAck = parseRwRingData(hexToBytes('ab1100060000060900030501'));
if (
  parsedControlAck?.type !== 'rw_health_data_control_ack' ||
  parsedControlAck.name !== 'heart_rate' ||
  parsedControlAck.status !== 'success'
) {
  throw new Error(`Unexpected RW health-data control ack parse result: ${JSON.stringify(parsedControlAck)}`);
}

const normalizedControlAck = normalizeRingData(parsedControlAck);
if (
  normalizedControlAck?.metrics.success !== true ||
  normalizedControlAck.metrics.controlKey !== 0x03 ||
  normalizedControlAck.metrics.controlAction !== 0x01 ||
  normalizedControlAck.metrics.status !== 'success'
) {
  throw new Error(`RW normalized control ack should preserve control details: ${JSON.stringify(normalizedControlAck)}`);
}

const parsedControlFailureAck = parseRwRingData(hexToBytes('ab1100060000060901030501'));
if (
  parsedControlFailureAck?.type !== 'rw_health_data_control_ack' ||
  parsedControlFailureAck.name !== 'heart_rate' ||
  parsedControlFailureAck.status !== 'failed' ||
  parsedControlFailureAck.success !== false
) {
  throw new Error(`Unexpected RW health-data control failure ack parse result: ${JSON.stringify(parsedControlFailureAck)}`);
}

const parsedHrvControlAck = parseRwRingData(hexToBytes('ab11000600000609000a0501'));
if (
  parsedHrvControlAck?.type !== 'rw_health_data_control_ack' ||
  parsedHrvControlAck.name !== 'hrv' ||
  parsedHrvControlAck.status !== 'success'
) {
  throw new Error(`Unexpected RW HRV control ack parse result: ${JSON.stringify(parsedHrvControlAck)}`);
}

const parsedStressControlAck = parseRwRingData(hexToBytes('ab11000600000609000d0501'));
if (
  parsedStressControlAck?.type !== 'rw_health_data_control_ack' ||
  parsedStressControlAck.name !== 'stress' ||
  parsedStressControlAck.status !== 'success'
) {
  throw new Error(`Unexpected RW stress control ack parse result: ${JSON.stringify(parsedStressControlAck)}`);
}

const parsedBloodPressureControlAck = parseRwRingData(hexToBytes('ab1100060000060900040501'));
if (
  parsedBloodPressureControlAck?.type !== 'rw_health_data_control_ack' ||
  parsedBloodPressureControlAck.name !== 'blood_pressure' ||
  parsedBloodPressureControlAck.status !== 'success'
) {
  throw new Error(`Unexpected RW blood-pressure control ack parse result: ${JSON.stringify(parsedBloodPressureControlAck)}`);
}

const parsedLegacyReportBattery = parseRwRingData(buildRwFrame(0x12, 0x01, new Uint8Array([78, 1]), 0x61));
if (
  parsedLegacyReportBattery?.type !== 'battery' ||
  parsedLegacyReportBattery.battery !== 78 ||
  parsedLegacyReportBattery.packetShape !== 'legacy_compat'
) {
  throw new Error(`RW should accept L19-style battery report subcommands from SY03: ${JSON.stringify(parsedLegacyReportBattery)}`);
}

const parsedLegacyShortHeartRateReport = parseRwRingData(buildRwFrame(0x31, 0x01, new Uint8Array([1, 72, 36]), 0x62));
if (
  parsedLegacyShortHeartRateReport?.type !== 'active_measure' ||
  parsedLegacyShortHeartRateReport.heartRate !== 72 ||
  parsedLegacyShortHeartRateReport.heartRateVariability !== 36 ||
  parsedLegacyShortHeartRateReport.packetShape !== 'legacy_compat'
) {
  throw new Error(
    `RW should accept short L19-style heart-rate report subcommands from SY03: ${JSON.stringify(parsedLegacyShortHeartRateReport)}`
  );
}

const parsedLegacyShortOxygenReport = parseRwRingData(buildRwFrame(0x32, 0x01, new Uint8Array([1, 72, 98]), 0x63));
if (
  parsedLegacyShortOxygenReport?.type !== 'active_OxyGenMeasure' ||
  parsedLegacyShortOxygenReport.heartRate !== 72 ||
  parsedLegacyShortOxygenReport.bloodOxygen !== 98 ||
  parsedLegacyShortOxygenReport.packetShape !== 'legacy_compat'
) {
  throw new Error(
    `RW should accept short L19-style oxygen report subcommands from SY03: ${JSON.stringify(parsedLegacyShortOxygenReport)}`
  );
}

const parsedHeartRateStatusOnly = parseRwRingData(hexToBytes('ab110004000002241031'));
if (
  parsedHeartRateStatusOnly?.type !== 'rw_health_data_ack' ||
  parsedHeartRateStatusOnly.name !== 'heart_rate' ||
  parsedHeartRateStatusOnly.value != null ||
  parsedHeartRateStatusOnly.status !== 'nack' ||
  parsedHeartRateStatusOnly.statusCode !== 0x31 ||
  parsedHeartRateStatusOnly.statusText !== 'nack' ||
  parsedHeartRateStatusOnly.message !== '设备返回失败应答，未返回真实数据'
) {
  throw new Error(`Unexpected RW status-only heart-rate parse result: ${JSON.stringify(parsedHeartRateStatusOnly)}`);
}

const userProfileCommand = buildRwSetUserProfileCommand(
  { measureUnit: 0, gender: 0, age: 26, height: 170, weight: 65 },
  () => 0x1234
);
if (bytesToHex(userProfileCommand) !== 'ab01000e123402060000001a00002a4300008242') {
  throw new Error(`Unexpected RW user profile payload: ${bytesToHex(userProfileCommand)}`);
}

const heartRateMonitoringSetCommand = buildRwSetHealthMonitoringCommand(
  RwKey.HrMonitoring,
  { enabled: true, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, interval: 30 },
  () => 0x5678
);
if (bytesToHex(heartRateMonitoringSetCommand) !== 'ab0100095678021600010000173b1e') {
  throw new Error(`Unexpected RW heart-rate monitoring set payload: ${bytesToHex(heartRateMonitoringSetCommand)}`);
}

const bodyTemperatureDetectingSetCommand = buildRwSetBodyTemperatureDetectingCommand(
  { enabled: true, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, duration: 60 },
  () => 0x9abc
);
if (bytesToHex(bodyTemperatureDetectingSetCommand) !== 'ab0100099abc021b00ff0000173b3c') {
  throw new Error(`Unexpected RW body-temperature detecting set payload: ${bytesToHex(bodyTemperatureDetectingSetCommand)}`);
}

const bodyTemperatureDetectingSetCommandWithCrc = buildRwSetBodyTemperatureDetectingCommand({
  enabled: true,
  startHour: 0,
  startMinute: 0,
  endHour: 23,
  endMinute: 59,
  duration: 60
});
if (bytesToHex(bodyTemperatureDetectingSetCommandWithCrc) !== 'ab010009f5ee021b00ff0000173b3c') {
  throw new Error(`Unexpected RW body-temperature detecting command CRC: ${bytesToHex(bodyTemperatureDetectingSetCommandWithCrc)}`);
}

const parsedTime = parseRwRingData(hexToBytes('0041100148b26f098b01000008'));
if (
  parsedTime?.type !== 'device_time' ||
  parsedTime.timezone !== 8 ||
  !parsedTime.readable ||
  parsedTime.deviceTimestamp !== 1696670397000 ||
  typeof parsedTime.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW time parse result: ${JSON.stringify(parsedTime)}`);
}

const normalizedTime = normalizeRingData(parsedTime);
if (
  normalizedTime?.metrics.timezone !== 8 ||
  !normalizedTime.metrics.readable ||
  normalizedTime.metrics.timestamp !== 1696670397000 ||
  normalizedTime.metrics.receivedAt !== parsedTime.timestamp
) {
  throw new Error(`RW normalized time should preserve L19-readable time fields: ${JSON.stringify(normalizedTime)}`);
}

const parsedFormat = parseRwRingData(hexToBytes('0042361301'));
if (parsedFormat?.type !== 'rw_format_file_system' || parsedFormat.statusText !== 'success') {
  throw new Error(`Unexpected RW format parse result: ${JSON.stringify(parsedFormat)}`);
}

const parsedFactoryReset = parseRwRingData(hexToBytes('0043370201'));
if (
  parsedFactoryReset?.type !== 'restore_factory_settings' ||
  parsedFactoryReset.success !== true ||
  parsedFactoryReset.status !== 'success' ||
  parsedFactoryReset.statusCode !== 1 ||
  parsedFactoryReset.statusText !== 'success'
) {
  throw new Error(`RW factory-reset ack should match L19 parsed shape: ${JSON.stringify(parsedFactoryReset)}`);
}

const parsedFileList = parseRwRingData(
  hexToBytes('0043361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000')
);
if (
  parsedFileList?.type !== 'rw_file_list' ||
  !Array.isArray(parsedFileList.files) ||
  parsedFileList.files.length !== 1 ||
  parsedFileList.files[0].fileName !== 'u1_20260101010101_hr.txt' ||
  typeof parsedFileList.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW file-list parse result: ${JSON.stringify(parsedFileList)}`);
}

const uploadPayload = new Uint8Array(46 + 17 + 48);
uploadPayload[0] = 1;
uploadPayload[1] = 2;
uploadPayload[2] = 0x01;
uploadPayload[6] = 0x02;
const fileName = 'u1_20260101010101_hr.txt';
for (let index = 0; index < fileName.length; index += 1) {
  uploadPayload[10 + index] = fileName.charCodeAt(index);
}
const uploadRecordView = new DataView(uploadPayload.buffer);
const recordOffset = 46 + 17;
uploadRecordView.setUint32(recordOffset, 0x11111111, true);
uploadRecordView.setUint32(recordOffset + 4, 0, true);
uploadRecordView.setInt16(recordOffset + 8, 100, true);
uploadRecordView.setInt16(recordOffset + 10, 200, true);
uploadRecordView.setInt16(recordOffset + 12, 300, true);
uploadRecordView.setInt16(recordOffset + 18, 1, true);
uploadRecordView.setInt16(recordOffset + 20, 2, true);
uploadRecordView.setInt16(recordOffset + 22, 3, true);

const parsedUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, uploadPayload, 0x44));
if (
  parsedUploadFile?.type !== 'rw_upload_file' ||
  parsedUploadFile.fileName !== fileName ||
  !Array.isArray(parsedUploadFile.records) ||
  parsedUploadFile.records.length !== 1 ||
  parsedUploadFile.records[0].green !== 100 ||
  parsedUploadFile.records[0].accZ !== 3 ||
  typeof parsedUploadFile.timestamp !== 'number'
) {
  throw new Error(`Unexpected RW upload-file parse result: ${JSON.stringify(parsedUploadFile)}`);
}

const textUploadPayload = new Uint8Array(46 + '20260101010303,120,79\n'.length);
textUploadPayload[0] = 4;
textUploadPayload[1] = 2;
textUploadPayload[2] = 0x01;
textUploadPayload[6] = 0x02;
const bpFileName = 'u1_20260101010303_bp.txt';
for (let index = 0; index < bpFileName.length; index += 1) {
  textUploadPayload[10 + index] = bpFileName.charCodeAt(index);
}
const bpTextPayload = '20260101010303,120,79\n';
for (let index = 0; index < bpTextPayload.length; index += 1) {
  textUploadPayload[46 + index] = bpTextPayload.charCodeAt(index);
}

const parsedTextUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, textUploadPayload, 0x45));
if (
  parsedTextUploadFile?.type !== 'rw_upload_file' ||
  parsedTextUploadFile.fileType !== 'bp' ||
  parsedTextUploadFile.records?.[0]?.systolic !== 120 ||
  parsedTextUploadFile.records?.[0]?.diastolic !== 79 ||
  parsedTextUploadFile.records?.[0]?.timestamp == null
) {
  throw new Error(`Unexpected RW text upload-file parse result: ${JSON.stringify(parsedTextUploadFile)}`);
}

const buildRwTextUploadPayload = (seq: number, uploadFileName: string, text: string) => {
  const payload = new Uint8Array(46 + text.length);
  payload[0] = seq;
  payload[1] = 2;
  payload[2] = 0x01;
  payload[6] = 0x02;
  for (let index = 0; index < uploadFileName.length; index += 1) {
    payload[10 + index] = uploadFileName.charCodeAt(index);
  }
  for (let index = 0; index < text.length; index += 1) {
    payload[46 + index] = text.charCodeAt(index);
  }
  return payload;
};

const keyValueBpTextPayload = 'time=20260101010303 sbp=121 dbp=80\ntime=20260101010403 bp=122/81\n';
const keyValueTextUploadPayload = buildRwTextUploadPayload(4, bpFileName, keyValueBpTextPayload);

const parsedKeyValueTextUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, keyValueTextUploadPayload, 0x47));
const keyValueBloodPressureMetrics = parsedKeyValueTextUploadFile
  ? buildRingBusinessMetrics([normalizeRingData(parsedKeyValueTextUploadFile)!])
  : null;
if (
  parsedKeyValueTextUploadFile?.type !== 'rw_upload_file' ||
  parsedKeyValueTextUploadFile.fileType !== 'bp' ||
  parsedKeyValueTextUploadFile.records?.[0]?.systolic !== 121 ||
  parsedKeyValueTextUploadFile.records?.[0]?.diastolic !== 80 ||
  parsedKeyValueTextUploadFile.records?.[1]?.systolic !== 122 ||
  parsedKeyValueTextUploadFile.records?.[1]?.diastolic !== 81 ||
  (keyValueBloodPressureMetrics?.bloodPressure as any)?.systolic !== 122 ||
  (keyValueBloodPressureMetrics?.bloodPressure as any)?.diastolic !== 81
) {
  throw new Error(
    `Unexpected RW key/value text upload-file parse result: ${JSON.stringify({
      parsedKeyValueTextUploadFile,
      keyValueBloodPressureMetrics
    })}`
  );
}

const keyValueMetricSamples: Array<{
  seq: number;
  frameId: number;
  fileName: string;
  text: string;
  assertRecord: (record: Record<string, any> | undefined) => boolean;
  assertMetrics: (metrics: ReturnType<typeof buildRingBusinessMetrics> | null) => boolean;
}> = [
  {
    seq: 6,
    frameId: 0x48,
    fileName: 'u1_20260101010603_hr.txt',
    text: 'time: 20260101010603 hr: 73\n',
    assertRecord: (record) => record?.heartRate === 73,
    assertMetrics: (metrics) => metrics?.heartRate === 73
  },
  {
    seq: 7,
    frameId: 0x49,
    fileName: 'u1_20260101010703_spo2.txt',
    text: 'time: 20260101010703 spo2: 98\n',
    assertRecord: (record) => record?.bloodOxygen === 98,
    assertMetrics: (metrics) => metrics?.bloodOxygen === 98
  },
  {
    seq: 8,
    frameId: 0x4a,
    fileName: 'u1_20260101010803_temp.txt',
    text: 'time: 20260101010803 skinTemperature: 36.6\n',
    assertRecord: (record) => record?.temperature === 36.6,
    assertMetrics: (metrics) => metrics?.temperature === '36.6\u00b0C'
  },
  {
    seq: 9,
    frameId: 0x4b,
    fileName: 'u1_20260101010903_hrv.txt',
    text: 'time: 20260101010903 hrv: 44\n',
    assertRecord: (record) => record?.hrv === 44,
    assertMetrics: (metrics) => metrics?.hrv === 44
  },
  {
    seq: 10,
    frameId: 0x4c,
    fileName: 'u1_20260101011003_stress.txt',
    text: 'time: 20260101011003 stress: 22\n',
    assertRecord: (record) => record?.stress === 22,
    assertMetrics: (metrics) => metrics?.stress === 22
  },
  {
    seq: 11,
    frameId: 0x4d,
    fileName: 'u1_20260101011103_bs.txt',
    text: 'time: 20260101011103 glucose: 5.7\n',
    assertRecord: (record) => record?.bloodSugar === 5.7,
    assertMetrics: (metrics) => metrics?.bloodSugar === 5.7
  },
  {
    seq: 12,
    frameId: 0x4e,
    fileName: 'u1_20260101011203_step.txt',
    text: 'time: 20260101011203 steps: 3450 calories: 128 activeMinutes: 45 distanceKm: 2.4 intensity_level: 3\n',
    assertRecord: (record) =>
      record?.stepCount === 3450 &&
      record?.calorie === 128 &&
      record?.activityMinutes === 45 &&
      record?.distance === 2.4 &&
      record?.activityLevel === 3,
    assertMetrics: (metrics) =>
      metrics?.stepCount === 3450 &&
      metrics?.calorie === 128 &&
      metrics?.activityMinutes === 45 &&
      metrics?.distance === 2.4 &&
      metrics?.activityLevel === 3
  }
];

for (const sample of keyValueMetricSamples) {
  const parsed = parseRwRingData(
    buildRwFrame(0x36, 0x1b, buildRwTextUploadPayload(sample.seq, sample.fileName, sample.text), sample.frameId)
  );
  const metrics = parsed ? buildRingBusinessMetrics([normalizeRingData(parsed)!]) : null;
  if (parsed?.type !== 'rw_upload_file' || !sample.assertRecord(parsed.records?.[0]) || !sample.assertMetrics(metrics)) {
    throw new Error(
      `Unexpected RW key/value metric history result: ${JSON.stringify({
        sample,
        parsed,
        metrics
      })}`
    );
  }
}

const csvStepTextUploadPayload = buildRwTextUploadPayload(15, 'u1_20260101011603_step.txt', '20260101011603,4567,160,52,3.1,4\n');
const parsedCsvStepTextUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, csvStepTextUploadPayload, 0x52));
const csvStepMetrics = parsedCsvStepTextUploadFile ? buildRingBusinessMetrics([normalizeRingData(parsedCsvStepTextUploadFile)!]) : null;
if (
  parsedCsvStepTextUploadFile?.type !== 'rw_upload_file' ||
  parsedCsvStepTextUploadFile.records?.[0]?.stepCount !== 4567 ||
  parsedCsvStepTextUploadFile.records?.[0]?.calorie !== 160 ||
  parsedCsvStepTextUploadFile.records?.[0]?.activityMinutes !== 52 ||
  parsedCsvStepTextUploadFile.records?.[0]?.distance !== 3.1 ||
  parsedCsvStepTextUploadFile.records?.[0]?.activityLevel !== 4 ||
  csvStepMetrics?.stepCount !== 4567 ||
  csvStepMetrics?.calorie !== 160 ||
  csvStepMetrics?.activityMinutes !== 52 ||
  csvStepMetrics?.distance !== 3.1 ||
  csvStepMetrics?.activityLevel !== 4
) {
  throw new Error(
    `Unexpected RW CSV activity text upload-file parse result: ${JSON.stringify({
      parsedCsvStepTextUploadFile,
      csvStepMetrics
    })}`
  );
}

const semanticKeyValueTextUploadPayload = buildRwTextUploadPayload(
  14,
  'u1_20260101011503_data.txt',
  'Time: 20260101011503 HR: 76 SpO2: 97 Temp: 36.4 BP: 119/78\n'
);
const parsedSemanticKeyValueTextUploadFile = parseRwRingData(
  buildRwFrame(0x36, 0x1b, semanticKeyValueTextUploadPayload, 0x50)
);
const semanticKeyValueMetrics = parsedSemanticKeyValueTextUploadFile
  ? buildRingBusinessMetrics([normalizeRingData(parsedSemanticKeyValueTextUploadFile)!])
  : null;
if (
  parsedSemanticKeyValueTextUploadFile?.type !== 'rw_upload_file' ||
  parsedSemanticKeyValueTextUploadFile.records?.[0]?.heartRate !== 76 ||
  parsedSemanticKeyValueTextUploadFile.records?.[0]?.bloodOxygen !== 97 ||
  parsedSemanticKeyValueTextUploadFile.records?.[0]?.temperature !== 36.4 ||
  parsedSemanticKeyValueTextUploadFile.records?.[0]?.systolic !== 119 ||
  parsedSemanticKeyValueTextUploadFile.records?.[0]?.diastolic !== 78 ||
  semanticKeyValueMetrics?.heartRate !== 76 ||
  semanticKeyValueMetrics?.bloodOxygen !== 97 ||
  semanticKeyValueMetrics?.temperature !== '36.4\u00b0C' ||
  (semanticKeyValueMetrics?.bloodPressure as any)?.systolic !== 119 ||
  (semanticKeyValueMetrics?.bloodPressure as any)?.diastolic !== 78
) {
  throw new Error(
    `Unexpected RW semantic key/value text upload-file parse result: ${JSON.stringify({
      parsedSemanticKeyValueTextUploadFile,
      semanticKeyValueMetrics
    })}`
  );
}

const jsonArrayTextUploadFileName = 'u1_20260101011303_hr.txt';
const jsonArrayTextUploadPayload = buildRwTextUploadPayload(
  13,
  jsonArrayTextUploadFileName,
  '[{"time":"20260101011303","hr":72},{"time":"20260101011403","heartRate":74}]'
);
const parsedJsonArrayTextUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, jsonArrayTextUploadPayload, 0x4f));
const jsonArrayHeartRateMetrics = parsedJsonArrayTextUploadFile
  ? buildRingBusinessMetrics([normalizeRingData(parsedJsonArrayTextUploadFile)!])
  : null;
if (
  parsedJsonArrayTextUploadFile?.type !== 'rw_upload_file' ||
  parsedJsonArrayTextUploadFile.fileType !== 'hr' ||
  parsedJsonArrayTextUploadFile.records?.length !== 2 ||
  parsedJsonArrayTextUploadFile.records[0]?.heartRate !== 72 ||
  parsedJsonArrayTextUploadFile.records[1]?.heartRate !== 74 ||
  jsonArrayHeartRateMetrics?.heartRate !== 74
) {
  throw new Error(
    `Unexpected RW JSON-array text upload-file parse result: ${JSON.stringify({
      parsedJsonArrayTextUploadFile,
      jsonArrayHeartRateMetrics
    })}`
  );
}

const sleepTextUploadPayload = new Uint8Array(46 + '20260101010404,2,60\n20260101010504,3,15\n'.length);
sleepTextUploadPayload[0] = 5;
sleepTextUploadPayload[1] = 2;
sleepTextUploadPayload[2] = 0x01;
sleepTextUploadPayload[6] = 0x02;
const sleepFileName = 'u1_20260101010404_sleep.txt';
for (let index = 0; index < sleepFileName.length; index += 1) {
  sleepTextUploadPayload[10 + index] = sleepFileName.charCodeAt(index);
}
const sleepTextPayload = '20260101010404,2,60\n20260101010504,3,15\n';
for (let index = 0; index < sleepTextPayload.length; index += 1) {
  sleepTextUploadPayload[46 + index] = sleepTextPayload.charCodeAt(index);
}

const parsedSleepTextUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, sleepTextUploadPayload, 0x46));
if (
  parsedSleepTextUploadFile?.type !== 'rw_upload_file' ||
  parsedSleepTextUploadFile.fileType !== 'sleep' ||
  parsedSleepTextUploadFile.records?.[0]?.sleepState !== 2 ||
  parsedSleepTextUploadFile.records?.[0]?.durationMinutes !== 60 ||
  parsedSleepTextUploadFile.records?.[1]?.sleepState !== 3 ||
  parsedSleepTextUploadFile.records?.[1]?.durationMinutes !== 15
) {
  throw new Error(`Unexpected RW sleep text upload-file parse result: ${JSON.stringify(parsedSleepTextUploadFile)}`);
}

const legacySleepAliasTextPayload =
  'time=20260101010604 state=1 sleep_duration=40\n' +
  'time=20260101010704 sleep_stage=2 total_sleep_time=80\n';
const legacySleepAliasUploadPayload = buildRwTextUploadPayload(5, sleepFileName, legacySleepAliasTextPayload);
const parsedLegacySleepAliasUploadFile = parseRwRingData(buildRwFrame(0x36, 0x1b, legacySleepAliasUploadPayload, 0x51));
const legacySleepAliasMetrics = parsedLegacySleepAliasUploadFile
  ? buildRingBusinessMetrics([normalizeRingData(parsedLegacySleepAliasUploadFile)!])
  : null;

if (
  parsedLegacySleepAliasUploadFile?.type !== 'rw_upload_file' ||
  parsedLegacySleepAliasUploadFile.fileType !== 'sleep' ||
  parsedLegacySleepAliasUploadFile.records?.[0]?.sleepState !== 1 ||
  parsedLegacySleepAliasUploadFile.records?.[0]?.durationMinutes !== 40 ||
  parsedLegacySleepAliasUploadFile.records?.[1]?.sleepState !== 2 ||
  parsedLegacySleepAliasUploadFile.records?.[1]?.durationMinutes !== 80 ||
  legacySleepAliasMetrics?.sleepTotalMinutes !== 120 ||
  legacySleepAliasMetrics.sleepLightMinutes !== 40 ||
  legacySleepAliasMetrics.sleepDeepMinutes !== 80
) {
  throw new Error(
    `Unexpected RW legacy sleep alias text upload-file parse result: ${JSON.stringify({
      parsedLegacySleepAliasUploadFile,
      legacySleepAliasMetrics
    })}`
  );
}

export const rwProtocolParityPassed = true;
