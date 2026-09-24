# AGENTS.md — xpi-session-naming

> 本文件是本仓库内 AI Agent 与人类开发者的**唯一事实来源 (Single Source of Truth)**。
> 所有变更必须可解释、可回滚。当口头约定、历史代码与本文件冲突时,**以本文件为准**。

<!-- TODO: 定义本扩展职责边界(这个扩展做什么、不做什么) -->

## 0. TL;DR(Agent 执行守则)

- 每次对话在头部声明"[@PRJ-AGENTS.md]"
- 本仓库是一个 **Pi Coding Agent 扩展 (pi-extension)**,即被 Pi 主进程加载的 Node.js 插件。**不是 Web 应用**。
- **核心栈**:TypeScript (strict) + Node.js + Pi 原生 UI(`ctx.ui.*` / `@earendil-works/pi-tui`)+ Biome + pnpm + Vitest + typebox。
- **无构建步骤**:Pi 直接加载 `src/index.ts` TypeScript 源码。禁止引入 tsup/esbuild/dist 产物。
- **类型真相**:Pi 的 API 签名以 `node_modules/@earendil-works/*` 的 `.d.ts` 为准。**动手前先读类型,不凭记忆猜 API**。
- 任何代码修改后,必须分别保证 `pnpm typecheck`、`pnpm -w run lint`、`pnpm test` 全部通过,否则视为未完成。

## 1. 运行时契约

1. 入口 `src/index.ts` 默认导出 register 函数:`export default function (pi: ExtensionAPI): void`。
2. `package.json` 的 pi manifest 指向 TS 源码:`{ "pi": { "extensions": ["./src/index.ts"] } }`。
3. Pi API 与 typebox 声明为 **peerDependencies(optional)**,版本锁在 devDependencies。
4. 扩展运行在 Pi 主进程内,终端归 Pi TUI 所有。交互一律用 `ctx.ui.*`,禁止 ink/inquirer 等抢终端的库。
5. 尊重 Project Trust:项目级配置(`<cwd>/.pi/*.json`)仅在项目被信任时生效。

## 2. 技术栈

Node.js + pnpm(版本见 `mise.toml`)、TypeScript strict、Biome(lint+format)、Vitest、typebox。
**实装版本以 pnpm-lock.yaml 为准**,不在本文件硬写大版本号。

## 3. 目录结构

```
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md / README.md / README.zh-CN.md
└── src/
    └── index.ts           # 扩展入口(register);领域目录(tools/ commands/ lib/ 等)由项目按需增设
```

`skills/`、`prompts/` 等资源目录在**有真实内容时**再加入 pi manifest,不预建空目录。

## 4. 编码与 API 约定

- **Tools**:每个 Tool 用 typebox 声明输入 Schema;只读与变更工具严格分离;输出必须有界(大输出先截断/摘要)。
- **Hooks**:生命周期事件以安装版本类型为准;钩子内不做重活,重活放异步任务或子进程。
- **Prompt Hygiene**:永不修改 Pi 的 system prompt;注入指令用对话消息追加,精简、可移除,空闲不注入。
- **配置与密钥**:配置解析 fail-closed;Token/API Key 绝不写入代码、日志、示例或文档,仅经环境变量或 `chmod 0600` 文件存储,日志一律脱敏。

- **视觉与 TUI 规范**：所有涉及终端渲染、状态栏、通知与字符排版的改动，必须严格遵循根目录 `DESIGN.md` 中的 Token 与 8 大章节规范。
- **子进程与 stderr 纪律**:宿主终端的所有权是排他的。任何 `spawn` 的第三方或原生子进程,其 stderr 必须 `ignore` 或重定向到日志文件,**永不 `inherit`**;扩展自身禁用 `console.*`、`process.stderr.write`、`process.emitWarning` 写终端,诊断信息落日志文件。
- **第三方 UI 依赖审计**:引入带原生窗口/浏览器的依赖(如 Glimpse)时,先 `grep -rnE "stdio|console\.|process\.stderr|emitWarning" node_modules/<pkg>/src/`,出现 `inherit` 即为缺陷候选;再动态冒烟 `<driver> 2>/tmp/host-stderr.log`,要求 `wc -c /tmp/host-stderr.log` 为 `0`。为每个此类依赖留一条「宿主 stderr 零字节」契约测试,并同时断言未规避时的对照组,否则回归不可见。TUI 独占终端时,这类输出延迟到面板关闭后才浮现,直接覆盖用户编辑器。

## 5. 命令与开发回路

```bash
pnpm typecheck        # tsc --noEmit
pnpm -w run lint      # workspace root: biome check .
pnpm test             # vitest run
```

- 提交前三条全绿。
- 若 lint 输出意外出现 ESLint,先确认 `scripts.lint` 仍为 `biome check .`,再运行 `pnpm exec biome check .` 诊断;禁止安装 ESLint。
- **冒烟**:`pi -e ./src/index.ts`(quick test,不支持热载)。

## 6. Git 与回滚纪律
- 只要任务碰到 git / GitHub / 远端仓库 / release，先读 `docs/GIT-WORKFLOW.md`，再读 `docs/GITHUB-GUARD.md`。
- 默认不设分支, 以git安全流程提交检查点.
