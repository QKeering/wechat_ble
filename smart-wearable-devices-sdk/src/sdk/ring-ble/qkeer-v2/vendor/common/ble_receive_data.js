import ble_manager from './ble_manager.js';
import ble_config from './ble_config.js';
import receive_map from '../receiver/ble_receiver_map.js';
import common from '../utils/util_common.js';

/**
 * 解析 DATA INFO 区
 * 格式：
 *  位置1: LEN  (1字节)
 *  位置2: CMD  (1字节)
 *  位置3: DATA (N字节)
 *
 * 约定：LEN = CMD + DATA 的总长度（即 1 + DATA长度）
 */
/**
 * @param {DataView} view
 */
function parseDataInfo(view, offset, totalLen) {
	const len = view.getUint8(offset);      // LEN
	const cmd = view.getUint8(offset + 1);  // CMD

	// DATA 实际长度
	const dataLen = len - 1; // LEN = 1(CMD) + DATA_LEN
	const dataStart = offset + 2;
	const data = view.buffer.slice(view.byteOffset + dataStart, view.byteOffset + dataStart + dataLen);
	return {
		len,
		cmd,
		data,
	};
}

/**
 * 解析整个 BLE 包
 * 帧格式：
 *  1 : DEVICE        (1B)
 *  2 : VERSION       (1B)
 *  3 : PAKET SUM ID  (4B)
 *  7 : PAKET ID      (4B)
 * 11 : DATA INFO     (N B)
 * n+1: CHKSUM        (1B)
 */
function parseBlePacket(arrayBuffer, littleEndian = true) {
	const view = new DataView(arrayBuffer);
	const bytes = new Uint8Array(arrayBuffer);

	if (bytes.length < 1 + 1 + 4 + 4 + 1) {
		throw new Error('包太短，不符合协议最小长度');
	}

	let offset = 0;

	const device = view.getUint8(offset);
	offset += 1;

	const version = view.getUint8(offset);
	offset += 1;

	const packetSum = view.getUint32(offset, littleEndian);
	offset += 4;

	const packetIndex = view.getUint32(offset, littleEndian);
	offset += 4;

	// 最后一字节是 CHKSUM
	const checksumByte = view.getUint8(bytes.length - 1);

	// DATA INFO 的总长度 = 总长 - 当前偏移 - 1(校验)
	const dataInfoTotalLen = bytes.length - offset - 1;
	if (dataInfoTotalLen <= 0) {
		throw new Error('DATA INFO 区长度非法');
	}

	const dataInfo = parseDataInfo(view, offset, dataInfoTotalLen);

	// 校验和检查
	const checksumBytes = new Uint8Array(arrayBuffer, 1, bytes.length - 2);
	const calc = common.checksum(checksumBytes);
	const checksumOk = calc === checksumByte;
	console.log('checksumOk', checksumOk, 'recv=', checksumByte, 'calc=', calc);
	if (!checksumOk) {
		throw new Error(`校验和错误: recv=${checksumByte}, calc=${calc}`);
	}

	return {
		device,
		version,
		packetSum,
		packetIndex,
		dataInfo,
	};
}

// 处理接收到的数据
// 解析并处理设备返回的各类数据
// @param {ArrayBuffer} arrayBuffer - 接收到的数据
function handleReceivedData(arrayBuffer) {
	try {
		const pkt = parseBlePacket(arrayBuffer);
		console.log('handleReceivedData', pkt);

		// 内部协议解析机制
		const funReceiver = receive_map[pkt.dataInfo.cmd];
		if (!funReceiver) {
			console.warn('内部接收-未知的CMD:', pkt.dataInfo.cmd);
			return;
		}
		const mapOrList = funReceiver(pkt.dataInfo.data, pkt.packetSum, pkt.packetIndex);
		if (!mapOrList) {
			console.warn('内部接收-数据解析失败 或 多条数据 CMD:', pkt.dataInfo.cmd);
			return;
		}

		// 外部注册的监听器回调
		const funListener = ble_manager.listenerMaps[pkt.dataInfo.cmd];
		if (!funListener) {
			console.warn('接收-外部注册-未知的CMD:', pkt.dataInfo.cmd);
			return;
		}
		funListener(pkt.dataInfo.cmd, mapOrList);

	} catch (error) {
		console.error('数据解析错误:', error);
	}
}

// 初始化蓝牙通知监听
// 监听设备返回的数据并处理
function initBLENotifyListener() {
	// 监听设备通知
	uni.onBLECharacteristicValueChange((result) => {
		// console.log('接收到设备数据');
		handleReceivedData(result.value);
	});
}

// 启用设备通知
export default async function enableBLENotify(deviceId) {
	return new Promise((resolve, reject) => {
		uni.notifyBLECharacteristicValueChange({
			state: true,
			deviceId: deviceId,
			serviceId: ble_config.UUID_SERVICE_TARGET,
			characteristicId: ble_config.UUID_TARGET_NOTIFY,
			success: (res) => {
				console.log('启用通知成功:enableBLENotify');
				// 启用通知后立即开始监听
				initBLENotifyListener();
				resolve(res);
			},
			fail: (err) => {
				console.error('启用通知失败:', err);
				reject(err);
			}
		});
	});
}
