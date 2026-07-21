import ble_manager from './ble_manager.js';
import common from '../utils/util_common.js';
import ble_config from './ble_config.js';

function packOrgContent(cmd, arrayBuffer) {
	// 数据内容组装
	let db = new ArrayBuffer(2 + arrayBuffer.byteLength);
	let db_vi = new DataView(db);
	db_vi.setUint8(0, 1 + arrayBuffer.byteLength);
	db_vi.setUint8(1, cmd);
	let bufView = new Uint8Array(arrayBuffer);
	for (let i = 0; i < bufView.length; i++) {
		db_vi.setUint8(2 + i, bufView[i]);
	}
	//console.log("sendSingleData db", db);
	return db;
}

/**
 * 除去设备标识后的数据包组装
 * @param {ArrayBuffer} arrayBuffer
 */
function packContentData(arrayBuffer, index, count) {
	//console.log("packContentData", arrayBuffer, index, count);

	let offset = 9;
	let db = new ArrayBuffer(offset + arrayBuffer.byteLength);
	let db_vi = new DataView(db);

	db_vi.setUint8(0, ble_manager.protocolVersion); // 版本号
	db_vi.setUint32(1, count, true); // 数据长度（小端格式）
	db_vi.setUint32(5, index, true); // 数据序列号（小端格式）
	// 复制数据内容
	let bufView = new Uint8Array(arrayBuffer);
	for (let i = 0; i < bufView.length; i++) {
		db_vi.setUint8(9 + i, bufView[i]);
	}
	//console.log("packContentData db", db);
	return db;
}

/**
 * 添加校验码
 * @param {ArrayBuffer} arrayBuffer
 */
function packCheckData(arrayBuffer) {
	let checksumLen = 1;
	let db = new ArrayBuffer(arrayBuffer.byteLength + checksumLen);
	let db_vi = new DataView(db);
	// 复制数据内容
	let bufView = new Uint8Array(arrayBuffer);
	for (let i = 0; i < bufView.length; i++) {
		db_vi.setUint8(i, bufView[i]);
	}

	// 计算并设置校验码
	let crc = common.checksum(arrayBuffer);
	db_vi.setUint8(bufView.length, (crc & 0xFF));

	//console.log("packCheckData db", db);
	return db;
}

/**
 * 数据包组装，添加设备标识
 * @param {ArrayBuffer} arrayBuffer
 */
function packData(arrayBuffer) {
	//console.log("packData", arrayBuffer);

	// 添加设备标识
	let db = new ArrayBuffer(1 + arrayBuffer.byteLength);
	let db_vi = new DataView(db);
	db_vi.setUint8(0, ble_manager.deviceType); // 设备标识
	let bufView = new Uint8Array(arrayBuffer);
	for (let i = 0; i < bufView.length; i++) {
		db_vi.setUint8(1 + i, bufView[i]);
	}

	return db;
}

/**
 * @param {number} cmd
 * @param {ArrayBuffer} arrayBuffer
 */
async function sendPacketData(cmd, arrayBuffer, index, count) {
	return new Promise((resolve, reject) => {
		// 添加延时后再发送数据
		setTimeout(() => {
			console.log("sendSingleData", cmd, arrayBuffer);

			// 数据内容组装
			let orgContentDb = packOrgContent(cmd, arrayBuffer);

			// 除去设备标识后的数据包组装
			let contentData = packContentData(orgContentDb, index, count);

			// 除去设备标识后的数据包组装，添加校验码
			let checkData = packCheckData(contentData);

			// 数据包组装
			let pack_db = packData(checkData);

			console.log("sendSingleData pack_db", pack_db);

			uni.writeBLECharacteristicValue({
				deviceId: ble_manager.connectedDeviceId,
				serviceId: ble_config.UUID_SERVICE_TARGET,
				characteristicId: ble_config.UUID_TARGET_CHARACTERISTIC,
				value: pack_db,
				success: (res) => {
					console.log('单条指令发送成功:', pack_db);
					resolve(res);
				},
				fail: (err) => {
					console.log('单条指令发送失败', pack_db);
					reject(err);
				}
			});
		}, 1); // 延时0.001秒后发送
	});
}



/**
 * @param {number} cmd
 * @param {ArrayBuffer} arrayBuffer
 */
async function sendSingleData(cmd, arrayBuffer) {
	await sendPacketData(cmd, arrayBuffer, 0, 1);
}

/**
 * @param {number} cmd
 * @param {ArrayBuffer} arrayBuffer
 */
async function sendBlockData(cmd, arrayBuffer, index, count) {
	await sendPacketData(cmd, arrayBuffer, index, count);
}

// 发送数据到设备
// @param {ArrayBuffer} arrayBuffer - 要发送的数据
/**
 * @param {number} cmd
 * @param {ArrayBuffer} arrayBuffer
 */
export default async function sendData(cmd, arrayBuffer) {
	try {

		if (!ble_manager.connectedDeviceId) {
			throw new Error('设备未连接');
		}

		let dataSize = ble_manager.mtuSize - ble_config.PACKAGE_HEAD_SIZE;

		if (arrayBuffer.byteLength <= dataSize) { // 单次整包发送数据
			await sendSingleData(cmd, arrayBuffer);
		} else { // 分包发送数据
			const count = Math.ceil(arrayBuffer.byteLength / dataSize);
			console.log(`ble_send_data 需要分包发送，数据总长度: ${arrayBuffer.byteLength}，分包数量: ${count}`);

			for (let offset = 0, index = 0; offset < arrayBuffer.byteLength; offset += dataSize, index++) {
				let end = Math.min(offset + dataSize, arrayBuffer.byteLength);
				let chunk = arrayBuffer.slice(offset, end);
				console.log(`ble_send_data 分包发送 第 ${index + 1} / ${count}`, chunk);

				await sendBlockData(cmd, chunk, index, count);
				await new Promise(resolve => setTimeout(resolve, 1));
			}
		}

	} catch (error) {
		console.log(error);
	}
}
