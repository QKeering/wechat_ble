import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

/**
 * Android 端 BLE 运行时权限的统一入口。
 *
 * **为什么 App 必须自己申请：** 小程序跑在微信宿主里，`BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` /
 * `ACCESS_FINE_LOCATION` 是**微信**持有的权限，小程序侧什么都不用做就能扫描；打包成独立 App 之后，
 * 这些权限归我们自己的 APK 所有，不申请就等于没授予。而 Android 12+ 在缺权限时
 * `openBluetoothAdapter` / `startBluetoothDevicesDiscovery` 既不报错也不走 fail 回调，
 * 只是永远返回空列表 —— 故障完全外显不出来，表现就是「扫描列表里什么都没有」。
 *
 * **所有**扫描/连接路径都必须先过这里。历史上只有 `rw/adapter.ts` 一家申请，而
 * 「未绑定设备时的首次扫描」走的是 legacy adapter（见 `composables/useRingBleSdk.ts`：
 * `if (!deviceInfo.value.deviceId) return startScanWithProtocol('legacy', input)`），
 * 于是 App 端第一次进「添加设备」永远搜不到戒指，而且因为申请代码在 rw 那边，
 * 连一句提示都不会弹 —— 症状与「扫描功能整个坏掉」完全一样。
 */

export const ANDROID_BLE_RUNTIME_PERMISSIONS = ['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT', 'android.permission.ACCESS_FINE_LOCATION'];

/** 部分机型（尤其已授权）回调可能不触发，超时放行，避免卡住连接流程 */
const ANDROID_PERMISSION_REQUEST_TIMEOUT_MS = 2000;

const DIAGNOSTIC_SOURCE = 'ANDROID BLE';

interface AndroidPermissionRequestResult {
  granted?: string[];
  deniedPresent?: string[];
  deniedAlways?: string[];
}

type PlusAndroid = {
  requestPermissions?: (permissions: string[], success?: (result?: AndroidPermissionRequestResult) => void, error?: () => void) => void;
  invoke?: (...args: any[]) => any;
  runtimeMainActivity?: () => any;
};

const getPlusAndroid = (): PlusAndroid | undefined => (globalThis as typeof globalThis & { plus?: { android?: PlusAndroid } }).plus?.android;

type AndroidLocationServiceState = 'unknown' | 'disabled' | 'enabled';

/**
 * `manifest.json` 的 `permissions` 里**不能**给 BLUETOOTH_SCAN 加
 * `android:usesPermissionFlags="neverForLocation"`：打包器会自动注入一条同名的普通声明，
 * 两份同名但属性不同的 `<uses-permission>` 合不进同一个生成文件，云打包会直接失败
 * （`duplicated with element declared at AndroidManifest.xml`）。
 *
 * 少了这个标记，Android 12+ 会把 BLE 扫描结果当作「可推导位置」，于是要求「已授予定位权限」
 * **且**「手机定位服务处于开启状态」，否则同样是「不报错、永远空列表」。
 * 定位权限的申请由本模块负责，这里只把「定位服务没开」这个剩下的隐形原因暴露出来。
 */
const inspectAndroidLocationService = (): AndroidLocationServiceState => {
  // #ifdef APP-PLUS
  try {
    const android = getPlusAndroid();
    const activity = android?.runtimeMainActivity?.();
    if (typeof android?.invoke === 'function' && activity) {
      const manager = android.invoke(activity, 'getSystemService', 'location');
      if (manager) {
        const enabled = android.invoke(manager, 'isLocationEnabled');
        // 拿不到布尔值一律按「未知」处理，避免误报吓人
        if (enabled === true) return 'enabled';
        if (enabled === false) return 'disabled';
      }
    }
  } catch {
    // 反射失败只意味着查不到状态，不能影响扫描
  }
  // #endif
  return 'unknown';
};

/**
 * 权限被拒时 Android 12+ 会静默返回空扫描结果，用户看到的只是「搜索不到设备」，
 * 完全看不出原因；所以拒绝必须提示出来，否则故障不可见。
 *
 * @returns 权限是否齐全
 */
const reportAndroidBlePermissionResult = (result?: AndroidPermissionRequestResult): boolean => {
  if (!result) return false;
  const granted = Array.isArray(result.granted) ? result.granted : [];
  const missing = ANDROID_BLE_RUNTIME_PERMISSIONS.filter((item) => !granted.includes(item));
  if (!missing.length) {
    appendRingDiagnosticLog(DIAGNOSTIC_SOURCE, 'android-ble-permission-granted', { granted });
    const locationState = inspectAndroidLocationService();
    appendRingDiagnosticLog(DIAGNOSTIC_SOURCE, 'android-location-service-state', { state: locationState });
    if (locationState === 'disabled') {
      uni.showToast({ title: '请打开手机定位服务，否则搜不到设备', icon: 'none', duration: 3000 });
    }
    return true;
  }
  const deniedAlways = Array.isArray(result.deniedAlways) ? result.deniedAlways : [];
  appendRingDiagnosticLog(DIAGNOSTIC_SOURCE, 'android-ble-permission-denied', { missing, deniedAlways });
  uni.showToast({
    title: deniedAlways.length ? '蓝牙权限已被永久拒绝，请在系统设置中开启后重试' : '需要蓝牙权限才能搜索设备，请允许后重试',
    icon: 'none',
    duration: 3000
  });
  return false;
};

/** 申请 Android BLE 运行时权限。非 App 平台（含小程序）直接放行。 */
export const ensureAndroidBleRuntimePermissions = (): Promise<void> => {
  // #ifdef APP-PLUS
  let platform = '';
  try {
    platform = uni.getSystemInfoSync().platform;
  } catch {
    // 无法确认平台时放行，交给 openBluetoothAdapter 报错
  }
  if (platform === 'android') {
    const requestPermissions = getPlusAndroid()?.requestPermissions;
    if (typeof requestPermissions === 'function') {
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        // 授权回调可能晚于超时触发，因此提示与日志不参与 settled 判定。
        const handleResult = (result?: AndroidPermissionRequestResult) => {
          reportAndroidBlePermissionResult(result);
          finish();
        };
        try {
          requestPermissions(ANDROID_BLE_RUNTIME_PERMISSIONS, handleResult, () => handleResult());
        } catch {
          finish();
        }
        setTimeout(finish, ANDROID_PERMISSION_REQUEST_TIMEOUT_MS);
      });
    }
  }
  // #endif
  return Promise.resolve();
};
