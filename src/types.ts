// 类型定义文件 - Type definitions
// 只保留 Git Auto Sync 核心功能所需的类型

// 同步方法 - Sync method
export type SyncMethod = "rebase" | "merge" | "reset";

// 合并策略 - Merge strategy
export type MergeStrategy = "none" | "ours" | "theirs";

// 作者信息 - Author info
export interface Author {
    name: string;
    email: string;
}

// Git 状态 - Git status
export interface Status {
    all: FileStatusResult[];
    changed: FileStatusResult[];
    staged: FileStatusResult[];
    conflicted: string[];
}

// 文件状态结果 - File status result
// 基于 git status --short 格式
export interface FileStatusResult {
    path: string;
    vaultPath: string;
    from?: string;
    index: string;      // 索引状态 - Index status
    workingDir: string; // 工作目录状态 - Working directory status
}

// 插件状态 - Plugin state
export interface PluginState {
    offlineMode: boolean;
    gitAction: CurrentGitAction;
}

// 当前 Git 操作 - Current git action
export enum CurrentGitAction {
    idle,
    status,
    pull,
    add,
    commit,
    push,
}

// 分支信息 - Branch info
export interface BranchInfo {
    current?: string;
    tracking?: string;
    branches: string[];
}

// 无网络错误 - No network error
export class NoNetworkError extends Error {
    constructor(public readonly originalError: string) {
        super("No network connection available");
    }
}

// Git Auto Sync 设置 - Plugin settings
export interface GitAutoSyncSettings {
    // ── Git 配置 - Git configuration ──
    remoteName: string;          // 远程仓库名，默认 "origin" - Remote name, default "origin"
    branchName: string;          // 分支名，默认当前分支 - Branch name, default current branch
    basePath: string;            // git 仓库路径，默认 vault 根目录 - Git repo path, default vault root
    gitDir: string;              // 自定义 .git 目录路径 - Custom .git directory path

    // ── AI 配置 - AI configuration ──
    aiBaseUrl: string;           // API base URL - API base URL
    aiApiKey: string;            // API key - API key for AI service
    aiModel: string;             // 模型名，默认 "gpt-4o-mini" - Model name, default "gpt-4o-mini"

    // ── 自动提交配置 - Auto commit configuration ──
    autoCommitEnabled: boolean;  // 启用自动提交，默认 true - Enable auto commit, default true
    idleTimeout: number;         // 空闲超时（分钟），默认 15 - Idle timeout in minutes, default 15

    // ── 同步配置 - Sync configuration ──
    syncMethod: SyncMethod;      // 同步方法，默认 "rebase" - Sync method, default "rebase"
    pullBeforePush: boolean;     // 推送前先拉取，默认 true - Pull before push, default true
    disablePush: boolean;        // 禁用推送，默认 false - Disable push, default false
    autoPullOnBoot: boolean;     // 启动时自动拉取，默认 false - Auto pull on boot, default false
    customMessageOnAutoBackup: boolean; // 自动备份时自定义消息，默认 false - Custom message on auto backup, default false
    updateSubmodules: boolean;   // 更新子模块，默认 false - Update submodules, default false

    // ── 提交消息配置 - Commit message configuration ──
    commitMessage: string;       // 手动提交消息 - Manual commit message template
    autoCommitMessage: string;   // 自动提交消息 - Auto commit message template
    commitDateFormat: string;    // 日期格式 - Date format for {{date}} placeholder

    // ── 通知配置 - Notification configuration ──
    disablePopups: boolean;              // 禁用通知，默认 false - Disable notifications, default false
    disablePopupsForNoChanges: boolean;  // 无更改时不通知，默认 true - Hide no-change notifications, default true
    showErrorNotices: boolean;           // 显示错误通知，默认 true - Show error notices, default true

    // ── UI 配置 - UI configuration ──
    showStatusBar: boolean;              // 显示状态栏，默认 true - Show status bar, default true
    showBranchStatusBar: boolean;        // 显示分支状态栏，默认 true - Show branch status bar, default true
    changedFilesInStatusBar: boolean;    // 状态栏显示更改文件数，默认 false - Show changed files count, default false
    refreshSourceControl: boolean;       // 自动刷新源代码管理视图 - Auto refresh source control view
    refreshSourceControlTimer: number;   // 刷新间隔（毫秒） - Refresh interval in milliseconds
}

// 默认设置 - Default settings
export const DEFAULT_SETTINGS: GitAutoSyncSettings = {
    // Git 配置 - Git configuration
    remoteName: "origin",          // 默认远程仓库名 - Default remote name
    branchName: "",                // 默认当前分支 - Default current branch
    basePath: "",                  // 默认 vault 根目录 - Default vault root
    gitDir: "",                    // 默认 .git 目录 - Default .git directory

    // AI 配置 - AI configuration
    aiBaseUrl: "https://api.openai.com", // OpenAI API 地址 - OpenAI API base URL
    aiApiKey: "",                  // API key 为空 - Empty API key
    aiModel: "gpt-4o-mini",       // 默认模型 - Default model

    // 自动提交配置 - Auto commit configuration
    autoCommitEnabled: true,       // 默认启用 - Enabled by default
    idleTimeout: 15,               // 15 分钟空闲后触发 - Trigger after 15 min idle

    // 同步配置 - Sync configuration
    syncMethod: "rebase",          // 默认变基同步 - Default rebase sync
    pullBeforePush: true,          // 推送前先拉取 - Pull before push
    disablePush: false,            // 不禁用推送 - Don't disable push
    autoPullOnBoot: false,         // 启动时不自动拉取 - Don't auto pull on boot
    customMessageOnAutoBackup: false, // 不自定义消息 - Don't custom message on auto backup
    updateSubmodules: false,       // 不更新子模块 - Don't update submodules

    // 提交消息配置 - Commit message configuration
    commitMessage: "vault backup: {{date}}",       // 手动提交消息模板 - Manual commit message
    autoCommitMessage: "vault backup: {{date}}",   // 自动提交消息模板 - Auto commit message
    commitDateFormat: "YYYY-MM-DD HH:mm:ss",       // 日期格式 - Date format

    // 通知配置 - Notification configuration
    disablePopups: false,          // 不禁用通知 - Don't disable notifications
    disablePopupsForNoChanges: true, // 无更改时隐藏通知 - Hide no-change notifications
    showErrorNotices: true,        // 显示错误通知 - Show error notices

    // UI 配置 - UI configuration
    showStatusBar: true,           // 显示状态栏 - Show status bar
    showBranchStatusBar: true,     // 显示分支状态栏 - Show branch status bar
    changedFilesInStatusBar: false, // 不显示更改文件数 - Don't show changed files count
    refreshSourceControl: true,    // 自动刷新源代码管理 - Auto refresh source control
    refreshSourceControlTimer: 7000, // 刷新间隔 7 秒 - 7 second refresh interval
};
