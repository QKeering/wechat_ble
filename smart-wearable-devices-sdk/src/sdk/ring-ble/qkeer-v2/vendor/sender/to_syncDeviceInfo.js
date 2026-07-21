/**
 * 同步设备信息
 * @param {number} mapData.version 设备固件版本号
 */
export default function to_syncDeviceInfo(mapData) {

    let db = new ArrayBuffer(1);
    let db_vi = new DataView(db);
    db_vi.setUint8(0, mapData.version);

    console.log('to_syncDeviceInfo', mapData, db);

    return db;
}