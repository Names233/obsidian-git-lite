# obsidian-git-lite 开发计划

## 项目定位

从 obsidian-git 简化而来，只保留一个核心功能：**自动同步 vault 到 GitHub**。
去掉所有手动 stage、diff view、history view、source control 侧边栏、line author 等复杂功能。

插件名称：**Git Auto Sync**
插件 ID：`obsidian-git-lite`

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                   main.ts (插件入口)                  │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ TriggerManager│  │  CommitAI    │  │ ConflictUI  │ │
│  │ (触发器管理)   │  │ (AI消息生成)  │  │ (冲突详情)   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                  │        │
│  ┌──────┴─────────────────┴──────────────────┴──────┐ │
│  │              GitManager (抽象层)                   │ │
│  │  ┌─────────────┐      ┌──────────────┐           │ │
│  │  │ SimpleGit    │      │ IsomorphicGit│           │ │
│  │  │ (桌面端)      │      │ (移动端)      │           │ │
│  │  └─────────────┘      └──────────────┘           │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐                   │
│  │ SettingsTab   │  │  StatusBar   │                   │
│  │ (设置页)       │  │ (状态栏)      │                   │
│  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────┘
```

---

## 保留的文件（需修改）

| 文件 | 用途 | 改动程度 |
|------|------|---------|
| `src/main.ts` | 插件入口 | 大幅精简 |
| `src/types.ts` | 类型定义 | 精简 |
| `src/constants.ts` | 常量/默认设置 | 精简 |
| `src/automaticsManager.ts` → 重命名为 `src/triggerManager.ts` | 触发器管理 | 重写 |
| `src/gitManager/gitManager.ts` | Git 抽象层 | 保留核心方法 |
| `src/gitManager/simpleGit.ts` | 桌面端 git | 保留，精简 |
| `src/gitManager/isomorphicGit.ts` | 移动端 git | 保留，精简 |
| `src/setting/settings.ts` | 设置页 UI | 大幅精简 |
| `src/setting/localStorageSettings.ts` | 本地存储 | 精简 |
| `src/statusBar.ts` | 状态栏 | 精简 |
| `src/promiseQueue.ts` | 任务队列 | 保留 |
| `src/tools.ts` | 工具类 | 精简 |
| `src/utils.ts` | 通用工具 | 保留需要的部分 |

## 新增的文件

| 文件 | 用途 |
|------|------|
| `src/aiCommitMessage.ts` | AI 生成 commit message（OpenAI 兼容协议） |
| `src/conflictView.ts` | 冲突详情 UI（列出冲突文件 + 标记位置） |

## 删除的文件

| 文件/目录 | 原因 |
|-----------|------|
| `src/commands.ts` | 重写，只保留 5 个命令 |
| `src/editor/` (整个目录) | Editor signs、line author 全部删除 |
| `src/ui/diff/` | Diff view 删除 |
| `src/ui/history/` | History view 删除 |
| `src/ui/sourceControl/` | Source control 侧边栏删除 |
| `src/ui/modals/` (大部分) | 只保留必要的 modal |
| `src/openInGitHub.ts` | 删除 |
| `src/pluginGlobalRef.ts` | 评估是否需要 |

---

## 核心模块设计

### 1. TriggerManager（触发器管理）

替代原项目的 AutomaticsManager，负责三种触发方式：

```
触发方式              实现方式
─────────────────────────────────────────
① 15min 无文件修改     debounce + setTimeout
② 切换到其他页面       workspace.on('blur') 事件
③ Cmd+S (当前文件)     workspace.on('editor-change') + modifier 检测
④ Cmd+Shift+S (全部)   注册 command，手动触发
```

关键逻辑：
- 三个触发器共用一个 `doCommitAndSync()` 方法
- 使用 debounce 避免短时间内重复触发
- 切换页面触发：监听 Obsidian 的 `blur` 事件（用户离开 Obsidian 窗口）
- 15min idle：监听 `vault.on('modify')` 事件，每次文件修改重置计时器
- Cmd+S：拦截保存事件，保存后触发 commit（当前文件变更）
- Cmd+Shift+S：注册为 Obsidian command，commit all changes

### 2. CommitAI（AI 生成 commit message）

```
输入: git diff 输出
  ↓
POST {base_url}/v1/chat/completions
  model: {model}
  messages: [
    { role: "system", content: "你是 commit message 生成器..." },
    { role: "user", content: diff }
  ]
  ↓
输出: commit message (根据 diff 内容自动判断语言)
```

配置项：
- `aiBaseUrl` — API base URL（默认 `https://api.openai.com`）
- `aiApiKey` — API key
- `aiModel` — 模型名（默认 `gpt-4o-mini`）

prompt 设计：
- system prompt 要求生成简洁的 commit message
- 根据 diff 内容自动选择中文或英文
- 如果 diff 为空或 AI 调用失败，fallback 到 `vault backup: {date}`

### 3. ConflictView（冲突详情 UI）

当 pull 产生 merge conflict 时，弹出 Obsidian Notice + 打开详情面板：

```
冲突文件列表：
  ├── note-a.md (双方修改)
  ├── note-b.md (我们删除，他们修改)
  └── folder/note-c.md (双方添加)

每个文件显示：
  - 文件路径
  - 冲突类型（双方修改 / 删除冲突 / 添加冲突）
  - 冲突标记位置（行号）
```

实现方式：使用 Obsidian 的 `Notice` + `Modal` 或自定义 View。

### 4. 核心同步流程

```
doCommitAndSync()
  │
  ├─ 1. 检查是否有变更 (git status)
  │     └─ 无变更 → 跳过
  │
  ├─ 2. stage all changes (git add -A)
  │
  ├─ 3. 生成 commit message (AI)
  │     └─ AI 失败 → fallback 到默认消息
  │
  ├─ 4. commit (git commit)
  │
  ├─ 5. pull with rebase (git pull --rebase)
  │     ├─ 成功 → 继续
  │     └─ 冲突 → 弹出 ConflictUI，停止流程
  │
  └─ 6. push (git push)
        ├─ 成功 → 状态栏提示 ✓
        └─ 失败 → Notice + 重试按钮
```

---

## 设置项（精简后）

```typescript
interface GitAutoSyncSettings {
  // ── Git 配置 ──
  remoteName: string;          // 默认 "origin"
  branchName: string;          // 默认当前分支
  basePath: string;            // git 仓库路径（默认 vault 根目录）

  // ── AI 配置 ──
  aiBaseUrl: string;           // 默认 "https://api.openai.com"
  aiApiKey: string;            // 用户填写
  aiModel: string;             // 默认 "gpt-4o-mini"

  // ── 触发配置 ──
  autoCommitEnabled: boolean;  // 默认 true
  idleTimeout: number;         // 默认 15 (分钟)

  // ── 其他 ──
  showStatusBar: boolean;      // 默认 true
  autoPullOnBoot: boolean;     // 默认 false
}
```

---

## 命令面板（5 个命令）

| 命令 | ID | 说明 |
|------|----|------|
| Init repo | `init-repo` | 初始化 git 仓库 |
| Commit and sync | `commit-and-sync` | 手动触发完整同步流程 |
| Commit and sync (all files) | `commit-and-sync-all` | Cmd+Shift+S 等效 |
| List changed files | `list-changed-files` | 弹窗列出变更文件 |
| Pull from remote | `pull` | 手动拉取 |

---

## 快捷键

| 快捷键 | 动作 |
|--------|------|
| `Cmd+S` / `Ctrl+S` | 保存当前文件 → 触发 commit-and-sync（当前文件变更） |
| `Cmd+Shift+S` / `Ctrl+Shift+S` | commit-and-sync（全部变更） |

---

## 实施步骤

### Phase 1: 清理
1. 删除不需要的文件和目录
2. 精简 types.ts、constants.ts
3. 精简 gitManager 接口（只保留 status/commit/pull/push/init/branchInfo）
4. 精简 simpleGit.ts 和 isomorphicGit.ts

### Phase 2: 核心模块
1. 实现 `aiCommitMessage.ts`
2. 实现 `triggerManager.ts`
3. 实现 `conflictView.ts`
4. 重写 `main.ts` 主流程

### Phase 3: UI
1. 精简设置页
2. 精简状态栏
3. 实现冲突详情 UI

### Phase 4: 打包测试
1. 更新 manifest.json、package.json
2. 更新 README.md
3. 构建测试
4. 推送到 GitHub

---

## 技术栈

- TypeScript
- Obsidian Plugin API
- isomorphic-git (移动端)
- simple-git (桌面端，通过 Node.js child_process)
- OpenAI-compatible API (fetch)

## 依赖

保持原项目的构建工具链（esbuild），删除不需要的运行时依赖。
