# QwenCloud CLI

<p>
  <img src="./assets/QwenCloudLogo.svg" alt="QwenCloud" width="220" />
</p>

> [QwenCloud](https://www.qwencloud.com/) 官方命令行工具。用于在终端或 AI Agent 运行环境中发现模型、查询用量、管理认证并诊断本地配置。

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-Apache--2.0-green)

[English](./README.md) · **中文**

QwenCloud 是面向模型、工具和应用的 AI-native cloud，提供文本、视觉、语音、图像生成、视频生成、结构化输出和 Agent 应用相关能力。更多产品信息见 [qwencloud.com](https://www.qwencloud.com/) 和 [docs.qwencloud.com](https://docs.qwencloud.com/)。

![QwenCloud CLI REPL 欢迎界面](./assets/QwenCloudCLI.png)

---

## 功能

- **交互式与一次性模式**：不带参数运行 `qwencloud` 进入 REPL；传入命令则执行一次性操作，适用于脚本、CI 和 Agent 工具。
- **Agent 友好契约**：命令支持 `--format json`、标准化退出码、可解析的 JSON 错误，以及 `--quiet` 仅返回退出码。
- **模型与用量工作流**：浏览模型、查看模型元数据、按关键词搜索，并查阅 Free Tier、Coding Plan 和 PAYG 用量。
- **原生凭证存储**：凭证优先存储于操作系统密钥链，不可用时回退到加密文件。无需 `keytar` 或原生 Node 绑定。
- **自文档化命令树**：所有命令均支持 `--help`；生成的帮助信息即为权威语法参考。

---

## 安装

请选择适合当前环境的安装方式，支持 npm 和源码构建。

### npm

```bash
npm install -g @qwencloud/qwencloud-cli
```

### 从源码构建

```bash
git clone https://github.com/QwenCloud/qwencloud-cli.git
cd qwencloud-cli
pnpm install
pnpm run build
pnpm link --global
```

验证安装：

```bash
qwencloud version
```

---

## 快速开始

### 开发者

```bash
# 1. 使用 OAuth Device Flow 登录
qwencloud auth login

# 2. 列出可用模型
qwencloud models list

# 3. 查看模型详情
qwencloud models info qwen3-coder-plus

# 4. 查看当前用量
qwencloud usage summary

# 5. 检查认证、网络、配置及本地环境
qwencloud doctor
```

不带参数运行 `qwencloud` 将进入 REPL。REPL 使用与一次性模式相同的命令树，并额外支持 readline 历史记录、Tab 补全和富文本终端表格。

### AI Agent

使用一次性命令并显式请求 JSON 输出：

```bash
qwencloud auth status --format json
qwencloud models list --all --format json
qwencloud usage summary --period month --format json
qwencloud doctor --format json
```

推荐的 Agent 启动流程：

```bash
# 1. 检查凭证是否可用
qwencloud auth status --format json

# 2. 若认证缺失或过期，初始化非交互式登录
qwencloud auth login --init-only --format json

# 3. 引导用户打开返回的验证 URL，随后完成轮询
qwencloud auth login --complete --format json
```

更完整的 Agent 集成请参考 [QwenCloud/qwencloud-ai](https://github.com/QwenCloud/qwencloud-ai)。

---

## 示例

在终端中浏览可用模型，并查看模型模态、免费额度和价格信息：

![QwenCloud CLI 模型列表](./assets/models_list.png)

一条命令查看 Free Tier、Coding Plan 和 PAYG 的用量汇总：

![QwenCloud CLI 用量汇总](./assets/usage_summary.png)

需要选择仍有试用额度的模型时，可以进一步查看 Free Tier 配额状态：

![QwenCloud CLI Free Tier 用量](./assets/usage_freetier.png)

运行诊断命令，检查认证、网络、配置和 Shell 补全状态：

![QwenCloud CLI doctor 诊断](./assets/doctor.png)

---

## 命令

| 领域 | 命令 | 常用标志 |
|---|---|---|
| 认证 | `auth login`, `auth logout`, `auth status` | `--init-only`, `--complete`, `--timeout`, `--format` |
| 模型 | `models list`, `models info`, `models search` | `--input`, `--output`, `--all`, `--verbose`, `--page`, `--per-page`, `--format` |
| 用量 | `usage summary`, `usage breakdown`, `usage free-tier`, `usage payg` | `--period`, `--from`, `--to`, `--days`, `--model`, `--granularity`, `--format` |
| 配置 | `config list`, `config get`, `config set`, `config unset` | `--format` |
| 诊断 | `doctor` | `--format` |
| Shell | `completion install`, `completion generate` | `--shell` |
| 版本 | `version` | `--check` |

使用 help 查看精确语法：

```bash
qwencloud --help
qwencloud models --help
qwencloud usage breakdown --help
```

---

## 输出与退出码

输出格式解析优先级：

1. `--format` 标志
2. 配置中的 `output.format`
3. TTY 检测：交互终端使用表格，管道或重定向时使用 JSON

```bash
qwencloud models list
qwencloud models list --format json
qwencloud models list --format text
qwencloud --quiet doctor
```

退出码：

| 代码 | 含义 |
|---:|---|
| `0` | 成功 |
| `1` | 一般错误或用法错误 |
| `2` | 认证错误 |
| `3` | 网络错误 |
| `4` | 配置错误 |
| `130` | 中断 |

JSON 错误遵循固定结构：

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Not authenticated. Run `qwencloud auth login` first.",
    "exit_code": 2
  }
}
```

自动化场景建议使用 `--format json`，表格输出仅供人工阅读。

JSON 输出示例：

```json
{
  "models": [
    {
      "id": "qwen3-coder-plus",
      "modality": { "input": ["text"], "output": ["text"] },
      "pricing": { "tiers": [{ "input": 0.5, "output": 2.0, "unit": "USD/1M tokens" }] }
    }
  ],
  "pagination": { "page": 1, "per_page": 20, "total": 1 }
}
```

---

## 认证

`qwencloud auth login` 采用 OAuth 2.0 Device Authorization Grant + PKCE。

交互式登录：

```bash
qwencloud auth login
```

非交互式登录：

```bash
qwencloud auth login --init-only --format json
qwencloud auth login --complete --format json
```

凭证会优先写入系统密钥链。密钥链不可用时，CLI 会回退到加密的本地凭证文件。设置 `QWENCLOUD_KEYRING=plaintext` 可在调试时强制使用明文本地文件；`no`、`0`、`false`、`off` 也会跳过密钥链。

---

## 配置

QwenCloud CLI 使用一个全局配置文件：

```text
~/.qwencloud/config.json
```

公开配置项：

| 键 | 可选值 | 默认值 |
|---|---|---|
| `output.format` | `auto`, `table`, `json`, `text` | `auto` |

```bash
qwencloud config set output.format json
qwencloud config get output.format
qwencloud config list
qwencloud config unset output.format
```

---

## 贡献

欢迎提交 bug 修复、文档改进和功能建议。

1. 从最新的 `master` 开始。
2. 创建聚焦的分支，例如 `fix/auth-token-expiry` 或 `doc/install-options`。
3. 使用 `pnpm install` 安装依赖。
4. 完成改动；如果行为发生变化，请新增或更新测试。
5. 提交 PR 前运行相关检查：

```bash
pnpm run lint
pnpm run format:check
pnpm test
pnpm run build
```

6. 使用 [Conventional Commits](https://www.conventionalcommits.org/) 提交，例如 `feat:`、`fix:`、`doc:`、`refactor:`、`chore:`。
7. 推送分支，并向 `master` 发起 Pull Request。
8. 填写 PR 模板，关联相关 issue，说明用户可见变化；涉及 CLI 体验的改动请附上截图或终端输出。

面向产品行为的变更应同步更新文档，并需要产品与工程评审。

---

## 许可证

本项目采用 [Apache-2.0 许可证](LICENSE)。
