// SimpleGit 实现 - 使用 simple-git 库的 Git 管理器
// SimpleGit implementation - Git manager using simple-git library
// 只保留核心 Git 操作，用于 Git Auto Sync
// Only core Git operations are kept for Git Auto Sync

import debug from "debug";
import * as fsPromises from "fs/promises";
import type { FileSystemAdapter } from "obsidian";
import { normalizePath, Notice, Platform } from "obsidian";
import * as path from "path";
import { resolve, sep } from "path";
import type * as simple from "simple-git";
import simpleGit from "simple-git";
import {
    ASK_PASS_INPUT_FILE,
    ASK_PASS_SCRIPT,
    ASK_PASS_SCRIPT_FILE,
    DEFAULT_WIN_GIT_PATH,
} from "src/constants";
import { GeneralModal } from "src/ui/modals/generalModal";
import type ObsidianGit from "../main";
import type { BranchInfo, FileStatusResult, Status } from "../types";
import { CurrentGitAction, NoNetworkError } from "../types";
import { spawnAsync } from "../utils";
import { GitManager } from "./gitManager";

// SimpleGit 类 - 使用系统安装的 git 命令行工具
// SimpleGit class - uses system-installed git command-line tool
export class SimpleGit extends GitManager {
    // simple-git 实例 - simple-git instance
    git: simple.SimpleGit;
    // 仓库绝对路径 - Absolute repository path
    absoluteRepoPath: string;
    // AskPass 监控控制器 - AskPass watch abort controller
    askPassWatchAbortController: AbortController | undefined;
    // 文件变更监控控制器 - File change watch abort controller
    fileWatcherAbortController: AbortController | undefined;
    // 是否使用 Windows 默认 Git 路径 - Whether to use default Windows Git path
    useDefaultWindowsGitPath: boolean = false;

    // 构造函数 - Constructor
    constructor(plugin: ObsidianGit) {
        super(plugin);
    }

    // 初始化 Git 实例 - Initialize git instance
    async setGitInstance(ignoreError = false): Promise<void> {
        // 检查 Git 是否安装 - Check if git is installed
        if (await this.isGitInstalled()) {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const vaultBasePath = adapter.getBasePath();
            let basePath = vaultBasePath;

            // 如果设置了 basePath，拼接完整路径 - If basePath is set, join full path
            if (this.plugin.settings.basePath) {
                const exists = await adapter.exists(
                    normalizePath(this.plugin.settings.basePath)
                );
                if (exists) {
                    basePath = path.join(vaultBasePath, this.plugin.settings.basePath);
                } else if (!ignoreError) {
                    new Notice("ObsidianGit: 基础路径不存在");
                }
            }
            this.absoluteRepoPath = basePath;

            // 创建 simple-git 实例 - Create simple-git instance
            this.git = simpleGit({
                baseDir: basePath,
                binary:
                    this.plugin.localStorage.getGitPath() ||
                    (this.useDefaultWindowsGitPath ? DEFAULT_WIN_GIT_PATH : undefined),
                config: ["core.quotepath=off"],
                unsafe: {
                    allowUnsafeCustomBinary: true,
                    allowUnsafeEditor: true,
                    allowUnsafeAskPass: true,
                    allowUnsafeConfigEnvCount: true,
                    allowUnsafeConfigPaths: true,
                    allowUnsafeCredentialHelper: true,
                    allowUnsafeGitProxy: true,
                    allowUnsafeGpgProgram: true,
                    allowUnsafeHooksPath: true,
                    allowUnsafeMergeDriver: true,
                    allowUnsafeSshCommand: true,
                    allowUnsafePager: true,
                },
            });

            // 设置环境变量 - Set environment variables
            const pathPaths = this.plugin.localStorage.getPATHPaths();
            const envVars = this.plugin.localStorage.getEnvVars();
            const gitDir = this.plugin.settings.gitDir;
            const envs = { ...process.env };
            if (pathPaths.length > 0) {
                const pathStr = pathPaths.join(":") + ":" + envs["PATH"];
                envs["PATH"] = pathStr;
            }
            if (gitDir) {
                envs["GIT_DIR"] = gitDir;
                envs["GIT_WORK_TREE"] = basePath;
            }
            for (const envVar of envVars) {
                const [key, value] = envVar.split("=");
                envs[key] = value;
            }

            // 启用 simple-git 调试日志 - Enable simple-git debug logging
            const SIMPLE_GIT_NAMESPACE = "simple-git";
            const NAMESPACE_SEPARATOR = ",";
            const currentDebug = (localStorage.debug ?? "") as string;
            const namespaces = currentDebug.split(NAMESPACE_SEPARATOR);
            if (
                !namespaces.includes(SIMPLE_GIT_NAMESPACE) &&
                !namespaces.includes(`-${SIMPLE_GIT_NAMESPACE}`)
            ) {
                namespaces.push(SIMPLE_GIT_NAMESPACE);
                debug.enable(namespaces.join(NAMESPACE_SEPARATOR));
            }

            // 检查是否为 Git 仓库并解析根目录 - Check if git repo and resolve root
            if (await this.git.env(envs).checkIsRepo()) {
                const relativeRoot = await this.git.revparse("--show-cdup");
                const absoluteRoot = resolve(basePath + sep + relativeRoot);
                this.absoluteRepoPath = absoluteRoot;
                await this.git.cwd(absoluteRoot);
            }

            // 设置 SSH AskPass 认证脚本 - Set up SSH AskPass authentication script
            const absolutePluginConfigPath = path.join(
                vaultBasePath, this.app.vault.configDir, "plugins", this.plugin.manifest.id
            );
            const askPassPath = path.join(absolutePluginConfigPath, ASK_PASS_SCRIPT_FILE);
            if (envs["SSH_ASKPASS"] == undefined) {
                envs["SSH_ASKPASS"] = askPassPath;
            }
            envs["SSH_ASKPASS_REQUIRE"] = "force";
            envs["OBSIDIAN_GIT_CREDENTIALS_INPUT"] = path.join(
                absolutePluginConfigPath, ASK_PASS_INPUT_FILE
            );
            if (envs["SSH_ASKPASS"] == askPassPath) {
                this.askpass().catch((e) => this.plugin.displayError(e));
            }
            envs["OBSIDIAN_GIT"] = "1";

            this.git = this.git.env(envs);
        }
    }

    // 检查 Git 环境是否就绪 - Check if git environment is ready
    async checkRequirements(): Promise<"valid" | "missing-git" | "missing-repo"> {
        if (!(await this.isGitInstalled())) {
            return "missing-git";
        }
        try {
            await this.git.checkIsRepo();
            return "valid";
        } catch {
            return "missing-repo";
        }
    }

    // 卸载清理 - Unload and cleanup
    unload(): void {
        this.askPassWatchAbortController?.abort();
        this.fileWatcherAbortController?.abort();
    }

    // 获取 Git 状态 - Get git status
    async status(opts?: { path?: string }): Promise<Status> {
        const dir = opts?.path;
        // 设置操作状态 - Set operation state
        this.plugin.setPluginState({ gitAction: CurrentGitAction.status });
        // 获取原始状态 - Get raw status
        const status = await this.git.status(dir != undefined ? ["--", dir] : []);
        this.plugin.setPluginState({ gitAction: CurrentGitAction.idle });

        // 格式化文件状态 - Format file statuses
        const allFilesFormatted = status.files.map<FileStatusResult>((e) => {
            const res = this.formatPath(e);
            return {
                path: res.path,
                from: res.from,
                index: e.index === "?" ? "U" : e.index,
                workingDir: e.working_dir === "?" ? "U" : e.working_dir,
                vaultPath: this.getRelativeVaultPath(res.path),
            };
        });
        return {
            all: allFilesFormatted,
            changed: allFilesFormatted.filter((e) => e.workingDir !== " "),
            staged: allFilesFormatted.filter((e) => e.index !== " " && e.index != "U"),
            conflicted: status.conflicted.map((p) => this.formatPath({ path: p }).path),
        };
    }

    // 提交所有更改 - Commit all changes
    async commitAll({ message }: { message: string }): Promise<number> {
        this.plugin.setPluginState({ gitAction: CurrentGitAction.add });
        await this.git.add("-A");
        this.plugin.setPluginState({ gitAction: CurrentGitAction.commit });
        const res = await this.git.commit(await this.formatCommitMessage(message));
        this.app.workspace.trigger("obsidian-git:head-change");
        return res.summary.changes;
    }

    // 提交已暂存的更改 - Commit staged changes
    async commit({ message }: { message: string }): Promise<number> {
        this.plugin.setPluginState({ gitAction: CurrentGitAction.commit });
        const res = await this.git.commit(await this.formatCommitMessage(message));
        this.app.workspace.trigger("obsidian-git:head-change");
        this.plugin.setPluginState({ gitAction: CurrentGitAction.idle });
        return res.summary.changes;
    }

    // 从远程拉取更改 - Pull changes from remote
    async pull(): Promise<FileStatusResult[] | undefined> {
        this.plugin.setPluginState({ gitAction: CurrentGitAction.pull });
        try {
            // 获取分支信息 - Get branch info
            const branchInfo = await this.branchInfo();
            const localCommit = await this.git.revparse([branchInfo.current!]);

            if (!branchInfo.tracking) {
                this.plugin.log("No tracking branch found. Skipping pull.");
                return;
            }

            // 从远程获取 - Fetch from remote
            await this.git.fetch();
            const upstreamCommit = await this.git.revparse([branchInfo.tracking!]);

            // 如果本地和远程相同，无需合并 - If same, no merge needed
            if (localCommit !== upstreamCommit) {
                if (
                    this.plugin.settings.syncMethod === "merge" ||
                    this.plugin.settings.syncMethod === "rebase"
                ) {
                    try {
                        const args = [branchInfo.tracking!];
                        switch (this.plugin.settings.syncMethod) {
                            case "merge":
                                await this.git.merge(args);
                                break;
                            case "rebase":
                                await this.git.rebase(args);
                        }
                    } catch (err) {
                        this.plugin.displayError(
                            `拉取失败 (${this.plugin.settings.syncMethod}): ${"message" in err ? err.message : err}`
                        );
                        return;
                    }
                } else if (this.plugin.settings.syncMethod === "reset") {
                    try {
                        await this.git.raw([
                            "update-ref", `refs/heads/${branchInfo.current}`, upstreamCommit,
                        ]);
                    } catch (err) {
                        this.plugin.displayError(
                            `同步失败 (${this.plugin.settings.syncMethod}): ${"message" in err ? err.message : err}`
                        );
                    }
                }
                this.app.workspace.trigger("obsidian-git:head-change");

                // 获取变更文件列表 - Get list of changed files
                const afterMergeCommit = await this.git.revparse([branchInfo.current!]);
                const filesChanged = await this.git.diff([
                    `${localCommit}..${afterMergeCommit}`, "--name-only",
                ]);
                return filesChanged
                    .split(/\r\n|\r|\n/)
                    .filter((value) => value.length > 0)
                    .map((e) => ({
                        path: e, workingDir: "P", index: "P",
                        vaultPath: this.getRelativeVaultPath(e),
                    }));
            } else {
                return [];
            }
        } catch (e) {
            this.convertErrors(e);
        }
    }

    // 推送到远程 - Push to remote
    async push(): Promise<number | undefined | null> {
        this.plugin.setPluginState({ gitAction: CurrentGitAction.push });
        try {
            const status = await this.git.status();
            const trackingBranch = status.tracking;
            const currentBranch = status.current!;

            // 计算远程变更文件数 - Count remote changed files
            let remoteChangedFiles: number | null = null;
            if (trackingBranch) {
                remoteChangedFiles = (
                    await this.git.diffSummary([currentBranch, trackingBranch, "--"])
                ).changed;
            }
            await this.git.push();
            return remoteChangedFiles;
        } catch (e) {
            this.convertErrors(e);
        }
    }

    // 初始化 Git 仓库 - Initialize git repository
    async init(): Promise<void> {
        await this.git.init(false);
    }

    // 获取分支信息 - Get branch information
    async branchInfo(): Promise<BranchInfo> {
        const status = await this.git.status();
        const branches = await this.git.branch(["--no-color"]);
        return {
            current: status.current || undefined,
            tracking: status.tracking || undefined,
            branches: branches.all,
        };
    }

    // 获取 Git 配置值 - Get git config value
    async getConfig(path: string): Promise<string> {
        return (await this.git.raw(["config", path])).trim();
    }

    // 设置 Git 配置值 - Set git config value（传 undefined 则取消设置）
    async setConfig(path: string, value: string | undefined): Promise<void> {
        if (value !== undefined) {
            await this.git.raw(["config", path, value]);
        } else {
            await this.git.raw(["config", "--unset", path]);
        }
    }

    // 获取最后提交时间 - Get last commit time
    async getLastCommitTime(): Promise<Date | undefined> {
        try {
            const res = await this.git.log({ n: 1 });
            if (res != null && res.latest != null) {
                return new Date(res.latest.date);
            }
        } catch (error: unknown) {
            if (error instanceof Error && error.message.contains("does not have any commits yet")) {
                return undefined;
            }
            throw error;
        }
    }

    // 获取未推送的提交数 - Get number of unpushed commits
    async getUnpushedCommits(): Promise<number> {
        const status = await this.git.status();
        const trackingBranch = status.tracking;
        const currentBranch = status.current;
        if (trackingBranch == null || currentBranch == null) return 0;
        return (await this.git.diffSummary([currentBranch, trackingBranch, "--"])).changed;
    }

    // ── 内部辅助方法 - Internal helper methods ──

    // 格式化文件路径（移除多余引号） - Format file path (remove extra quotes)
    private formatPath(filePath: { from?: string; path: string }): { path: string; from?: string } {
        function format(p?: string): string | undefined {
            if (p == undefined) return undefined;
            if (p.startsWith('"') && p.endsWith('"')) return p.substring(1, p.length - 1);
            return p;
        }
        if (filePath.from != undefined) {
            return { from: format(filePath.from), path: format(filePath.path)! };
        }
        return { path: format(filePath.path)! };
    }

    // 获取相对于 Vault 的路径 - Get path relative to vault
    getRelativeVaultPath(filePath: string): string {
        const adapter = this.app.vault.adapter as FileSystemAdapter;
        const from = adapter.getBasePath();
        const to = path.join(this.absoluteRepoPath, filePath);
        let res = path.relative(from, to);
        if (Platform.isWin) res = res.replace(/\\/g, "/");
        return res;
    }

    // 获取相对于仓库的路径 - Get path relative to repository
    getRelativeRepoPath(filePath: string, doConversion: boolean = true): string {
        if (doConversion) {
            const adapter = this.plugin.app.vault.adapter as FileSystemAdapter;
            const vaultPath = adapter.getBasePath();
            const from = this.absoluteRepoPath;
            const to = path.join(vaultPath, filePath);
            let res = path.relative(from, to);
            if (Platform.isWin) res = res.replace(/\\/g, "/");
            return res;
        }
        return filePath;
    }

    // 插件配置绝对路径 - Absolute plugin config path
    private get absPluginConfigPath(): string {
        const adapter = this.app.vault.adapter as FileSystemAdapter;
        const vaultPath = adapter.getBasePath();
        return path.join(vaultPath, this.app.vault.configDir, "plugins", this.plugin.manifest.id);
    }

    // 插件配置相对路径 - Relative plugin config path
    private get relPluginConfigPath(): string {
        return path.join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
    }

    // SSH AskPass 认证脚本设置 - Set up SSH AskPass authentication script
    private async askpass(): Promise<void> {
        const adapter = this.app.vault.adapter as FileSystemAdapter;
        const relPluginConfigDir = this.app.vault.configDir + "/plugins/" + this.plugin.manifest.id + "/";
        await this.addAskPassScriptToExclude();
        await fsPromises.writeFile(
            path.join(this.absPluginConfigPath, ASK_PASS_SCRIPT_FILE), ASK_PASS_SCRIPT
        );
        await fsPromises.chmod(
            path.join(this.absPluginConfigPath, ASK_PASS_SCRIPT_FILE), 0o755
        );
        this.askPassWatchAbortController = new AbortController();
        const { signal } = this.askPassWatchAbortController;
        try {
            const watcher = fsPromises.watch(this.absPluginConfigPath, { signal });
            for await (const event of watcher) {
                if (event.filename != ASK_PASS_INPUT_FILE) continue;
                const triggerFilePath = relPluginConfigDir + ASK_PASS_INPUT_FILE;
                await new Promise((res) => window.setTimeout(res, 200));
                if (!(await adapter.exists(triggerFilePath))) continue;
                const data = await adapter.read(triggerFilePath);
                let notice: Notice | undefined;
                if (data.length > 60) notice = new Notice(data, 999_999);
                let obscure = true;
                if (data.contains("Username for")) obscure = false;
                const response = await new GeneralModal(this.plugin, {
                    allowEmpty: true, obscure,
                    placeholder: data.length > 60 ? "请输入对消息的回复。" : data,
                }).openAndGetResult();
                notice?.hide();
                if (await adapter.exists(triggerFilePath)) {
                    await adapter.write(`${triggerFilePath}.response`, response ?? "");
                }
            }
        } catch (error) {
            this.plugin.displayError(error);
            await fsPromises.rm(path.join(this.absPluginConfigPath, ASK_PASS_SCRIPT_FILE), { force: true });
            await new Promise((res) => window.setTimeout(res, 5000));
            this.plugin.log("重试 askpass 监控");
            await this.askpass();
        }
    }

    // 将 AskPass 脚本添加到 exclude 文件 - Add AskPass script to exclude file
    private async addAskPassScriptToExclude(): Promise<void> {
        try {
            if (!(await this.git.checkIsRepo())) return;
            const absoluteExcludeFilePath = await this.git.revparse([
                "--path-format=absolute", "--git-path", "info/exclude",
            ]);
            const vaultRelativeAskPassScriptFile = path.join(
                this.app.vault.configDir, "plugins", this.plugin.manifest.id, ASK_PASS_SCRIPT_FILE
            );
            const repoRelativeAskPassScriptFile = this.getRelativeRepoPath(
                vaultRelativeAskPassScriptFile, true
            );
            const content = await fsPromises.readFile(absoluteExcludeFilePath, "utf-8");
            if (!content.split("\n").some((line) => line.contains(repoRelativeAskPassScriptFile))) {
                await fsPromises.appendFile(absoluteExcludeFilePath, repoRelativeAskPassScriptFile + "\n");
            }
        } catch (error) {
            console.error("Error while adding askpass script to exclude file:", error);
        }
    }

    // 检查 Git 是否安装 - Check if git is installed
    private async isGitInstalled(): Promise<boolean> {
        const gitPath = this.plugin.localStorage.getGitPath();
        const command = await spawnAsync(gitPath || "git", ["--version"], {});
        if (command.error) {
            if (Platform.isWin && !gitPath) {
                this.plugin.log(
                    `Git 未在 PATH 中找到。正在检查标准安装路径 (${DEFAULT_WIN_GIT_PATH})`
                );
                const cmd = await spawnAsync(DEFAULT_WIN_GIT_PATH, ["--version"]);
                if (cmd.error) { console.error(cmd.error); return false; }
                this.useDefaultWindowsGitPath = true;
            } else {
                console.error(command.error);
                return false;
            }
        } else {
            this.useDefaultWindowsGitPath = false;
        }
        return true;
    }

    // 转换错误为特定异常 - Convert errors to specific exceptions
    private convertErrors(error: unknown): never {
        if (error instanceof Error) {
            const message = String(error.message);
            const networkFailure =
                message.contains("Could not resolve host") ||
                message.contains("Unable to resolve host") ||
                message.contains("Unable to open connection") ||
                message.match(/ssh: connect to host .*? port .*?: Operation timed out/) != null ||
                message.match(/ssh: connect to host .*? port .*?: Network is unreachable/) != null;
            if (networkFailure) throw new NoNetworkError(message);
        }
        throw error;
    }
}
