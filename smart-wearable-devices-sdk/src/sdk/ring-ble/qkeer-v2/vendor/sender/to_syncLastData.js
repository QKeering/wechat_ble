/**
 * 预览当天最后记录数据（CMD_SYNC_LAST_DATA, 0x70）
 *
 * 文档：数据内容共计 1 字节。
 *
 * @param {Object} [mapData]
 * @param {number} [mapData.value]  自定义值，默认 0x00
 */
export default function to_syncLastData(mapData = {}) {
    const value = 0x00;

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncLastData', mapData, db);

    return db;
}
