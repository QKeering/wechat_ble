
/**
 * @param {ArrayBuffer} packetArrayBuffer 
 * @param {ArrayBuffer} arrayBuffer 
 * @param {number} packet_sum 
 * @param {number} packet_index 
 * @returns {ArrayBuffer}
 */
function parseReceiverList(packetArrayBuffer, arrayBuffer, packet_sum, packet_index) {
    console.log('parseReceiverList', packetArrayBuffer, arrayBuffer, packet_sum, packet_index);

    if (packet_sum > 1) {
        if (packet_index < packet_sum - 1) {
            if (!packetArrayBuffer) {
                return arrayBuffer;
            }
        }
        return common.concatArrayBuffers([packetArrayBuffer, arrayBuffer]);
    }
    return arrayBuffer;
}

export default {
    parseReceiverList: parseReceiverList,
};