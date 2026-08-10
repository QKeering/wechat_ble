import qkeerV2VendorConsole from './debug_console.js';

function bleConnected(deviceInfo) {
	uni.$emit('deviceConnected', {
		deviceInfo: deviceInfo
	});
}

// 发送断开连接事件
function bleDisconnected(deviceId) {
	uni.$emit('deviceDisconnected', {
		deviceId: deviceId
	});
}

function otaStatus(status) {
	qkeerV2VendorConsole.log("otaStatus", status);
	uni.$emit('otaStatus', {
		status: status
	});
}

export default {
	bleConnected: bleConnected,
	bleDisconnected: bleDisconnected,
	otaStatus: otaStatus,
};