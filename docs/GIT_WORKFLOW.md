# Git 多人协作规范

## 基本原则

- `master` 仅用于保存已确认、可合并的稳定代码。
- 禁止直接在 `master` 上开发或直接推送业务修改。
- 每项需求使用独立分支，修改完成后提交并推送分支，由负责人审核、合并。
- 已修复的业务代码不得在无明确需求和验证依据的情况下重复改写。

## 开始开发

```bash
git switch master
git pull --ff-only origin master
git switch -c feature/简短功能名称
```

分支命名建议：

- 新功能：`feature/功能名称`
- 缺陷修复：`fix/问题名称`
- 紧急修复：`hotfix/问题名称`
- 文档：`docs/文档名称`

## 开发过程中

提交前确认改动范围：

```bash
git status
git diff
```

不要提交以下内容：

- 本地密钥、Token、真实密码
- `.env` 等本地环境文件（示例文件 `.env.example` 除外）
- `node_modules`、构建缓存和临时日志
- 与当前需求无关的格式化或批量重写

提交信息建议使用：

```text
feat: 新增功能
fix: 修复问题
refactor: 重构但不改变业务行为
docs: 更新文档
chore: 构建或工程调整
```

## 提交并推送

```bash
git add <本次修改文件>
git commit -m "fix: 简要说明本次修改"
git push -u origin 当前分支名
```

## 合并前同步主分支

```bash
git fetch origin
git rebase origin/master
```

如有冲突，应逐文件确认业务含义后解决，禁止用整文件覆盖的方式跳过冲突判断。解决后重新执行相关构建和测试，再推送：

```bash
git push --force-with-lease
```

仅允许在个人功能分支使用 `--force-with-lease`，禁止强推 `master`。

## 合并与后续清理

负责人审核并合并功能分支。合并完成后，开发者再执行：

```bash
git switch master
git pull --ff-only origin master
git branch -d 已合并分支名
```
