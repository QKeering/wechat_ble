import ble_cmd from '../common/ble_cmd.js';

import on_syncDeviceInfo from './on_syncDeviceInfo.js';
import on_syncUserInfo from './on_syncUserInfo.js';

import on_syncSleepInfo from './on_syncSleepInfo.js';
import on_syncSleepListInfo from './on_syncSleepListInfo.js';
import on_syncHealthInfo from './on_syncHealthInfo.js';
import on_syncHealthListInfo from './on_syncHealthListInfo.js';
import on_syncEcgInfo from './on_syncEcgInfo.js';
import on_syncMeasureInfo from './on_syncMeasureInfo.js';
import on_syncStepInfo from './on_syncStepInfo.js';
import on_syncStepListInfo from './on_syncStepListInfo.js';

import on_syncMeasureTimer from './on_syncMeasureTimer.js';
import on_syncHeartbeat from './on_syncHeartbeat.js';
import on_syncLastData from './on_syncLastData.js';
import on_syncEnhanceSleepSetting from './on_syncEnhanceSleepSetting.js';
import on_syncEnhanceSleepRead from './on_syncEnhanceSleepRead.js';
import on_syncOtaStart from './on_syncOtaStart.js';
import on_syncOtaWrite from './on_syncOtaWrite.js';
import on_syncOtaEnd from './on_syncOtaEnd.js';

// 命令处理映射表，解析每条协议
export default {
	[ble_cmd.CMD_GET_DEVICE_INFO]: on_syncDeviceInfo,
	[ble_cmd.CMD_SYNC_USER_INFO]: on_syncUserInfo,

	[ble_cmd.CMD_SYNC_SLEEP]: on_syncSleepInfo,
	[ble_cmd.CMD_SYNC_SLEEP_LIST]: on_syncSleepListInfo,
	[ble_cmd.CMD_SYNC_HEALTH]: on_syncHealthInfo,
	[ble_cmd.CMD_SYNC_HEALTH_LIST]: on_syncHealthListInfo,
	[ble_cmd.CMD_SYNC_MEASURE]: on_syncMeasureInfo,
	[ble_cmd.CMD_SYNC_ECG]: on_syncEcgInfo,
	[ble_cmd.CMD_SYNC_STEP]: on_syncStepInfo,
	[ble_cmd.CMD_SYNC_STEP_LIST]: on_syncStepListInfo,

	[ble_cmd.CMD_SYNC_MEASURE_TIMER]: on_syncMeasureTimer,
	[ble_cmd.CMD_SYNC_HEARTBEAT]: on_syncHeartbeat,
	[ble_cmd.CMD_SYNC_LAST_DATA]: on_syncLastData,
	[ble_cmd.CMD_SYNC_ENHANCE_SLEEP_SETTING]: on_syncEnhanceSleepSetting,
	[ble_cmd.CMD_SYNC_ENHANCE_SLEEP_READ]: on_syncEnhanceSleepRead,
	[ble_cmd.CMD_SYNC_OTA_START]: on_syncOtaStart,
	[ble_cmd.CMD_SYNC_OTA_WRITE]: on_syncOtaWrite,
	[ble_cmd.CMD_SYNC_OTA_END]: on_syncOtaEnd,
};
