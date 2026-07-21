import ble_cmd from '../common/ble_cmd.js';

import to_syncDeviceInfo from './to_syncDeviceInfo.js';
import to_syncUserInfo from './to_syncUserInfo.js';
import to_syncSleepInfo from './to_syncSleepInfo.js';
import to_syncSleepListInfo from './to_syncSleepListInfo.js';
import to_syncHealthInfo from './to_syncHealthInfo.js';
import to_syncHealthListInfo from './to_syncHealthListInfo.js';
import to_syncStepInfo from './to_syncStepInfo.js';
import to_syncStepListInfo from './to_syncStepListInfo.js';
import to_syncMeasureInfo from './to_syncMeasureInfo.js';
import to_syncEcg from './to_syncEcgInfo.js';

import to_syncShutdown from './to_syncShutdown.js';
import to_syncMeasureTimer from './to_syncMeasureTimer.js';
import to_syncReset from './to_syncReset.js';
import to_syncLastData from './to_syncLastData.js';
import to_syncEnhanceSleepSetting from './to_syncEnhanceSleepSetting.js';
import to_syncEnhanceSleepRead from './to_syncEnhanceSleepRead.js';
import to_syncReboot from './to_syncReboot.js';
import to_syncOtaStart from './to_syncOtaStart.js';
import to_syncOtaWrite from './to_syncOtaWrite.js';
import to_syncOtaEnd from './to_syncOtaEnd.js';

export default {
	[ble_cmd.CMD_GET_DEVICE_INFO]: to_syncDeviceInfo,
	[ble_cmd.CMD_SYNC_USER_INFO]: to_syncUserInfo,
	[ble_cmd.CMD_SYNC_SLEEP]: to_syncSleepInfo,
	[ble_cmd.CMD_SYNC_SLEEP_LIST]: to_syncSleepListInfo,
	[ble_cmd.CMD_SYNC_HEALTH]: to_syncHealthInfo,
	[ble_cmd.CMD_SYNC_HEALTH_LIST]: to_syncHealthListInfo,
	[ble_cmd.CMD_SYNC_STEP]: to_syncStepInfo,
	[ble_cmd.CMD_SYNC_STEP_LIST]: to_syncStepListInfo,
	[ble_cmd.CMD_SYNC_MEASURE]: to_syncMeasureInfo,
	[ble_cmd.CMD_SYNC_ECG]: to_syncEcg,

	[ble_cmd.CMD_SYNC_SHUTDOWN]: to_syncShutdown,
	[ble_cmd.CMD_SYNC_MEASURE_TIMER]: to_syncMeasureTimer,
	[ble_cmd.CMD_SYNC_RESET]: to_syncReset,
	[ble_cmd.CMD_SYNC_LAST_DATA]: to_syncLastData,
	[ble_cmd.CMD_SYNC_ENHANCE_SLEEP_SETTING]: to_syncEnhanceSleepSetting,
	[ble_cmd.CMD_SYNC_ENHANCE_SLEEP_READ]: to_syncEnhanceSleepRead,
	[ble_cmd.CMD_SYNC_REBOOT]: to_syncReboot,
	[ble_cmd.CMD_SYNC_OTA_START]: to_syncOtaStart,
	[ble_cmd.CMD_SYNC_OTA_WRITE]: to_syncOtaWrite,
	[ble_cmd.CMD_SYNC_OTA_END]: to_syncOtaEnd,
};