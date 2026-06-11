<div align="center">
  <br />
  <img src=".github/assets/google-antigravity-logo.svg" width="200" />
  <br />
  <h1>Open-Antigravity</h1>

  [Download](https://antigravity.google)
  <p><b>The Open-Source, Universal AI Gateway for Agentic Development</b></p>
  <p>
    <i>An open, community-driven effort to build a truly model-agnostic alternative to proprietary agentic coding platforms.</i>
  </p>
  
  <p>
    <a href="#"><img alt="Build Status" src="https://img.shields.io/badge/build-passing-brightgreen?style=for-the-badge"></a>
    <a href="#"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
    <a href="#"><img alt="Contributions Welcome" src="https://img.shields.io/badge/contributions-welcome-orange?style=for-the-badge"></a>
    <a href="#"><img alt="Discord" src="https://img.shields.io/discord/123456789?label=discord&style=for-the-badge&logo=discord"></a>
    <a href="https://github.com/ishandutta2007">
      <img alt="GitHub followers" src="https://img.shields.io/github/followers/ishandutta2007?label=Follow&style=for-the-badge&logo=github&logoColor=white" alt="Github"/>
    </a>
  </p>
</div>

---

**Open-Antigravity** is not just another code editor or AI assistant. It's an ambitious open-source project to build a web-native, **agent-first** integrated development environment (IDE). Unlike proprietary platforms that lock you into a single AI ecosystem, Open-Antigravity is designed from the ground up to be a **universal gateway to any LLM**. Our goal is to create a platform where developers can delegate complex tasks to autonomous AI agents, powered by the models of their choice.

This project is for you if you believe in:
- **True Model Freedom:** Building a future that isn't tied to a single AI provider.
- **Democratizing AI:** Making state-of-the-art agentic development accessible to everyone.
- **Transparency & Extensibility:** Creating an open core that the community can shape, extend, and trust.
- **Self-Hosting & Privacy:** Giving you full control over your code, your data, and your AI connections.

## ✨ Core Features (The Vision)

We aim to build a platform that redefines developer productivity. Here are the key features we are building towards:

- **🌌 Best of All Worlds:** Aims to fuse the best features of Claude Desktop, Cursor, Windsurf, Kiro, Trae, Trae CN, Qoder, and Antigravity into a single, cohesive experience.

- **✨ Google's Cutting Edge:** Incorporates the powerful code-mending capabilities of **Google CodeMender** and the advanced reasoning of **Google Jules** to provide state-of-the-art code generation, debugging, and understanding.

- **🔒 Privacy First:** No code information, environment information, OS information or user information or usage pattern would be sent to google.

- **🔌 Universal LLM Gateway:**
  Break free from vendor lock-in. Open-Antigravity is designed as a universal translation layer for Large Language Models. Connect to anything from OpenAI's GPT-5, Anthropic's Claude, and Google's Gemini to open models like Llama, Grok, and Qwen, or specialized APIs like Deepseek and Kimi. A unified interface means your agents and tools work seamlessly across all of them.

- **🤖 Agent-First Workflow:**
  Delegate high-level tasks like "implement a new API endpoint for user authentication" or "refactor the database schema and update all related services" to AI agents powered by your chosen LLM.

- **🧠 Multi-Agent Collaboration:**
  Spawn multiple agents that can work in parallel or collaborate on a single goal. For example, one agent writes the code, a second writes the tests, and a third verifies the changes in a browser.

- **🌐 Dual-View Interface:**
  - **Editor View:** A feature-rich, AI-supercharged IDE based on **VS Code (VSCodium)** for when you want to get hands-on.
  - **Manager View:** A dedicated surface to spawn, orchestrate, monitor, and manage your fleet of AI agents as they work across different parts of your codebase.

- **✅ Trust Through Verifiable Artifacts:**
  To build trust in autonomous work, agents don't just produce logs. They generate tangible **Artifacts**:
  - **Task Lists & Plans:** Review the agent's plan before it starts.
  - **Screenshots & Recordings:** Visually verify UI changes made by an agent.
  - **Test Results:** See concrete proof that the agent's code meets the requirements.

- **🔄 Interactive Feedback Loop:**
  Provide feedback to agents in real-time. Comment on an artifact, correct a line of code, or adjust the plan, and the agent will incorporate your feedback without losing context.

## 🏛️ High-Level Architecture

Open-Antigravity is being designed as a modular, container-native application that you can run anywhere.

```
┌──────────────────────────┐
│      Web UI (React)      │
│  (Editor & Manager View) │
└────────────┬─────────────┘
             │ (WebSocket, REST API)
┌────────────▼─────────────┐
│    Gateway & Orchestrator│
│ (FastAPI / Node.js)      │
└──────┬─────────┬─────────┘
       │         │
 (Orchestrates)  (Routes to)
       │         │
┌──────▼─────────▼─────────┐   ┌──────────────────┐
│  Workspace Manager       │   │ AI Model Gateway │
│ (Manages Docker contexts)│◀──▶ (Connects to LLMs) │
└──────────────────────────┘   └──────────────────┘
```

- **Web UI:** A responsive frontend providing the editor and agent management interfaces.
- **Gateway & Orchestrator:** The central brain that interprets user requests, dispatches tasks to agents, and manages workflows.
- **Workspace Manager:** Provisions and manages isolated, containerized development environments for agents to safely work in.
- **AI Model Gateway:** A standardized interface to connect to various large language models.

## 🚀 Roadmap

Our roadmap is a living document. For a detailed breakdown of upcoming features, technical specifications, and timelines, please see our full [**ROADMAP.md**](./ROADMAP.md).

Here is a high-level overview of the key phases:

- **Phase 1: Core Platform & Universal Gateway**
  - [ ] Design and build the **Universal AI Model Gateway** with a pluggable provider architecture.
  - [ ] Implement initial connectors for major APIs (e.g., OpenAI, Anthropic) and a local model runner.
  - [ ] Foundational backend services (Orchestrator, Workspace Manager).
  - [ ] Core web UI with an integrated VSCodium-based editor.

- **Phase 2: Single-Agent Workflow & Tooling**
  - [ ] Development of the Agent Orchestrator to manage agent lifecycles.
  - [ ] Implementation of a general-purpose agent capable of file I/O and command execution.
  - [ ] Introduction of the "Verifiable Artifacts" system (e.g., task lists, execution plans).

- **Phase 3: Advanced Agentic Features**
  - [ ] Multi-agent collaboration and orchestration via the "Manager View".
  - [ ] Introduction of specialized agents (e.g., Tester, Code Reviewer).
  - [ ] Self-healing and interactive feedback mechanisms for agents.

- **Phase 4: Community & Extensibility**
  - [ ] Public plugin API for custom tools, models, and agents.
  - [ ] A community marketplace for sharing and discovering plugins.
  - [ ] Enhanced support for complex, multi-repository projects.

## 🛠️ Getting Started (Development)

Interested in building the future of software development with us? Here’s how you can get the project running locally.

**Prerequisites:**
- Docker and Docker Compose
- Node.js (v20+)
- Python (v3.11+)

**Installation:**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/ishandutta2007/open-antigravity.git
    cd open-antigravity
    ```

2.  **Setup environment variables:**
    ```bash
    cp .env.example .env
    ```
    *Fill in your API keys and other configuration in the `.env` file.*

3.  **Launch the environment:**
    ```bash
    docker-compose up --build
    ```
    This will build all the services and launch the Open-Antigravity platform. You can access it at `http://localhost:3000`.

## 🙌 How to Contribute

We believe this ambitious project can only be realized as a community. We welcome contributions from everyone, whether you're a developer, a designer, a technical writer, or just an enthusiast.

- **Check out the [Contribution Guide](./CONTRIBUTING.md)** to learn about our development process and how to get started.
- **Look at the [open issues](https://github.com/ishandutta2007/open-antigravity/issues)** to find a task that interests you.
- **Join our [Discord server](https://discord.com/invite/jc4xtF58Ve)** to chat with the team and other contributors.

## 🙌 Contributors

<a href="https://github.com/ishandutta2007/open-antigravity/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ishandutta2007/open-antigravity" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ishandutta2007/open-antigravity&type=date&legend=top-left)](https://www.star-history.com/#ishandutta2007/open-antigravity&type=date&legend=top-left)


## 📜 Disclaimer

This tool is independent and not affiliated with Google. "Antigravity" and "Gemini" are trademarks of Google LLC. It is not intended for production use. The developers of this tool are not responsible for any damage caused by this tool.

## 📜 License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for details.
