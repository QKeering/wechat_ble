/**
 * 设备关机（CMD_SYNC_SHUTDOWN, 0x09）
 *
 * 文档：数据内容共计 1 个字节。
 * 实际含义按协议填写，这里只约定：
 *   - 默认发 0x01 表示“确认关机”
 *
 * @param {Object} [mapData]
 */
export default function to_syncShutdown(mapData = {}) {
    let value = 0x01; // 默认 1

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncShutdown', mapData, db);

    return db;
}
