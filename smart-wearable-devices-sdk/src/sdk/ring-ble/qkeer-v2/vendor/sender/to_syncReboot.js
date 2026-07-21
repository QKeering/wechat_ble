/**
 * 重启设备（CMD_SYNC_REBOOT, 0x6C）
 *
 * 文档：数据内容共计 1 个字节。
 *      默认 0x01。
 *
 * @param {Object} [mapData]
 */
export default function to_syncReboot(mapData = {}) {
    let value = 0x01;

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncReboot', mapData, db);

    return db;
}
