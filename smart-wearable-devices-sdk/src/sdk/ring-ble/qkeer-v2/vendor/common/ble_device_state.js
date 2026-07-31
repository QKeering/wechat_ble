/**
 * Shared mutable BLE device state.
 *
 * Extracted to break circular dependencies between:
 *   ble_manager <-> ble_send_data
 *   ble_manager <-> ble_receive_data
 *   ble_manager <-> ble_ota_data (via receiver chain)
 *
 * ble_manager writes to this object; consumers read from it.
 */
const deviceState = {
  deviceType: 0x00,
  protocolVersion: 0x01,
  mtuSize: 256,
  connectedDeviceId: '',
  listenerMaps: {},
  /** @type {null|((cmd: number, mapData: object) => Promise<void>)} */
  sendData: null
};

export default deviceState;
