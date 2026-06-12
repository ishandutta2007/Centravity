<div align="center">
  <br />
  <img src=".github/assets/google-anticentravity-logo.svg" width="200" />
  <br />
  <h1>Open-Anticentravity</h1>

  [下载](https://anticentravity.google)
  <p><b>用于代理开发的开源通用 AI 网关</b></p>
  <p>
    <i>一个开放的、社区驱动的努力，旨在为专有的代理编码平台构建一个真正的模型无关的替代方案。</i>
  </p>
  
  <p>
    <a href="#"><img alt="构建状态" src="https://img.shields.io/badge/build-passing-brightgreen?style=for-the-badge"></a>
    <a href="#"><img alt="许可证" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
    <a href="#"><img alt="欢迎贡献" src="https://img.shields.io/badge/contributions-welcome-orange?style=for-the-badge"></a>
    <a href="#"><img alt="Discord" src="https://img.shields.io/discord/123456789?label=discord&style=for-the-badge&logo=discord"></a>
  </p>
</div>

---

**Open-Anticentravity** 不仅仅是另一个代码编辑器或 AI 助手。它是一个雄心勃勃的开源项目，旨在构建一个 Web 原生的、**代理优先**的集成开发环境 (IDE)。与将您锁定在单个 AI 生态系统中的专有平台不同，Open-Anticentravity 从头开始设计，旨在成为**任何 LLM 的通用网关**。我们的目标是创建一个平台，让开发人员可以将复杂的任务委托给自主的 AI 代理，并由他们选择的模型提供支持。

如果您相信以下几点，那么这个项目就适合您：
- **真正的模型自由：** 构建一个不依赖于单个 AI 提供商的未来。
- **AI 民主化：** 让最先进的代理开发对每个人都可用。
- **透明度和可扩展性：** 创建一个社区可以塑造、扩展和信任的开放核心。
- **自托管和隐私：** 让您完全控制您的代码、数据和 AI 连接。

## ✨ 核心功能 (愿景)

我们的目标是构建一个重新定义开发人员生产力的平台。以下是我们正在努力实现的关键功能：

- **🌌 集各家之长：** 旨在将 Claude Desktop、Cursor、Windsurf、Kiro、Trae、Trae CN、Qoder 和 Anticentravity 的最佳功能融合到一个单一、内聚的体验中。

- **✨ 谷歌尖端技术：** 融合了 **Google CodeMender** 强大的代码修复能力和 **Google Jules** 的先进推理能力，提供最先进的代码生成、调试和理解。

- **🔒 隐私第一：** 不会将任何代码信息、环境信息、操作系统信息或用户信息或使用模式发送给谷歌。

- **🔌 通用 LLM 网关：**
  摆脱供应商锁定。Open-Anticentravity 被设计为大型语言模型的通用转换层。可以连接从 OpenAI 的 GPT-5、Anthropic 的 Claude 和 Google 的 Gemini 到 Llama、Grok 和 Qwen 等开放模型，或 Deepseek 和 Kimi 等专用 API 的任何东西。统一的界面意味着您的代理和工具可以在所有这些模型上无缝工作。

- **🤖 代理优先的工作流程：**
  将“为用户身份验证实现新的 API 端点”或“重构数据库模式并更新所有相关服务”等高级任务委托给由您选择的 LLM 提供支持的 AI 代理。

- **🧠 多代理协作：**
  生成可以并行工作或协作完成单个目标的多个代理。例如，一个代理编写代码，第二个代理编写测试，第三个代理在浏览器中验证更改。

- **🌐 双视图界面：**
  - **编辑器视图：** 一个功能丰富、AI 增强的 IDE，基于 **VS Code (VSCodium)**，适合您想要亲自动手的时候。
  - **管理器视图：** 一个专门的界面，用于在您的代码库的不同部分生成、编排、监控和管理您的 AI 代理舰队。

- **✅ 通过可验证的工件建立信任：**
  为了建立对自主工作的信任，代理不仅仅生成日志。它们生成有形的**工件**：
  - **任务列表和计划：** 在代理开始之前审查其计划。
  - **屏幕截图和录音：** 直观地验证代理所做的 UI 更改。
  - **测试结果：** 查看代理的代码满足要求的具体证据。

- **🔄 交互式反馈循环：**
  实时向代理提供反馈。评论工件、更正一行代码或调整计划，代理将在不丢失上下文的情况下采纳您的反馈。

## 🏛️ 高级架构

Open-Anticentravity 被设计为一个模块化的、容器原生的应用程序，您可以在任何地方运行。

```
┌──────────────────────────┐
│      Web UI (React)      │
│  (编辑器和管理器视图)    │
└────────────┬─────────────┘
             │ (WebSocket, REST API)
┌────────────▼─────────────┐
│    网关和编排器          │
│ (FastAPI / Node.js)      │
└──────┬─────────┬─────────┘
       │         │
 (编排)  (路由到)
       │         │
┌──────▼─────────▼─────────┐   ┌──────────────────┐
│  工作区管理器            │   │ AI 模型网关        │
│ (管理 Docker 上下文)     │◀──▶ (连接到 LLM)       │
└──────────────────────────┘   └──────────────────┘
```

- **Web UI：** 一个响应式前端，提供编辑器和代理管理界面。
- **网关和编排器：** 解释用户请求、向代理分派任务和管理工作流程的中央大脑。
- **工作区管理器：** 为代理提供和管理隔离的、容器化的开发环境，以便安全地工作。
- **AI 模型网关：** 一个标准化的界面，用于连接各种大型语言模型。

## 🚀 路线图

我们的路线图是一个活的文件。有关即将推出的功能、技术规格和时间表的详细分解，请参阅我们的完整 [**ROADMAP.md**](./ROADMAP.md)。

以下是关键阶段的高级概述：

- **第一阶段：核心平台和通用网关**
  - [ ] 设计和构建具有可插拔提供商架构的**通用 AI 模型网关**。
  - [ ] 为主要 API (例如 OpenAI、Anthropic) 和本地模型运行器实现初始连接器。
  - [ ] 基础后端服务 (编排器、工作区管理器)。
  - [ ] 具有集成的基于 VSCodium 的编辑器的核心 Web UI。

- **第二阶段：单代理工作流程和工具**
  - [ ] 开发代理编排器以管理代理生命周期。
  - [ ] 实现能够进行文件 I/O 和命令执行的通用代理。
  - [ ] 引入“可验证的工件”系统 (例如任务列表、执行计划)。

- **第三阶段：高级代理功能**
  - [ ] 通过“管理器视图”进行多代理协作和编排。
  - [ ] 引入专门的代理 (例如测试员、代码审查员)。
  - [ ] 代理的自我修复和交互式反馈机制。

- **第四阶段：社区和可扩展性**
  - [ ] 用于自定义工具、模型和代理的公共插件 API。
  - [ ] 用于共享和发现插件的社区市场。
  - [ ] 增强对复杂、多存储库项目的支持。

## 🛠️ 入门 (开发)

有兴趣与我们一起构建软件开发的未来吗？以下是如何在本地运行项目的方法。

**先决条件：**
- Docker 和 Docker Compose
- Node.js (v20+)
- Python (v3.11+)

**安装：**

1.  **克隆存储库：**
    ```bash
    git clone https://github.com/ishandutta2007/open-anticentravity.git
    cd open-anticentravity
    ```

2.  **设置环境变量：**
    ```bash
    cp .env.example .env
    ```
    *在 `.env` 文件中填写您的 API 密钥和其他配置。*

3.  **启动环境：**
    ```bash
    docker-compose up --build
    ```
    这将构建所有服务并启动 Open-Anticentravity 平台。您可以在 `http://localhost:3000` 访问它。

## 🙌 如何贡献

我们相信这个雄心勃勃的项目只有作为一个社区才能实现。我们欢迎每个人的贡献，无论您是开发人员、设计师、技术作家，还是仅仅是一个爱好者。

- **查看 [贡献指南](./CONTRIBUTING.md)** 以了解我们的开发流程以及如何开始。
- **查看 [未解决的问题](https://github.com/ishandutta2007/open-anticentravity/issues)** 以找到您感兴趣的任务。
- **加入我们的 [Discord 服务器](https://discord.com/invite/jc4xtF58Ve)** 与团队和其他贡献者聊天。


## Star 历史

[![Star 历史图表](https://api.star-history.com/svg?repos=ishandutta2007/open-anticentravity&type=date&legend=top-left)](https://www.star-history.com/#ishandutta2007/open-anticentravity&type=date&legend=top-left)




## 📜 免责声明

此工具是独立的，与谷歌无关。“Anticentravity” 和 “Gemini” 是谷歌有限责任公司的商标。它不适用于生产环境。此工具的开发人员不对因此工具造成的任何损害负责。

## 📜 许可证

该项目根据 **MIT 许可证** 获得许可。有关详细信息，请参阅 [LICENSE](./LICENSE) 文件。
