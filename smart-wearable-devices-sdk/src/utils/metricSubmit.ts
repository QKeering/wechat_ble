const isColonSeparatedMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

const pickFirstText = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

export const getMetricSubmitDeviceMac = (userStore: any, isIOS = false) => {
  const info = userStore?.deviceInfo || {};
  const advertisMac = info.advertis?.macInfo;

  if (isIOS) {
    return pickFirstText(userStore?.normalMac, info.mac, advertisMac, isColonSeparatedMac(info.uniMacId) ? info.uniMacId : '', info.deviceId, userStore?.iosMacId);
  }

  return pickFirstText(info.deviceId, info.mac, advertisMac, userStore?.normalMac, isColonSeparatedMac(info.uniMacId) ? info.uniMacId : '', userStore?.iosMacId);
};

export const formatMetricRecordTime = (value?: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  const timestamp = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.now();
  const date = new Date(timestamp < 100000000000 ? timestamp * 1000 : timestamp);
  const pad = (item: number) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
