/**
 * OTA 文件写入结束（CMD_SYNC_OTA_END, 0x6F）
 *
 * @param {Object} [mapData]
 * @param {number} [mapData.crc32]
 */
export default function to_syncOtaEnd(mapData = {}) {

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint32(0, mapData.crc32, true);

    console.log('to_syncOtaEnd', mapData, db);

    return db;
}
