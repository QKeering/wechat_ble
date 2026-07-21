// FQA及用户指南项的类型
export type FqaGuidItem = {
  id: number; // integer(int64)
  type: number; // integer (类型:FAQ=1,用户指南=2)
  title: string; // 标题
  content?: string; // 内容
  delFlag?: string; // 删除标志 (0代表存在 1代表删除)
  createTime?: string; // 创建时间
  updateTime?: string; // 更新时间
  delFlagstr?: string; //delFlag的字符串表示
};
