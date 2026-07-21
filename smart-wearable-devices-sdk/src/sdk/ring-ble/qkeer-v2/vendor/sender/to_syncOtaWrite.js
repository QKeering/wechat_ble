/**
 * OTA 写入文件（CMD_SYNC_OTA_WRITE, 0x6E）
 *
 * 文档：DATA 为文件数据流，长度 n 字节。
 *
 * @param {Object} mapData
 * @param {ArrayBuffer} mapData.data 固件整包数据，长度超长发送时会自动分包
 */
export default function to_syncOtaWrite(mapData = {}) {
    console.log('to_syncOtaWrite', mapData);
    return mapData.data;
}
