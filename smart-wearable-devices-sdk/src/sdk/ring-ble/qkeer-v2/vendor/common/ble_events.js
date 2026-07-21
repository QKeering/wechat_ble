
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
	console.log("otaStatus", status);
	uni.$emit('otaStatus', {
		status: status
	});
}

export default {
	bleConnected: bleConnected,
	bleDisconnected: bleDisconnected,
	otaStatus: otaStatus,
};