const share = {
  // 分享到好友
  onShareAppMessage() {
    return {
      path: `pages/awareness/awareness`
    };
  },
  // 分享到朋友圈
  onShareTimeline() {
    return {
      path: `pages/awareness/awareness`
    };
  }
};

export default share;
