# Git 工作流与安全生产规范

> 本文件是当前项目的 Git / GitHub 流程单一事实来源。
> 如果它与其他文档冲突，以本文件为准。

## 1. 目标

让 Agent 在当前项目中安全地处理：

- 本地分支与工作区
- 远端同步
- 提交、推送、开 PR
- 发布与 Release PR
- ignore / secret / 覆盖风险

## 2. 默认原则

- 默认在 `main` 上直接提交与推送：**不建分支**。需要分支提交或发布流程时，由用户显式提出。
- 保护分支规则（`Block force pushes` / `Restrict deletions` 等）始终生效。它约束的是历史重写与删除分支，**不是**普通提交——两者不冲突。
- `main` / `master` 的历史仍然不可重写：任何 force push 都在 §8 红线之内。
- 所有提交必须小粒度、可回滚。
- 任何会覆盖、丢失、重写历史的操作都要先停下并说明风险。
- 先看状态，再动 Git。

## 3. Git 卫生检查点（提交与推送共用）

只要任务碰到 Git / GitHub / 远端仓库 / release，先按顺序过一遍这个检查点：

1. `git branch --show-current`
2. `git status --short`
3. `git diff --stat`
4. `git remote get-url origin`；仅成功时执行 `git fetch origin`
5. 检查当前分支与远端关系；无远端的新仓库跳过同步

然后再决定：

- 只做本地提交
- 提交后推送
- 暂停并问用户
- 只做只读调查（不改任何 ref）

**默认不会出现**「建分支」与「开 PR」：这两项只在用户显式提出时才进入候选。

## 4. 分支策略（默认不建分支）

**默认不建分支。** 直接在 `main` 上提交与推送，这是本仓库的常规回路。

分支（`feat/*`、`fix/*`、`refactor/*`、`chore/*`、`docs/*`、`test/*`）不在默认流程里，只在以下情况由用户显式提出后创建：

- 需要走 PR 评审；
- 需要发布流程；
- 改动风险高，希望先在隔离分支验证。

用户提出分支后，§5 的暂存与提交规则不变。任何时刻都不要为了「更安全」而擅自开分支——那会和用户的默认预期相反。

## 5. 暂存与提交

- 优先使用 `git add <specific-file>`。
- 不默认使用 `git add .` 或 `git add -A`。
- 新脚手架首次提交必须显式暂存生成文件与 `pnpm-lock.yaml`。
- 提交前运行 `git check-ignore -v node_modules dist`、`git diff --cached --check` 与 `git diff --cached --stat`。
- Git identity 缺失时保留 staged 状态并报告；禁止修改 global identity。
- 提交信息用 Conventional Commits：`<type>(<scope>): <subject>`。
- 禁止空泛提交名：`update`、`wip`、`fix bug`。
- 提交前先展示 `git status` 和 `git diff` 摘要给用户。

## 6. 远端同步

- 存在 `origin` 时先 `git fetch origin`；无远端时跳过。
- 如果本地落后，优先 `git pull --rebase`。
- 如果有未提交改动，先停，不直接拉取覆盖。
- 如果分叉或冲突，先说明，不猜测，不 force。

## 7. PR 与发布（默认不走）

- 默认不做 PR、不发布。这两件事只在用户显式提出时进入流程。
- 一旦要走：分支推送后再开 PR。
- PR 标题尽量沿用 Conventional Commits 风格。
- PR 描述至少说明：目的、改了什么、怎么验证。
- 发布优先走项目约定的发布流程。
- 如果项目约定 `release-please`，Release PR 由人类手动合并。
- Agent 不代做最终 merge。

## 8. 安全红线

绝对禁止，除非用户明确要求并确认后再执行：

- `git push --force`
- `git push -f`
- `git push --force-with-lease`
- `git reset --hard`
- `git checkout .`
- `git restore .`
- `git clean -fd`
- `git commit --amend`（尤其是已 push 后）
- `gh pr merge`
- `--no-verify`
- 修改 GitHub ruleset / branch protection / 仓库 settings

## 9. 密钥与 ignore

- `.env`、`.env.*`、`*.pem`、`*.key`、`secrets/`、`node_modules/`、`dist/`、`.next/`、`coverage/`、`__pycache__/` 必须被忽略。
- 如果发现该忽略却已被跟踪的文件，先停，再处理。
- 不要把 Token、密钥、完整用户数据写进代码、日志、示例或文档。

## 10. 项目阶段

- 具体项目阶段、ruleset、release 细则，放在该项目的 `docs/GITHUB-GUARD.md`。
- 这份文件只定义通用工作流，不定义某个项目的阶段编号或发布状态。

## 11. 用户最常见动作

### 11.1 默认回路（不设分支）

这是本仓库的常规路径，不需要任何额外授权，也不需要建分支或开 PR：

```bash
git status --short && git diff --stat      # 1. 先看（§3 第 1–3 步）
git add <specific-file> …                  # 2. 精确暂存，不用 git add .
git diff --cached --check                  # 3. 空白 / 冲突标记
git diff --cached --stat                   # 4. 暂存面确认
git commit -F- <<'MSG'                     # 5. 约定式提交
…
MSG
git push                                   # 6. 提交后推送
```

完整检查点见 §3；分支与 PR 只在用户显式提出时进入流程。

### 11.2 需要同步远端

1. `git fetch origin`
2. 检查是否有本地未提交改动
3. 如果只是落后，`git pull --rebase`
4. 如果冲突，先停

### 11.3 需要发布

1. 看项目发布流程
2. 先开 Release PR 或按项目约定处理
3. 人类手动合并

## 12. 说明

- 具体项目级阶段、ruleset、release 细则，放在该项目的 `docs/GITHUB-GUARD.md`。
- 旧的 Git 说明文档只保留短指针，不再重复写完整规则。
