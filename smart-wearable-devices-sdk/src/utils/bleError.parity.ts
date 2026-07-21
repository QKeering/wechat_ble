import { formatBleErrorMessage, isExpectedBleRuntimeError } from './bleError';

const mtuInternalError = { errMsg: 'setBLEMTU:fail:internal' };

if (!isExpectedBleRuntimeError(mtuInternalError)) {
  throw new Error('setBLEMTU internal failures should be treated as expected BLE runtime errors.');
}

if (formatBleErrorMessage(mtuInternalError) !== '设备通信参数协商失败，请重连后重试') {
  throw new Error(`setBLEMTU internal failures should be shown as a localized retry hint: ${formatBleErrorMessage(mtuInternalError)}`);
}

if (formatBleErrorMessage(new Error('RW parsed data wait timeout.')) !== '设备命令已发出但未收到回包，请复制诊断日志定位命令') {
  throw new Error('BLE timeout errors should point users to command-level diagnostics.');
}

if (
  formatBleErrorMessage(new Error('RW parsed data wait timeout after 1000ms.')) !==
  formatBleErrorMessage(new Error('RW parsed data wait timeout.'))
) {
  throw new Error('Detailed RW timeout errors should still use the shared command-level diagnostic hint.');
}

if (formatBleErrorMessage(new Error("Cannot read properties of null (reading 'deviceId')")) !== '设备状态已变化，请重新搜索后再连接') {
  throw new Error('BLE stale device-state errors should keep the shared localized reconnect hint.');
}

const networkTimeoutHint = '\u7f51\u7edc\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';

if (
  formatBleErrorMessage({
    msg: networkTimeoutHint,
    rawMsg: 'request:fail net::ERR_CONNECTION_TIMED_OUT'
  }) !== networkTimeoutHint
) {
  throw new Error('Network request timeouts should not be shown as BLE command timeouts.');
}

if (formatBleErrorMessage(new Error('request:fail net::ERR_CONNECTION_TIMED_OUT')) !== networkTimeoutHint) {
  throw new Error('Raw request timeout errors should keep the localized network timeout hint.');
}
