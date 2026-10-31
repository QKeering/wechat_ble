import { t } from '@/i18n';

const buildRingConnectionTroubleshootingUrl = () =>
  `/pagesA/mines/detail?local=ring-connect-failed&title=${encodeURIComponent(t('连接不上戒指'))}`;

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
 * 取消只关闭弹窗，不改变当前页面和连接状态。
 */
export const showRingConnectionTroubleshootingPrompt = () => {
  return new Promise<boolean>((resolve) => {
    if (promptVisible) {
      resolve(false);
      return;
    }

    promptVisible = true;
    // 连接恢复流程内部可能还留有 loading，真机上会把 showModal 覆盖。
    // 先关闭 loading，再让出一个 UI tick 展示可操作弹窗。
    uni.hideLoading();
    setTimeout(() => {
      uni.showModal({
        title: t('戒指连接不上？'),
        content: t('暂时未能连接戒指，是否查看连接不上戒指的原因排查与自检方法？'),
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
