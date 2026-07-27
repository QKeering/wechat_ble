import ble_config from './ble_config.js';
import ble_events from './ble_events.js';
import ble_receive_data from './ble_receive_data.js';
import ble_send_data from './ble_send_data.js';
import sender_map from '../sender/ble_sender_map.js';
import device_info from '../utils/util_device_info.js';
import device_state from './ble_device_state.js';

class BleManager {

	constructor() {
		this.deviceType = 0x00; // 设备类型，默认0x00
		this.protocolVersion = 0x01; // 协议版本，默认0x01
		this.isCharging = 0; // 充电状态，0-未充电，1-充电中
		this.batteryLevel = 0; // 电量百分比，0-100
		this.macInfo = ''; // 设备MAC地址
		this.mtuSize = ble_config.BLE_MTU_SIZE; // MTU大小

		const platform = uni.getSystemInfoSync().platform;
		if (platform === 'ios') {
			this.mtuSize = 20;
		}

		// 初始化状态
		this.isBluetoothAvailable = false;
		this.isScanning = false;
		this.connectedDeviceId = '';
		this.deviceInfo = {}

		this.deviceFoundList = {}; // 搜索到的设备列表
		this.listenerMaps = {};

		// Sync initial values to shared state (see ble_device_state.js)
		device_state.deviceType = this.deviceType;
		device_state.protocolVersion = this.protocolVersion;
		device_state.mtuSize = this.mtuSize;
		device_state.connectedDeviceId = this.connectedDeviceId;
		device_state.listenerMaps = this.listenerMaps;

		// 监听蓝牙连接状态
		this.onBleConnectionStateChange();
	}

	// 初始化蓝牙适配器
	async openBluetoothAdapter() {
		return new Promise((resolve, reject) => {
			uni.openBluetoothAdapter({
				success: (res) => {
					this.isBluetoothAvailable = true;
					resolve(true);
				},
				fail: (err) => {
					this.isBluetoothAvailable = false;
					console.error(err);
					reject(new Error('蓝牙适配器初始化失败'));
				}
			});
		});
	}

	// 关闭蓝牙模块
	async closeBluetoothAdapter() {
		return new Promise((resolve, reject) => {
			uni.closeBluetoothAdapter({
				success: (res) => {
					this.isBluetoothAvailable = false;
					this.isScanning = false;
					this.connectedDeviceId = '';
						device_state.connectedDeviceId = '';
					resolve(res);
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('关闭蓝牙模块'));
				}
			});
		});
	}

	// 开始搜索设备
	async startBluetoothDevicesDiscovery() {
		if (this.isScanning) return;
		return new Promise((resolve, reject) => {
			this.deviceFoundList = {};
			uni.startBluetoothDevicesDiscovery({
				allowDuplicatesKey: true,
				interval: 0, // 0 表示尽可能快地搜索
				success: (res) => {
					this.isScanning = true;
					resolve(res);
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('搜索设备失败'));
				}
			});
		});
	}

	// 停止搜索设备
	async stopBluetoothDevicesDiscovery() {
		if (!this.isScanning) return;
		return new Promise((resolve, reject) => {
			uni.stopBluetoothDevicesDiscovery({
				success: (res) => {
					this.isScanning = false;
					resolve(res);
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('停止搜索失败'));
				}
			});
		});
	}

	// 设置BLE MTU (微信iOS不支持该接口，所以现在不用这个接口)
	async setBLEMTU() {
		return new Promise((resolve, reject) => {
			uni.setBLEMTU({
				deviceId: this.connectedDeviceId,
				mtu: ble_config.BLE_MTU_SIZE,
				success: (res) => {
					console.log('setBLEMTU', res);
					this.mtuSize = res.mtu;
					device_state.mtuSize = res.mtu;
					resolve(res);
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('停止搜索失败'));
				}
			});
		});
	}

	async checkDeviceServices(device) {
		let retryCount = 0;
		let service = null;
		let characteristic = null;

		// 连接后等待一段时间
		await new Promise(resolve => setTimeout(resolve, 100));

		while (retryCount < 3) {
			try {
				service = await this.getBLEDeviceServices(device.deviceId);
				if (service) {
					await new Promise(resolve => setTimeout(resolve, 100));
					characteristic = await this.getBLEDeviceCharacteristics(device.deviceId);
					break;
				}
			} catch (error) {
				console.log(`第 ${retryCount + 1} 次尝试获取服务失败:`, error);
				if (++retryCount < 3) {
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}
		}
		return characteristic;
	}

	// 连接设备
	async createBLEConnection(deviceInfo) {
		console.log('createBLEConnection', deviceInfo);
		let device = deviceInfo.device;
		let advertis = deviceInfo.advertis;

		return new Promise((resolve, reject) => {
			uni.createBLEConnection({
				deviceId: device.deviceId,
				timeout: 15000,
				success: async (res) => {
					try {

						this.deviceType = advertis.deviceType; // 设备类型，默认0x00
						device_state.deviceType = this.deviceType;
						this.protocolVersion = advertis.protocolVersion;
						device_state.protocolVersion = this.protocolVersion;
						this.isCharging = advertis.isCharging; // 充电状态，0-未充电，1-充电中
						this.batteryLevel = advertis.batteryLevel; // 电量百分比，0-100
						this.macInfo = advertis.macInfo; // 设备MAC地址
						this.connectedDeviceId = device.deviceId;
						device_state.connectedDeviceId = this.connectedDeviceId;
						this.deviceInfo = deviceInfo;

						// 查找服务和特征值
						let characteristic = await this.checkDeviceServices(device);
						if (characteristic) {

							// 开始监听蓝牙数据，接收设备返回的数据
							await ble_receive_data(device.deviceId);

							ble_events.bleDisconnected(deviceInfo);

							resolve(device.deviceId);
						} else {
							throw new Error('服务查找失败');
						}
					} catch (error) {
						await this.closeBLEConnection(device.deviceId);
						reject(error);
					}
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('连接失败'));
				}
			});
		});
	}

	// 断开连接
	async closeBLEConnection(deviceId) {
		return new Promise((resolve, reject) => {
			uni.closeBLEConnection({
				deviceId: deviceId,
				success: (res) => {
					this.connectedDeviceId = '';
						device_state.connectedDeviceId = '';
					resolve(res);
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('断开连接失败'));
				}
			});
		});
	}

	//--------------------------------------------------------------------------------------

	// 获取设备的服务列表
	async getBLEDeviceServices(deviceId) {
		return new Promise((resolve, reject) => {
			uni.getBLEDeviceServices({
				deviceId: deviceId,
				success: (res) => {
					if (!res.services || res.services.length === 0) {
						console.error('服务列表为空');
						reject(new Error('服务列表为空'));
						return;
					}

					for (let i = 0; i < res.services.length; i++) {
						console.log('获取到的服务列表: ' + res.services[i].uuid);
					}

					// 直接查找目标服务UUID
					let targetService = res.services.find(
						service => service.uuid === ble_config.UUID_SERVICE_TARGET
					);

					if (targetService) {
						console.log('找到目标服务:', targetService.uuid);
						resolve(targetService);
					} else {
						console.error('未找到目标服务');
						reject(new Error('未找到目标服务'));
					}
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('未找到目标服务'));
				}
			});
		});
	}

	// 获取设备的特征值列表
	async getBLEDeviceCharacteristics(deviceId) {
		return new Promise((resolve, reject) => {
			uni.getBLEDeviceCharacteristics({
				deviceId: deviceId,
				serviceId: ble_config.UUID_SERVICE_TARGET,
				success: (res) => {
					const targetCharacteristic = res.characteristics?.find(
						characteristic => characteristic.uuid === ble_config.UUID_TARGET_NOTIFY
					);
					if (targetCharacteristic) {
						resolve(targetCharacteristic);
						return;
					}
					if (!res.characteristics || res.characteristics.length === 0) {
						console.error('特征值列表为空');
						reject(new Error('特征值列表为空'));
						return;
					}
					// 查找特定的特征值
					if (res.characteristics[0].uuid == ble_config.UUID_TARGET_NOTIFY) {
						console.log('找到目标特征值:', res.characteristics[0].uuid);
						resolve(res.characteristics[0]);
					} else {
						console.error('未找到目标特征值:', res.characteristics[0].uuid);
						reject(new Error('未找到目标特征值'));
					}
				},
				fail: (err) => {
					console.error(err);
					reject(new Error('未找到目标特征值'));
				}
			});
		});
	}


	//-----------------------------------------------------------------------------------

	// 解析广播设备信息
	parseAdvertisDeviceInfo(advertisData) {
		console.log('parseAdvertisDeviceInfo', advertisData);

		let map = {}

		let offset = 2; // 跳过前两个字节的长度和类型
		let db_vi = new DataView(advertisData);
		map.deviceType = db_vi.getUint8(offset + 0);
		map.protocolVersion = db_vi.getUint8(offset + 1);

		let batteryInfo = db_vi.getUint8(offset + 2);
		let batteryMap = device_info.parseBatteryInfo(batteryInfo);
		map.isCharging = batteryMap.isCharging;
		map.batteryLevel = batteryMap.batteryLevel;

		let arrayBuffer = advertisData.slice(offset + 3, offset + 9);
		map.macInfo = device_info.parseMacInfo(arrayBuffer);

		console.log('解析到的广播设备信息 ',
			'设备类型:', map.deviceType,
			'协议版本:', map.protocolVersion,
			'电量:', map.batteryLevel,
			'充电状态:', map.isCharging,
			'MAC地址:', map.macInfo);

		return map;
	}

	// 去重处理，RSSI变化不超过5的不重复上报，避免界面频繁刷新
	checkExistsDevice(device) {
		const existsDevice = this.deviceFoundList[device.deviceId];
		if (existsDevice) {
			if (existsDevice.RSSI > device.RSSI)
				return true;
			if (Math.abs(existsDevice.RSSI - device.RSSI) <= 10) {
				return true;
			}
		}
		this.deviceFoundList[device.deviceId] = device;
		return false;
	}

	/**
	 * 监听发现新设备事件
	 * callback(device)
	 * 返回的 device 示例：
	 * 		device.RSSI: -70
	 * 		device.advertisData: ArrayBuffer(11)
	 * 		device.advertisServiceUUIDs: Array(1)
	 * 		device.connectable: true
	 * 		device.deviceId: "C331E066-FD19-18A8-967C-97C83FA0B2E3"
	 * 		device.localName: "Musleep_Ring3_0869"
	 * 		device.name: "Musleep_Ring3_0869"
	 */
	onBluetoothDeviceFound(callback) {
		uni.onBluetoothDeviceFound((res) => {
			if (res.devices && res.devices[0]) {
				const device = res.devices[0];
				if (device.advertisData) {
					if (device.advertisServiceUUIDs && device.advertisServiceUUIDs.length >= 0) {
						const advertisServiceUUID = device.advertisServiceUUIDs[0];
						if (advertisServiceUUID.toUpperCase() == ble_config.UUID_SERVICE_ADVERTIS) {
							console.log('onBluetoothDeviceFound', device);
							if (this.checkExistsDevice(device)) {
								return;
							}
							let deviceInfo = {};
							deviceInfo.advertis = this.parseAdvertisDeviceInfo(device.advertisData);
							deviceInfo.device = device;
							callback && callback(deviceInfo);
						}
					}
				}
			}
		});
	}

	// 初始化蓝牙监听
	onBleConnectionStateChange() {
		uni.onBLEConnectionStateChange((res) => {
			console.log('设备连接状态变化：' + res.deviceId + ', connected: ' + res.connected);
			// 设备断开连接
			if (res.deviceId === this.connectedDeviceId) {
				if (!res.connected) {
					this.connectedDeviceId = '';
						device_state.connectedDeviceId = '';
					ble_events.bleDisconnected(res.deviceId);
				}
			}
		});
	}

	//-----------------------------------------------------------------------------------

	// 设置接收数据监听器
	/**
	 * @param { Map } listenerMap
	 * listenerMap 示例：
	 * {
	 *    [ble_cmd.CMD_GET_DEVICE_INFO]: function(cmd, map){},
	 * }
	 * map为已解析出来的数据 示例：
	 * {
	 *    isSuccess: 1,
	 * }
	 */
	setReceiverListener(listenerMap) {
		this.listenerMaps = listenerMap;
		device_state.listenerMaps = listenerMap;
	}

	// 发送数据到设备
	/**
	 * @param {number} cmd
	 * @param { Map } mapData
	 */
	async sendData(cmd, mapData) {
		try {
			const funSender = sender_map[cmd];
			if (!funSender) {
				console.warn('BleManager 发送 内部发送-未知的CMD:', cmd);
				return;
			}
			const db = funSender(mapData);
			await ble_send_data(cmd, db);

		} catch (error) {
			console.warn('BleManager sendData', error);
		}
	}

}

const bleManagerInstance = new BleManager();
device_state.sendData = bleManagerInstance.sendData.bind(bleManagerInstance);
export default bleManagerInstance;
