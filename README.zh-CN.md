# xpi-session-naming

[English](./README.md) · **简体中文**

**一个在首轮有效对话结束后自动给 Pi 会话命名的扩展**, 让会话列表显示主题而不是时间戳。

**A Pi Coding Agent extension that names each session after the topic of its first real exchange**, so the session list stays readable instead of filling up with timestamps.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

```text
> /xpi-session-naming
```

## 为什么

新开的会话没有名字, 一天工作下来列表里全是无法区分的条目, 一小时前聊过什么根本找不到。本扩展在首轮有效对话结束的那一刻给会话命名 —— 例如 `[deepseek-v4.1-flash] - 订阅页埋点梳理` —— 然后就退场。它监听 `agent_settled` 事件, 判断这一轮是否值得命名, 用一次隔离的补全生成主题(默认模型 `mimo-v2.6-flash`, 可经 `/xpi-session-naming models` 更换), 校验后再写入, 且只写一次。手动重命名永远优先, 失败绝不打扰对话, 会话当前使用的模型也从不被触碰。

本仓库里的每个扩展都从同样四条规则出发:

- **没有构建步骤。** Pi 直接加载 `./src/index.ts`,没有 `dist/`、没有打包器、不提交编译产物。
- **Pi 原生 UI。** 渲染走 `ctx.ui.*` 与 `@earendil-works/pi-tui`,绝不劫持终端,也不引入竞争性的终端框架。
- **没有重度运行时依赖。** 只用宿主提供的 API 加严格类型;工具 Schema 用 `typebox`,其余依赖都要先证明自己值得。
- **门禁严格,没有例外。** TypeScript strict、Biome、Vitest 三条全绿才能提交。

它也不越界:扩展是被 Pi 主进程加载的插件,不是独立服务。确实需要进程边界时,先写一份 ADR 说明理由,再动手。

## 技术栈

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/),版本锁定在 [`mise.toml`](./mise.toml)
- [Pi Coding Agent](https://github.com/earendil-works/pi) —— 宿主本体、扩展 API 与 `@earendil-works/pi-tui`
- TypeScript strict(`target: ES2024`,`module: NodeNext`)
- [Biome](https://biomejs.dev/) 负责 lint 与格式化
- [Vitest](https://vitest.dev/) 作为测试运行器

## 安装

前置条件:一个可用的 Pi 安装。本包直接从源码加载,安装前不需要任何构建。

```bash
pi install git:github.com/<owner>/xpi-session-naming@<ref>
```

| 安装位置 | 命令 |
| --- | --- |
| 全局(用户设置) | `pi install git:github.com/<owner>/xpi-session-naming@<ref>` |
| 仅当前项目(`.pi/settings.json`) | `pi install -l git:github.com/<owner>/xpi-session-naming@<ref>` |

`pi install` 写入 `~/.pi/agent/settings.json`;加 `-l` 写入项目设置,项目被信任后 Pi 会自动安装。固定的 git ref 不会被 `pi update` 移动。

```bash
pi list                              # 已安装的包
pi update --extensions               # 更新包并校对固定的 ref
pi remove git:github.com/<owner>/xpi-session-naming
```

包级调试刻意只走 npm / git 远程源:本地路径安装只是在 settings 里留一条指向工作目录的引用,一旦忘记 `pi remove`,残留的脏路径就会和正式安装双份并存。

## 用法

| 命令 | 说明 |
| --- | --- |
| `/xpi-session-naming` | 显示扩展状态与已加载的版本 |
| `/xpi-session-naming models` | 选择给会话命名的模型, 列表与 `/model-name` 一致 |
| `/xpi-session-naming-model` | `/xpi-session-naming models` 的别名 |

### 会话如何被命名

- **触发时机** —— 每个完成的用户回合(`agent_settled`)。首轮即是有意义的请求(超过 10 个码点, 排除斜杠命令)则立即命名; 首轮无意义(`hello`、`/command`)则等待第二个完成的回合。
- **命名格式** —— `[<主模型 id>] - <主题>`。模型 id 前的 provider 前缀被去掉; 主题是校验过的单行简体中文短语(要求 ≤ 20 字, 接受 ≤ 30 字)。
- **主题模型** —— 在 `/xpi-session-naming models` 选定的模型上做一次有界补全, 默认 `mimo-v2.6-flash`(优先 provider `MIMO`, 其次是任何配置了同一模型 id 的 provider), 15 秒超时, 只携带前两条用户消息(各 500 码点)。已保存的选择仅在其 provider 仍存在且已配置认证时生效; 否则回退默认链路。没有可用的主题模型时, 会话保持未命名。
- **护栏** —— 已有名字绝不覆盖(模型调用前后各检查一次), 同一时刻只允许一次尝试; 主题模型经 `ctx.modelRegistry.streamSimple()` 调用, 生成名字既不会切换对话模型, 也不会改动设置。
- **失败边界** —— 所有失败以数据形式返回, 只用一条不含提示词与主题文本的 `ctx.ui.notify` 警告上报; 意外异常被吞掉。命名从不阻断、也从不改写对话。

读取: 当前分支的消息条目与会话名。写入: 会话名, 且仅在原本没有名字时写入。

### 配置

`/xpi-session-naming models` 写入 `<agent-dir>/xpi-session-naming.json`(默认 `~/.pi/agent/xpi-session-naming.json`):

```json
{ "topicModel": { "provider": "MIMO", "id": "mimo-v2.6-flash" } }
```

文件缺失、不可读或格式错误都视为「没有选择」, 命名回退默认链路。文件里只有 provider / 模型 id 的引用, 永远不落任何凭据。配置每回合重读, 因此选完模型下一回合即生效, 无需 `/reload`。

## 开发

```bash
mise install                         # 安装锁定版本的 Node.js 与 pnpm
pnpm install
```

| 门禁 | 命令 |
| --- | --- |
| 类型 | `pnpm typecheck` —— `tsc --noEmit` |
| Lint 与格式 | `pnpm -w run lint` —— Biome 全仓检查 |
| 测试 | `pnpm test` —— Vitest(`vitest run --passWithNoTests`) |

提交前三条必须全绿。Lint 请在 workspace root 显式运行 `pnpm -w run lint`;包装层偶发会把裸写的 `pnpm run lint` 误判为未知递归命令。

开发期运行扩展有两种方式:

```bash
pi -e ./src/index.ts                 # 冒烟:只加载一次,仅本次运行,不写配置
```

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-session-naming   # 日常回路:在 Pi 内用 /reload 热载
```

`pi -e` 不写任何设置;软链由扩展目录自动发现,`rm` 掉软链即干净。

## 目录结构

```text
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md
├── docs/                      # Git 工作流与仓库约束
└── src/
    ├── index.ts               # 扩展入口(register 函数、`agent_settled` 钩子)
    ├── naming-run.ts          # 每次运行一次命名尝试: 护栏与结果
    ├── naming-eligibility.ts  # 回合分类与命名判定
    ├── session-name.ts        # `[model-id] - 主题` 组合
    ├── topic-model.ts         # 经 `ctx.modelRegistry` 的隔离主题补全
    ├── topic-model-config.ts  # `<agent-dir>/xpi-session-naming.json` 读写
    ├── topic-text.ts          # 提示词构建与主题校验
    ├── ui/                    # `ctx.ui` 组件(选择器在 `model-picker.ts`)
    └── *.test.ts              # 各模块的 Vitest 覆盖
```

## 设计规范

本项目遵循 [Google Labs DESIGN.md 规范](https://github.com/google-labs-code/design.md),并专门为终端 TUI 场景定制。详见 [`DESIGN.md`](./DESIGN.md) 查看设计 Token(颜色、等宽字阶、间距网格与组件定义)。

## 约定与约束

- **术语表**:[`CONTEXT.md`](./CONTEXT.md) 定义了本仓库的统一语言,代码、文档与提交中禁止术语漂移。
- **Token 安全**:密钥与 Token 绝不写入代码、日志、示例或文档。
- **Git 纪律**:提交或推送前先读 [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) 与 [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md)。默认不建功能分支:直接在 `main` 上以小粒度 Conventional Commits 提交;禁止强推与重写历史。
- **Agent 契约**:[`AGENTS.md`](./AGENTS.md) 是本仓库的唯一事实来源。口头约定、历史代码或本 README 与它冲突时,以 `AGENTS.md` 为准。

## 致谢

- [Pi Coding Agent](https://github.com/earendil-works/pi) —— 由 [earendil-works](https://github.com/earendil-works) 开发。本扩展寄宿其中:扩展 API、`ctx.ui` 契约和包清单规范都来自该项目。

## 许可

MIT
