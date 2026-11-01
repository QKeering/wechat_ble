import { t } from '@/i18n';

const buildRingConnectionTroubleshootingUrl = () => `/pagesA/mines/detail?local=ring-connect-failed&title=${encodeURIComponent(t('连接不上戒指'))}`;

let promptVisible = false;

export const openRingConnectionTroubleshooting = () => {
  return new Promise<boolean>((resolve) => {
    uni.navigateTo({
      url: buildRingConnectionTroubleshootingUrl(),
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
};

/**
 * 用户主动连接戒指失败时提供排查入口。
 * 传入 reason 时把具体失败原因带进弹窗，避免用户只看到"连接不上"却不知道是
 * 戒指被其他设备占用、账号冲突还是距离问题。
 * 取消只关闭弹窗，不改变当前页面和连接状态。
 */
export const showRingConnectionTroubleshootingPrompt = (reason?: string) => {
  return new Promise<boolean>((resolve) => {
    if (promptVisible) {
      resolve(false);
      return;
    }

    promptVisible = true;
    const reasonText = String(reason || '')
      .trim()
      .replace(/[。.!！]+$/, '');
    // 连接恢复流程内部可能还留有 loading，真机上会把 showModal 覆盖。
    // 先关闭 loading，再让出一个 UI tick 展示可操作弹窗。
    uni.hideLoading();
    setTimeout(() => {
      uni.showModal({
        title: t('戒指连接不上？'),
        content: reasonText ? t('{reason}。是否查看连接不上戒指的原因排查与自检方法？', { reason: reasonText }) : t('暂时未能连接戒指，是否查看连接不上戒指的原因排查与自检方法？'),
        confirmText: t('查看原因'),
        cancelText: t('取消'),
        success: (result) => {
          if (!result.confirm) {
            resolve(false);
            return;
          }
          // iOS/Harmony 上等原生 modal 完全收起后再跳转，避免 navigateTo 被吞掉。
          setTimeout(() => {
            void openRingConnectionTroubleshooting().then(resolve);
          }, 80);
        },
        fail: () => resolve(false),
        complete: () => {
          promptVisible = false;
        }
      });
    }, 80);
  });
};
