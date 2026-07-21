/**
 * OTA 指令（CMD_SYNC_OTA, 0x6D）
 *
 * 文档：数据内容共计 1 个字节。
 *
 * @param {Object} [mapData]
 * @param {boolean} [mapData.start]
 * @param {boolean} [mapData.end]
 */
export default function to_syncOtaStart(mapData = {}) {
    let value = 0x01;

    if(mapData.start){
        value = 0x01;
    }else if(mapData.end){
        value = 0x02;
    }

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncOtaStart', mapData, db);

    return db;
}
