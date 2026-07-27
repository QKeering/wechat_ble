import device_state from './ble_device_state.js';
import ble_config from './ble_config.js';
import ble_cmd from './ble_cmd.js';
import ble_events from './ble_events.js'
import common from '../utils/util_common.js';

class BleOtaData {

	constructor() {
		this.timerID = 0;

		this.buffer = null;
		this.dataSize = 0;
		this.sendCount = 0;
		this.sendIndex = 0;
		this.sendOffset = 0;
	}


	// 发送数据到设备
	// @param {ArrayBuffer} arrayBuffer - 要发送的数据
	/**
	 * @param {ArrayBuffer} arrayBuffer
	 */
	async sendOtaData(arrayBuffer) {
		if (this.timerID) {
			clearTimeout(this.timerID);
			this.timerID = 0;
		};
		try {
			console.log("sendOtaData", arrayBuffer, device_state.mtuSize, ble_config.PACKAGE_HEAD_SIZE);

			this.buffer = arrayBuffer;
			this.dataSize = device_state.mtuSize - ble_config.PACKAGE_HEAD_SIZE;
			this.sendCount = Math.ceil(arrayBuffer.byteLength / this.dataSize);
			this.sendIndex = 0;
			this.sendOffset = 0;
			console.log("sendOtaData", this.sendCount, this.dataSize);

			await device_state.sendData(ble_cmd.CMD_SYNC_OTA_START, {});
			this.timerID = setTimeout(() => ble_events.otaStatus(1), 3000);

		} catch (error) {
			console.log(error);
		}
	}

	// 由蓝牙数据引起的回调
	async sendOtaDataWrite() {
		if (this.timerID) {
			clearTimeout(this.timerID);
			this.timerID = 0;
		};
		console.log("sendOtaDataWrite", this.sendOffset, this.sendIndex);
		try {
			if (this.sendOffset >= this.buffer.byteLength) {
				console.log("sendOtaDataWrite CMD_SYNC_OTA_END");
				await device_state.sendData(ble_cmd.CMD_SYNC_OTA_END, {
					crc32: 0,
				});
			}
			else {
				let end = Math.min(this.sendOffset + this.dataSize, this.buffer.byteLength);
				let chunk = this.buffer.slice(this.sendOffset, end);
				console.log(`sendOtaDataWrite 分包发送 第 ${this.sendIndex + 1} / ${this.sendCount}`, chunk);

				await device_state.sendData(ble_cmd.CMD_SYNC_OTA_WRITE, {
					data: chunk,
				});

				this.sendOffset += this.dataSize;
				this.sendIndex++;
			}
			this.timerID = setTimeout(() => ble_events.otaStatus(1), 3000);
		} catch (error) {
			console.log(error);
		}
	}

	// 由蓝牙数据引起的回调
	async sendOtaDataEnd() {
		console.log("sendOtaDataEnd");
		if (this.timerID) {
			clearTimeout(this.timerID);
			this.timerID = 0;
		};
		ble_events.otaStatus(1)
	}

}

export default new BleOtaData();


