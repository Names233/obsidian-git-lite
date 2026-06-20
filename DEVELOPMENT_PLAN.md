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

---

## 认证机制

与原版 obsidian-git 保持一致，支持以下方式：

### 桌面端
- **Personal Access Token (PAT)**：用户在设置页填写 GitHub PAT
- **SSH Key**：使用系统已配置的 SSH key（~/.ssh/）
- **GitHub CLI**：检测 `gh auth status`，复用已登录的凭据

### 移动端
- **PAT 为主**：移动端无法使用 SSH agent，推荐 PAT
- **OAuth（可选）**：后续可考虑 GitHub OAuth flow

### 存储方式
- PAT 存储在 Obsidian 的 `localStorage` 中（与原版一致）
- 不加密，依赖 Obsidian 本身的插件隔离机制

---

## 错误恢复与重试策略

### 1. 网络错误处理

```
场景                    处理方式
──────────────────────────────────────────────────────
网络断开                检测 navigator.onLine，暂停触发器
                        网络恢复后自动触发一次同步
DNS 解析失败            重试 3 次，间隔 5s/10s/30s
连接超时 (30s)          中止当前操作，提示用户
```

### 2. Git 操作错误

```
场景                    处理方式
──────────────────────────────────────────────────────
push 被拒绝 (non-fast-forward)   自动 pull --rebase，再 push
pull 冲突                        弹出 ConflictUI，暂停自动同步
                                 用户解决后手动触发 commit-and-sync
本地仓库损坏                     提示用户重新 clone
.git 锁文件残留                  检测并清理 .git/index.lock
```

### 3. AI API 错误

```
场景                    处理方式
──────────────────────────────────────────────────────
API 超时 (10s)          fallback 到默认消息 "vault backup: {date}"
API 返回错误            fallback + Notice 提示用户检查配置
Rate Limit (429)        fallback + 提示用户稍后重试
API Key 无效 (401)      fallback + 引导用户检查设置
diff 内容过大 (>4KB)    截断 diff，只取前 4KB 发送给 AI
```

### 4. 重试机制

```typescript
// 通用重试函数
async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delays: number[] = [5000, 10000, 30000] // 5s, 10s, 30s
): Promise<T>

// 使用场景
- git pull/push：最多重试 3 次
- AI API 调用：不重试（直接 fallback）
- git status：不重试（快速失败）
```

### 5. 状态恢复

插件启动时检查：
- 是否有未完成的同步操作（检查 .git/MERGE_HEAD 等）
- 是否有残留的锁文件
- 上次同步是否失败（读取本地状态标记）

---

## 性能优化

### 1. Git 操作优化

```
操作              优化策略
──────────────────────────────────────────────────────
git status        使用 `git status --porcelain -uno`
                  忽略 untracked 文件（减少扫描范围）
                  
git diff          使用 `git diff --stat` 先判断变更规模
                  变更文件 > 50 个时，只取 stat 不取完整 diff
                  
git add           使用 `git add -A` 一次性暂存
                  避免逐文件 add 的开销
```

### 2. 触发器优化

```
场景              优化策略
──────────────────────────────────────────────────────
频繁保存文件      debounce 5 秒，合并多次保存为一次同步
                  用户连续 Cmd+S 10 次 → 只触发 1 次同步
                  
大型 vault        git status 结果缓存 30 秒
(>1000 文件)      短时间内多次触发只执行一次 status
                  
空变更            git status 无变更时跳过整个流程
                  避免不必要的 AI API 调用
```

### 3. AI 调用优化

```
场景              优化策略
──────────────────────────────────────────────────────
diff 太大         截断到 4KB，取文件列表 + 部分变更内容
                  prompt 中说明 "变更较多，仅展示部分"
                  
API 响应慢        设置 10 秒超时
                  超时直接 fallback，不阻塞用户
                  
连续触发          AI 结果缓存 60 秒
                  相同 diff 内容不重复调用 API
```

### 4. 移动端专项优化

```
问题              解决方案
──────────────────────────────────────────────────────
isomorphic-git    限制单次 commit 的文件数量 (≤ 100)
性能较差          超过时分批 commit
                  
内存占用          大文件 (> 1MB) 跳过 AI 分析
                  只对文本文件生成 commit message
                  
后台限制          监听 Obsidian 的 suspend 事件
                  暂停触发器，恢复后重新激活
```

---

## 测试策略

### 1. 单元测试

```typescript
// 测试框架：Vitest（轻量，兼容 Obsidian 模块）

describe('TriggerManager', () => {
  it('应 debounce 5 秒内的多次触发')
  it('应在 15 分钟无操作后触发同步')
  it('应在窗口 blur 时触发同步')
  it('应在 Cmd+S 时触发同步')
  it('网络断开时应暂停触发器')
})

describe('CommitAI', () => {
  it('应根据 diff 生成 commit message')
  it('应在 API 超时时 fallback 到默认消息')
  it('应在 diff 为空时跳过 AI 调用')
  it('应截断超过 4KB 的 diff')
  it('应自动选择中文或英文')
})

describe('GitManager', () => {
  it('应正确解析 git status 输出')
  it('应处理 merge conflict')
  it('应检测并清理锁文件')
})
```

### 2. 集成测试

```typescript
describe('完整同步流程', () => {
  // 使用临时 git 仓库
  
  it('无变更时应跳过同步')
  it('有变更时应完成 commit → pull → push 流程')
  it('push 被拒时应自动 rebase 并重试')
  it('pull 冲突时应暂停并弹出 ConflictUI')
  it('AI 失败时应使用 fallback 消息')
})
```

### 3. 手动测试清单

```
桌面端测试：
  □ 首次安装，未配置 git 仓库 → 提示初始化
  □ 配置 PAT 后能正常 push/pull
  □ SSH key 方式能正常工作
  □ Cmd+S 触发同步
  □ 15 分钟空闲后自动同步
  □ 切换窗口时触发同步
  □ 网络断开后恢复，自动同步
  □ 大型 vault (1000+ 文件) 性能正常
  □ AI commit message 生成正常
  □ AI 失败时 fallback 正常

移动端测试：
  □ PAT 方式能正常认证
  □ 基本同步流程正常
  □ 后台切换不丢失状态
  □ 大文件处理正常
```

### 4. CI/CD

```yaml
# GitHub Actions
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test        # 单元测试
      - run: pnpm build       # 构建检查
      - run: pnpm lint        # 代码风格
```

---

## 发布计划

### 插件信息
- **插件名称**：Git Auto Sync
- **插件 ID**：obsidian-git-lite
- **作者**：Names233
- **仓库**：https://github.com/Names233/obsidian-git-lite

### 发布到 Obsidian 社区插件

1. **准备材料**
   - manifest.json（更新为新插件信息）
   - styles.css（精简后的样式）
   - main.js（构建产物）
   - README.md（用户文档）

2. **提交审核**
   - Fork obsidian-releases 仓库
   - 在 community-plugins.json 中添加插件信息
   - 提交 PR 等待审核

3. **版本管理**
   - 遵循 semver（0.1.0 → 0.2.0 → 1.0.0）
   - 每个版本更新 manifest.json 和 package.json
   - 使用 GitHub Releases 发布构建产物

### 首次发布目标 (v0.1.0)

- [x] 开发计划文档
- [ ] Phase 1: 清理完成
- [ ] Phase 2: 核心模块实现
- [ ] Phase 3: UI 完成
- [ ] 基本测试通过
- [ ] README 文档
- [ ] 提交到 Obsidian 社区

