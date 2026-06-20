// Git Auto Sync 主入口 - Main entry point for Git Auto Sync
// 精简为自动同步插件，只保留核心 Git 同步逻辑
// Simplified to auto-sync plugin, only core git sync logic is kept

import { Errors } from "isomorphic-git";
import type { Debouncer } from "obsidian";
import { debounce, Notice, Platform, Plugin } from "obsidian";
import { PromiseQueue } from "src/promiseQueue";
import { ObsidianGitSettingsTab } from "src/setting/settings";
import { StatusBar } from "src/statusBar";
import AutomaticsManager from "./automaticsManager";
import { CONFLICT_OUTPUT_FILE } from "./constants";
import type { GitManager } from "./gitManager/gitManager";
import { IsomorphicGit } from "./gitManager/isomorphicGit";
import { SimpleGit } from "./gitManager/simpleGit";
import { LocalStorageSettings } from "./setting/localStorageSettings";
// 导入核心类型 - Import core types
import type {
    FileStatusResult,
    GitAutoSyncSettings,
    PluginState,
    Status,
} from "./types";
// 导入核心枚举和常量 - Import core enums and constants
import {
    CurrentGitAction,
    DEFAULT_SETTINGS,
    NoNetworkError,
} from "./types";
import { BranchStatusBar } from "./ui/statusBar/branchStatusBar";

/**
 * ObsidianGit 插件主类 - Main plugin class
 *
 * 提供 Git 自动同步功能：
 * - 自动定时提交和推送
 * - 启动时自动拉取
 * - 状态栏显示
 * Provides Git auto-sync:
 * - Auto commit and push on interval
 * - Auto pull on startup
 * - Status bar display
 */
export default class ObsidianGit extends Plugin {
    // Git 管理器实例 - Git manager instance
    gitManager: GitManager;
    // 自动化管理器 - Automatics manager
    automaticsManager = new AutomaticsManager(this);
    // 本地存储设置 - Local storage settings
    localStorage = new LocalStorageSettings(this);
    // 插件设置 - Plugin settings
    settings: GitAutoSyncSettings;
    // 设置面板 - Settings tab
    settingsTab?: ObsidianGitSettingsTab;
    // 状态栏 - Status bar
    statusBar?: StatusBar;
    // 分支状态栏 - Branch status bar
    branchBar?: BranchStatusBar;
    // 插件状态 - Plugin state
    state: PluginState = {
        gitAction: CurrentGitAction.idle,
        offlineMode: false,
    };
    // 上次拉取的文件列表 - Last pulled files
    lastPulledFiles: FileStatusResult[];
    // Git 是否就绪 - Whether git is ready
    gitReady = false;
    // 任务队列 - Promise queue for serializing git operations
    promiseQueue: PromiseQueue = new PromiseQueue(this);
    // 自动提交防抖器 - Debouncer for auto commit after file changes
    autoCommitDebouncer: Debouncer<[], void> | undefined;
    // 缓存的 Git 状态 - Cached git status
    cachedStatus: Status | undefined;
    // 需要清理的定时器 - Intervals to clear on unload
    intervalsToClear: number[] = [];
    // 刷新防抖器 - Debouncer for refreshing status
    debRefresh: Debouncer<[], void>;

    // ── 状态管理 - State management ───────────────────────────────────

    /** 设置插件状态 - Set plugin state */
    setPluginState(state: Partial<PluginState>): void {
        this.state = Object.assign(this.state, state);
        this.statusBar?.display();
    }

    /** 更新缓存的 Git 状态 - Update cached git status */
    async updateCachedStatus(): Promise<Status> {
        this.app.workspace.trigger("obsidian-git:loading-status");
        this.cachedStatus = await this.gitManager.status();
        if (this.cachedStatus.conflicted.length > 0) {
            this.localStorage.setConflict(true);
        } else {
            this.localStorage.setConflict(false);
        }
        await this.branchBar?.display();
        this.app.workspace.trigger("obsidian-git:status-changed", this.cachedStatus);
        return this.cachedStatus;
    }

    /** 刷新状态 - Refresh status */
    async refresh() {
        if (!this.gitReady) return;
        await this.updateCachedStatus().catch((e) => this.displayError(e));
        this.app.workspace.trigger("obsidian-git:refreshed");
    }

    // ── 插件生命周期 - Plugin lifecycle ───────────────────────────────

    /** 插件加载 - Plugin load */
    async onload() {
        console.log("loading " + this.manifest.name + " plugin: v" + this.manifest.version);
        this.localStorage.migrate();
        await this.loadSettings();
        await this.migrateSettings();

        this.settingsTab = new ObsidianGitSettingsTab(this.app, this);
        this.addSettingTab(this.settingsTab);

        if (!this.localStorage.getPluginDisabled()) {
            this.registerEvents();
            this.app.workspace.onLayoutReady(() =>
                this.init({ fromReload: false }).catch((e) => this.displayError(e))
            );
        }
    }

    /** 外部设置变更时重新加载 - Reload on external settings change */
    onExternalSettingsChange() {
        this.reloadSettings().catch((e) => this.displayError(e));
    }

    /** 重新加载设置并重新初始化 - Reload settings and reinitialize */
    async reloadSettings(): Promise<void> {
        const previousSettings = JSON.stringify(this.settings);
        await this.loadSettings();
        const newSettings = JSON.stringify(this.settings);

        if (previousSettings !== newSettings) {
            this.log("Reloading settings");
            this.unloadPlugin();
            await this.init({ fromReload: true });
        }
    }

    /** 注册事件监听 - Register event listeners */
    private registerEvents(): void {
        this.registerEvent(
            this.app.workspace.on("obsidian-git:refresh", () => {
                this.refresh().catch((e) => this.displayError(e));
            })
        );

        // 非桌面端：监听文件变更事件触发自动提交
        // Non-desktop: watch file changes to trigger auto commit
        if (!Platform.isDesktopApp) {
            const triggerRefresh = () => {
                this.debRefresh();
                this.autoCommitDebouncer?.();
            };
            this.registerEvent(this.app.vault.on("modify", triggerRefresh));
            this.registerEvent(this.app.vault.on("delete", triggerRefresh));
            this.registerEvent(this.app.vault.on("create", triggerRefresh));
            this.registerEvent(this.app.vault.on("rename", triggerRefresh));
        }

        this.setRefreshDebouncer();
    }

    /** 设置刷新防抖器 - Set up refresh debouncer */
    setRefreshDebouncer(): void {
        this.debRefresh?.cancel();
        this.debRefresh = debounce(
            () => {
                if (this.settings.refreshSourceControl) {
                    this.refresh().catch(console.error);
                }
            },
            this.settings.refreshSourceControlTimer,
            true
        );
    }

    /** 迁移旧版设置 - Migrate legacy settings
     *  将旧版 localStorage 中的数据迁移到新版设置
     *  Migrate old localStorage data to new settings format
     */
    private async migrateSettings(): Promise<void> {
        // 迁移旧版 gitPath 设置 - Migrate legacy gitPath setting
        // 旧版可能存储在 settings 中，现改为 localStorage
        // Old versions may have stored it in settings, now moved to localStorage
        const data = (await this.loadData()) as Record<string, unknown> | null;
        if (data && data["gitPath"] != undefined) {
            this.localStorage.setGitPath(data["gitPath"] as string);
            delete data["gitPath"];
            await this.saveData(data);
        }
        // 迁移旧版 username 设置 - Migrate legacy username setting
        if (data && data["username"] != undefined) {
            this.localStorage.setPassword(data["username"] as string);
            delete data["username"];
            await this.saveData(data);
        }
    }

    /** 卸载插件资源 - Unload plugin resources */
    unloadPlugin() {
        this.gitReady = false;
        this.automaticsManager.unload();
        this.branchBar?.remove();
        this.statusBar?.remove();
        this.statusBar = undefined;
        this.branchBar = undefined;
        this.gitManager?.unload();
        this.promiseQueue.clear();

        for (const interval of this.intervalsToClear) {
            window.clearInterval(interval);
        }
        this.intervalsToClear = [];
        this.debRefresh?.cancel();
    }

    /** 插件卸载 - Plugin unload */
    onunload() {
        this.unloadPlugin();
        console.log("unloading " + this.manifest.name + " plugin");
    }

    // ── 设置管理 - Settings management ────────────────────────────────

    /** 加载设置 - Load settings */
    async loadSettings() {
        // 从磁盘加载用户设置 - Load user settings from disk
        let data = (await this.loadData()) as Partial<GitAutoSyncSettings> | null;
        if (data == undefined) {
            // 首次加载时的默认数据 - Default data for first load
            data = {};
        }
        // 使用 spread 合并默认设置和用户设置，用户设置优先
        // Merge default settings with user settings using spread, user settings take priority
        this.settings = { ...DEFAULT_SETTINGS, ...data };
    }

    /** 保存设置 - Save settings */
    async saveSettings() {
        await this.saveData(this.settings);
    }

    /** 是否使用 SimpleGit（桌面端） - Whether to use SimpleGit (desktop) */
    get useSimpleGit(): boolean {
        return Platform.isDesktopApp;
    }

    // ── Git 初始化 - Git initialization ───────────────────────────────

    /**
     * 初始化 Git 管理器 - Initialize git manager
     * 创建 GitManager 实例，检查仓库状态，启动自动任务
     * Creates GitManager instance, checks repo status, starts automatics
     */
    async init({ fromReload = false }): Promise<void> {
        if (this.settings.showStatusBar && !this.statusBar) {
            const statusBarEl = this.addStatusBarItem();
            this.statusBar = new StatusBar(statusBarEl, this);
            this.intervalsToClear.push(
                window.setInterval(() => this.statusBar?.display(), 1000)
            );
        }

        try {
            if (this.useSimpleGit) {
                this.gitManager = new SimpleGit(this);
                await (this.gitManager as SimpleGit).setGitInstance();
            } else {
                this.gitManager = new IsomorphicGit(this);
            }

            const result = await this.gitManager.checkRequirements();
            const pausedAutomatics = this.localStorage.getPausedAutomatics();

            switch (result) {
                case "missing-git":
                    this.displayError(`Cannot run git command. Trying to run: '${this.localStorage.getGitPath() || "git"}' .`);
                    break;
                case "missing-repo":
                    new Notice("Can't find a valid git repository. Please create one via the given command or clone an existing repo.", 10000);
                    break;
                case "valid":
                    this.gitReady = true;
                    this.setPluginState({ gitAction: CurrentGitAction.idle });

                    // 桌面端显示分支状态栏 - Show branch status bar on desktop
                    if (Platform.isDesktop && this.settings.showBranchStatusBar && !this.branchBar) {
                        const branchStatusBarEl = this.addStatusBarItem();
                        this.branchBar = new BranchStatusBar(branchStatusBarEl, this);
                        this.intervalsToClear.push(
                            window.setInterval(() => void this.branchBar?.display().catch(console.error), 60000)
                        );
                    }
                    await this.branchBar?.display();

                    this.app.workspace.trigger("obsidian-git:refresh");
                    this.app.workspace.trigger("obsidian-git:head-change");

                    // 启动时自动拉取 - Auto pull on startup
                    if (!fromReload && this.settings.autoPullOnBoot && !pausedAutomatics) {
                        this.promiseQueue.addTask(() => this.pullChangesFromRemote());
                    }

                    // 初始化自动任务 - Initialize automatics
                    if (!pausedAutomatics) {
                        await this.automaticsManager.init();
                    }
                    if (pausedAutomatics) {
                        new Notice("Automatic routines are currently paused.");
                    }
                    break;
            }
        } catch (error) {
            this.displayError(error);
            console.error(error);
        }
    }

    /**
     * 确保 Git 已初始化 - Ensure git is initialized
     * @returns true if gitManager is ready, false otherwise
     */
    async isAllInitialized(): Promise<boolean> {
        if (!this.gitReady) {
            await this.init({ fromReload: true });
        }
        return this.gitReady;
    }

    // ── 核心同步操作 - Core sync operations ───────────────────────────

    /** 从远程拉取更改（命令版本） - Pull changes from remote (command version) */
    async pullChangesFromRemote(): Promise<void> {
        if (!(await this.isAllInitialized())) return;

        const filesUpdated = await this.pull();
        if (filesUpdated === false) return;
        if (!filesUpdated) {
            this.displayMessage("Pull: Everything is up-to-date");
        }

        if (this.gitManager instanceof SimpleGit) {
            const status = await this.updateCachedStatus();
            if (status.conflicted.length > 0) {
                this.displayError(`You have conflicts in ${status.conflicted.length} ${status.conflicted.length == 1 ? "file" : "files"}`);
                await this.handleConflict(status.conflicted);
            }
        }

        this.app.workspace.trigger("obsidian-git:refresh");
        this.setPluginState({ gitAction: CurrentGitAction.idle });
    }

    /** 提交并同步（commit + pull + push） - Commit and sync (commit + pull + push) */
    async commitAndSync({
        fromAutoBackup,
        requestCustomMessage = false,
        commitMessage,
        onlyStaged = false,
    }: {
        fromAutoBackup: boolean;
        requestCustomMessage?: boolean;
        commitMessage?: string;
        onlyStaged?: boolean;
    }): Promise<void> {
        if (!(await this.isAllInitialized())) return;

        if (this.settings.syncMethod == "reset" && this.settings.pullBeforePush) {
            await this.pull();
        }

        const commitSuccessful = await this.commit({
            fromAuto: fromAutoBackup,
            requestCustomMessage,
            commitMessage,
            onlyStaged,
        });
        if (!commitSuccessful) return;

        if (this.settings.syncMethod != "reset" && this.settings.pullBeforePush) {
            await this.pull();
        }

        if (!this.settings.disablePush) {
            if ((await this.remotesAreSet()) && (await this.gitManager.canPush())) {
                await this.push();
            } else {
                this.displayMessage("No commits to push");
            }
        }
        this.setPluginState({ gitAction: CurrentGitAction.idle });
    }

    /**
     * 提交更改 - Commit changes
     * @returns true if commit was successful
     */
    async commit({
        fromAuto,
        requestCustomMessage = false,
        onlyStaged = false,
        commitMessage,
        amend = false,
    }: {
        fromAuto: boolean;
        requestCustomMessage?: boolean;
        onlyStaged?: boolean;
        commitMessage?: string;
        amend?: boolean;
    }): Promise<boolean> {
        if (!(await this.isAllInitialized())) return false;
        try {
            let hadConflict = this.localStorage.getConflict();
            let status: Status | undefined;
            let stagedFiles: { vaultPath: string; path: string }[] = [];
            let unstagedFiles: { vaultPath: string; path: string; type: string }[] = [];

            if (this.gitManager instanceof SimpleGit) {
                await this.mayDeleteConflictFile();
                status = await this.updateCachedStatus();
                if (status.conflicted.length == 0) hadConflict = false;
                if (fromAuto && status.conflicted.length > 0) {
                    this.displayError(`Did not commit, because you have conflicts in ${status.conflicted.length} ${status.conflicted.length == 1 ? "file" : "files"}. Please resolve them and commit per command.`);
                    await this.handleConflict(status.conflicted);
                    return false;
                }
                stagedFiles = status.staged;
                unstagedFiles = status.changed as unknown as { vaultPath: string; path: string; type: string }[];
            } else {
                if (fromAuto && hadConflict) {
                    this.displayError("Did not commit, because you have conflicts. Please resolve them and commit per command.");
                    return false;
                }
                if (hadConflict) await this.mayDeleteConflictFile();
                const gitManager = this.gitManager as IsomorphicGit;
                if (onlyStaged) {
                    stagedFiles = await gitManager.getStagedFiles();
                } else {
                    const res = await gitManager.getUnstagedFiles();
                    unstagedFiles = res.map(({ path, type }) => ({
                        vaultPath: this.gitManager.getRelativeVaultPath(path),
                        path, type,
                    }));
                }
            }

            if (unstagedFiles.length + stagedFiles.length !== 0 || hadConflict) {
                let cmtMessage = (commitMessage ??= fromAuto
                    ? this.settings.autoCommitMessage
                    : this.settings.commitMessage);

                if ((fromAuto && this.settings.customMessageOnAutoBackup) || requestCustomMessage) {
                    if (!this.settings.disablePopups && fromAuto) {
                        new Notice("Auto backup: Please enter a custom commit message. Leave empty to abort");
                    }
                    const { CustomMessageModal } = await import("./ui/modals/customMessageModal");
                    const modalMessage = await new CustomMessageModal(this).openAndGetResult();
                    if (modalMessage != undefined && modalMessage != "" && modalMessage != "...") {
                        cmtMessage = modalMessage;
                    } else {
                        this.setPluginState({ gitAction: CurrentGitAction.idle });
                        return false;
                    }
                }

                if (!cmtMessage || cmtMessage.trim() === "") {
                    new Notice("Commit aborted: No commit message provided");
                    this.setPluginState({ gitAction: CurrentGitAction.idle });
                    return false;
                }

                let committedFiles: number | undefined;
                if (onlyStaged) {
                    committedFiles = await this.gitManager.commit({ message: cmtMessage, amend });
                } else {
                    committedFiles = await this.gitManager.commitAll({
                        message: cmtMessage, status, unstagedFiles, amend,
                    });
                }

                if (this.gitManager instanceof SimpleGit) {
                    await this.updateCachedStatus();
                }

                let roughly = false;
                if (committedFiles === undefined) {
                    roughly = true;
                    committedFiles = unstagedFiles.length + stagedFiles.length || 0;
                }
                this.displayMessage(`Committed${roughly ? " approx." : ""} ${committedFiles} ${committedFiles == 1 ? "file" : "files"}`);
            } else {
                this.displayMessage("No changes to commit");
            }
            this.app.workspace.trigger("obsidian-git:refresh");
            return true;
        } catch (error) {
            this.displayError(error);
            return false;
        }
    }

    /** 推送到远程 - Push to remote. Returns true if push was successful */
    async push(): Promise<boolean> {
        if (!(await this.isAllInitialized())) return false;
        if (!(await this.remotesAreSet())) return false;
        const hadConflict = this.localStorage.getConflict();
        try {
            if (this.gitManager instanceof SimpleGit) await this.mayDeleteConflictFile();

            let status: Status;
            if (this.gitManager instanceof SimpleGit && (status = await this.updateCachedStatus()).conflicted.length > 0) {
                this.displayError(`Cannot push. You have conflicts in ${status.conflicted.length} ${status.conflicted.length == 1 ? "file" : "files"}`);
                await this.handleConflict(status.conflicted);
                return false;
            } else if (this.gitManager instanceof IsomorphicGit && hadConflict) {
                this.displayError("Cannot push. You have conflicts");
                return false;
            }

            this.log("Pushing....");
            const pushedFiles = await this.gitManager.push();
            if (pushedFiles !== undefined) {
                if (pushedFiles === null) {
                    this.displayMessage("Pushed to remote");
                } else if (pushedFiles > 0) {
                    this.displayMessage(`Pushed ${pushedFiles} ${pushedFiles == 1 ? "file" : "files"} to remote`);
                } else {
                    this.displayMessage("No commits to push");
                }
            }
            this.setPluginState({ offlineMode: false });
            this.app.workspace.trigger("obsidian-git:refresh");
            return true;
        } catch (e) {
            if (e instanceof NoNetworkError) {
                this.handleNoNetworkError(e);
            } else {
                this.displayError(e);
            }
            return false;
        }
    }

    /** 内部拉取方法 - Internal pull method. Returns number of pulled files or false */
    async pull(): Promise<false | number> {
        if (!(await this.remotesAreSet())) return false;
        try {
            this.log("Pulling....");
            const pulledFiles = (await this.gitManager.pull()) || [];
            this.setPluginState({ offlineMode: false });
            if (pulledFiles.length > 0) {
                this.displayMessage(`Pulled ${pulledFiles.length} ${pulledFiles.length == 1 ? "file" : "files"} from remote`);
                this.lastPulledFiles = pulledFiles;
            }
            return pulledFiles.length;
        } catch (e) {
            this.displayError(e);
            return false;
        }
    }

    // ── 辅助方法 - Helper methods ─────────────────────────────────────

    /** 确保远程分支已设置 - Ensure upstream branch is set */
    async remotesAreSet(): Promise<boolean> {
        if (this.settings.updateSubmodules) return true;
        if (
            this.gitManager instanceof SimpleGit &&
            (await this.gitManager.getConfig("push.autoSetupRemote", "all")) == "true"
        ) return true;
        if (!(await this.gitManager.branchInfo()).tracking) {
            new Notice("No upstream branch is set. Please select one.");
            const { GeneralModal } = await import("./ui/modals/generalModal");
            const { splitRemoteBranch } = await import("./utils");
            const remoteBranch = await this.selectRemoteBranch();
            if (remoteBranch == undefined) {
                this.displayError("Aborted. No upstream-branch is set!", 10000);
                this.setPluginState({ gitAction: CurrentGitAction.idle });
                return false;
            }
            await this.gitManager.updateUpstreamBranch(remoteBranch);
            this.displayMessage(`Set upstream branch to ${remoteBranch}`);
            this.setPluginState({ gitAction: CurrentGitAction.idle });
            return true;
        }
        return true;
    }

    /** 选择远程分支 - Select remote branch */
    private async selectRemoteBranch(): Promise<string | undefined> {
        const { GeneralModal } = await import("./ui/modals/generalModal");
        let remotes = await this.gitManager.getRemotes();
        let selectedRemote: string | undefined;

        if (remotes.length === 0) {
            const { formatRemoteUrl } = await import("./utils");
            const nameModal = new GeneralModal(this, {
                options: remotes,
                placeholder: "Select or create a new remote by typing its name and selecting it",
            });
            const remoteName = await nameModal.openAndGetResult();
            if (remoteName) {
                const oldUrl = await this.gitManager.getRemoteUrl(remoteName);
                const urlModal = new GeneralModal(this, {
                    initialValue: oldUrl,
                    placeholder: "Enter remote URL",
                });
                const remoteURL = await urlModal.openAndGetResult();
                if (remoteURL) {
                    await this.gitManager.setRemote(remoteName, formatRemoteUrl(remoteURL));
                    selectedRemote = remoteName;
                }
            }
            remotes = await this.gitManager.getRemotes();
        }

        const nameModal = new GeneralModal(this, {
            options: remotes,
            placeholder: "Select or create a new remote by typing its name and selecting it",
        });
        const remoteName = selectedRemote ?? (await nameModal.openAndGetResult());
        if (remoteName) {
            this.displayMessage("Fetching remote branches");
            await this.gitManager.fetch(remoteName);
            const branches = await this.gitManager.getRemoteBranches(remoteName);
            const branchModal = new GeneralModal(this, {
                options: branches,
                placeholder: "Select or create a new remote branch by typing its name and selecting it",
            });
            const branch = await branchModal.openAndGetResult();
            if (branch == undefined) return;
            const { splitRemoteBranch } = await import("./utils");
            if (!branch.startsWith(remoteName + "/")) return `${remoteName}/${branch}`;
            return branch;
        }
    }

    /** 删除冲突文件 - Delete conflict file if it exists */
    async mayDeleteConflictFile(): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(CONFLICT_OUTPUT_FILE);
        if (file) {
            this.app.vault.delete(file);
        }
    }

    /** 处理冲突 - Handle merge conflicts */
    async handleConflict(conflicted?: string[]): Promise<void> {
        this.localStorage.setConflict(true);
        let lines: string[] | undefined;
        if (conflicted !== undefined) {
            const { TFile } = await import("obsidian");
            lines = [
                "# Conflicts",
                "Please resolve them and commit them using the commands `Git: Commit all changes` followed by `Git: Push`",
                "(This file will automatically be deleted before commit)",
                "",
                ...conflicted.map((e) => {
                    const file = this.app.vault.getAbstractFileByPath(e);
                    if (file instanceof TFile) {
                        const link = this.app.metadataCache.fileToLinktext(file, "/");
                        return `- [[${link}]]`;
                    }
                    return `- Not a file: ${e}`;
                }),
            ];
        }
        const { Tools } = await import("./tools");
        const tools = new Tools(this);
        await tools.writeAndOpenFile(lines?.join("\n"));
    }

    /** 处理无网络错误 - Handle no network error */
    handleNoNetworkError(_: NoNetworkError): void {
        if (!this.state.offlineMode) {
            this.displayError("Git: Going into offline mode. Future network errors will no longer be displayed.", 2000);
        }
        this.setPluginState({ gitAction: CurrentGitAction.idle, offlineMode: true });
    }

    // ── 消息显示 - Message display ────────────────────────────────────

    /** 显示消息 - Display message */
    displayMessage(message: string, timeout: number = 4 * 1000): void {
        this.statusBar?.displayMessage(message.toLowerCase(), timeout);
        if (!this.settings.disablePopups) {
            if (!this.settings.disablePopupsForNoChanges || !message.startsWith("No changes")) {
                new Notice(message, 5 * 1000);
            }
        }
        this.log(message);
    }

    /** 显示错误 - Display error */
    displayError(data: unknown, timeout: number = 10 * 1000): void {
        if (data instanceof Errors.UserCanceledError) {
            new Notice("Aborted");
            return;
        }
        let error: Error;
        if (data instanceof Error) error = data;
        else error = new Error(String(data));

        this.setPluginState({ gitAction: CurrentGitAction.idle });
        if (this.settings.showErrorNotices) {
            new Notice(error.message, timeout);
        }
        console.error(`${this.manifest.id}:`, error.stack);
        this.statusBar?.displayMessage(error.message.toLowerCase(), timeout);
    }

    /** 日志输出 - Log output */
    log(...data: unknown[]) {
        console.log(`${this.manifest.id}:`, ...data);
    }
}
