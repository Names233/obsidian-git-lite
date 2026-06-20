// Git 管理器抽象基类 - Abstract base class for Git Manager
// 只定义核心 Git 操作接口，供 SimpleGit 和 IsomorphicGit 实现

import { hostname as osHostname } from "os";
import { type App, moment, Platform } from "obsidian";
import type ObsidianGit from "../main";
import type {
    BranchInfo,
    FileStatusResult,
    Status,
} from "../types";

export abstract class GitManager {
    // 插件实例引用 - Plugin instance reference
    readonly plugin: ObsidianGit;
    // Obsidian App 实例引用 - Obsidian App instance reference
    readonly app: App;

    constructor(plugin: ObsidianGit) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    // 获取 Git 状态 - Get git status
    abstract status(opts?: { path?: string }): Promise<Status>;

    // 提交所有更改 - Commit all changes
    abstract commitAll(_: {
        message: string;
        status?: Status;
    }): Promise<number | undefined>;

    // 提交已暂存的更改 - Commit staged changes
    abstract commit(_: {
        message: string;
    }): Promise<number | undefined>;

    // 从远程拉取 - Pull from remote
    abstract pull(): Promise<FileStatusResult[] | undefined>;

    // 推送到远程 - Push to remote
    abstract push(): Promise<number | undefined | null>;

    // 初始化 Git 仓库 - Initialize git repo
    abstract init(): Promise<void>;

    // 获取分支信息 - Get branch info
    abstract branchInfo(): Promise<BranchInfo>;

    // 检查 Git 环境是否就绪 - Check if git environment is ready
    abstract checkRequirements(): Promise<"valid" | "missing-git" | "missing-repo">;

    // 卸载清理 - Unload cleanup
    unload(): void {}

    // 获取相对 Vault 路径 - Get path relative to vault
    getRelativeVaultPath(path: string): string {
        if (this.plugin.settings.basePath) {
            return this.plugin.settings.basePath + "/" + path;
        } else {
            return path;
        }
    }

    // 获取相对仓库路径 - Get path relative to git repo
    getRelativeRepoPath(
        filePath: string,
        doConversion: boolean = true
    ): string {
        if (doConversion) {
            if (this.plugin.settings.basePath.length > 0) {
                return filePath.substring(
                    this.plugin.settings.basePath.length + 1
                );
            }
        }
        return filePath;
    }

    // 格式化提交消息 - Format commit message with template variables
    async formatCommitMessage(template: string): Promise<string> {
        // 替换 {{date}} 变量 - Replace {{date}} variable
        template = template.replace(
            "{{date}}",
            moment().format(this.plugin.settings.commitDateFormat)
        );

        // 替换 {{hostname}} 变量 - Replace {{hostname}} variable
        if (template.includes("{{hostname}}")) {
            let hostname = this.plugin.localStorage.getHostname() || "";
            if (!hostname && Platform.isDesktopApp) {
                hostname = osHostname();
            }
            template = template.replace("{{hostname}}", hostname);
        }

        // 替换 {{numFiles}} 变量 - Replace {{numFiles}} variable
        if (template.includes("{{numFiles}}")) {
            const status = await this.status();
            const numFiles = status.staged.length;
            template = template.replace("{{numFiles}}", String(numFiles));
        }

        return template;
    }
}
