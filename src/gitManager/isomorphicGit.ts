// IsomorphicGit 实现 - 纯 JavaScript Git 管理器（移动端使用）
// IsomorphicGit implementation - pure JavaScript Git manager (used on mobile)
// 只保留核心 Git 操作：status, commitAll, commit, pull, push, init, branchInfo
// Only core Git operations are kept

import type {
    AuthCallback,
    AuthFailureCallback,
    GitHttpRequest,
    GitHttpResponse,
    GitProgressEvent,
    HttpClient,
} from "isomorphic-git";
import git, { Errors } from "isomorphic-git";
import { Notice, requestUrl } from "obsidian";
import type ObsidianGit from "../main";
// 导入核心类型 - Import core types
import type {
    BranchInfo,
    FileStatusResult,
    Status,
} from "../types";
import { CurrentGitAction } from "../types";
import { GeneralModal } from "../ui/modals/generalModal";
import { GitManager } from "./gitManager";
import { MyAdapter } from "./myAdapter";
import diff3Merge from "diff3";

/**
 * IsomorphicGit 类 - 纯 JS 实现的 Git 管理器
 * IsomorphicGit class - Pure JS Git manager implementation
 *
 * 用于移动端，不依赖系统 git 命令行
 * Used on mobile, does not depend on system git CLI
 */
export class IsomorphicGit extends GitManager {
    // statusMatrix 列索引常量
    // statusMatrix column index constants
    private readonly FILE = 0;
    private readonly HEAD = 1;
    private readonly WORKDIR = 2;
    private readonly STAGE = 3;

    // 状态码映射表（基于 git status --short）
    // Status code mapping (based on git status --short)
    // See: https://isomorphic-git.org/docs/en/statusMatrix
    private readonly status_mapping: Record<string, string> = {
        "000": "  ", "003": "AD", "020": "??", "022": "A ", "023": "AM",
        "100": "D ", "101": " D", "103": "MD", "110": "DA", "111": "  ",
        "113": "MM", "120": "DA", "121": " M", "122": "M ", "123": "MM",
    };

    private readonly noticeLength = 999_999;
    private readonly fs = new MyAdapter(this.app.vault, this.plugin);

    constructor(plugin: ObsidianGit) {
        super(plugin);
    }

    // ── 基础设施方法 - Infrastructure methods ─────────────────────────

    /**
     * 获取 isomorphic-git 仓库参数
     * Get isomorphic-git repo parameters
     */
    private getRepo(): {
        fs: MyAdapter; dir: string; gitdir?: string;
        onAuth: AuthCallback; onAuthFailure: AuthFailureCallback; http: HttpClient;
    } {
        return {
            fs: this.fs,
            dir: this.plugin.settings.basePath,
            gitdir: this.plugin.settings.gitDir || undefined,
            onAuth: () => ({
                username: this.plugin.localStorage.getUsername() ?? undefined,
                password: this.plugin.localStorage.getPassword() ?? undefined,
            }),
            onAuthFailure: async () => {
                new Notice("认证失败。请使用其他凭据重试。");
                const username = await new GeneralModal(this.plugin, {
                    placeholder: "请输入用户名",
                }).openAndGetResult();
                if (username) {
                    const password = await new GeneralModal(this.plugin, {
                        placeholder: "请输入密码或个人访问令牌",
                        obscure: true,
                    }).openAndGetResult();
                    if (password) {
                        this.plugin.localStorage.setUsername(username);
                        this.plugin.localStorage.setPassword(password);
                        return { username, password };
                    }
                }
                return { cancel: true };
            },
            http: {
                async request({ url, method, headers, body }: GitHttpRequest): Promise<GitHttpResponse> {
                    let collectedBody: ArrayBuffer | undefined;
                    if (body) {
                        collectedBody = await asyncIteratorToArrayBuffer(body);
                    }
                    const res = await requestUrl({
                        url, method, headers, body: collectedBody, throw: false,
                    });
                    return {
                        url, method,
                        headers: res.headers,
                        body: arrayBufferToAsyncIterator(res.arrayBuffer),
                        statusCode: res.status,
                        statusMessage: res.status.toString(),
                    };
                },
            },
        };
    }

    /**
     * 包装文件系统操作，确保保存后清理缓存
     * Wrap filesystem operations, ensure cache is saved and cleared after
     */
    private async wrapFS<T>(call: Promise<T>): Promise<T> {
        try {
            const res = await call;
            await this.fs.saveAndClear();
            return res;
        } catch (error) {
            await this.fs.saveAndClear();
            throw error;
        }
    }

    // ── 核心 Git 操作 - Core Git operations ───────────────────────────

    /**
     * 获取 Git 状态 - Get git status
     * 返回所有文件的暂存/未暂存/冲突状态
     * Returns staged/unstaged/conflicted status for all files
     */
    async status(opts?: { path?: string }): Promise<Status> {
        let notice: Notice | undefined;
        const timeout = window.setTimeout(() => {
            notice = new Notice("获取状态耗时较长，请稍候...", this.noticeLength);
        }, 20000);
        try {
            this.plugin.setPluginState({ gitAction: CurrentGitAction.status });
            const statusOpts = { ...this.getRepo() } as Parameters<typeof git.statusMatrix>[0];
            if (opts?.path != undefined) {
                statusOpts.filepaths = [`${opts.path}/`];
            }
            const status = (await this.wrapFS(git.statusMatrix(statusOpts)))
                .map((row) => this.getFileStatusResult(row));

            const changed: FileStatusResult[] = [];
            const staged: FileStatusResult[] = [];
            const all: FileStatusResult[] = [];
            for (const file of status) {
                if (file.workingDir !== " ") changed.push(file);
                if (file.index !== " " && file.index !== "U") staged.push(file);
                if (file.index != " " || file.workingDir != " ") all.push(file);
            }
            window.clearTimeout(timeout);
            notice?.hide();
            return { all, changed, staged, conflicted: [] };
        } catch (error) {
            window.clearTimeout(timeout);
            notice?.hide();
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 暂存并提交所有更改 - Stage and commit all changes
     * 自动暂存所有更改文件，然后提交
     * Automatically stages all changed files, then commits
     */
    // 暂存并提交所有更改 - Stage and commit all changes
    // unstagedFiles: { path: string; type: string }[] 未暂存文件列表
    async commitAll({
        message, status, unstagedFiles,
    }: {
        message: string; status?: Status; unstagedFiles?: { path: string; type: string }[];
    }): Promise<number | undefined> {
        try {
            await this.checkAuthorInfo();
            await this.stageAll({ status, unstagedFiles });
            return this.commit({ message });
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 提交已暂存的更改 - Commit staged changes
     * 仅提交已经在暂存区的文件
     * Only commits files already in the staging area
     */
    async commit({ message }: { message: string }): Promise<undefined> {
        try {
            await this.checkAuthorInfo();
            this.plugin.setPluginState({ gitAction: CurrentGitAction.commit });
            const formatMessage = await this.formatCommitMessage(message);
            const hadConflict = this.plugin.localStorage.getConflict();
            let parent: string[] | undefined = undefined;
            if (hadConflict) {
                const branchInfo = await this.branchInfo();
                parent = [branchInfo.current!, branchInfo.tracking!];
            }
            await this.wrapFS(git.commit({
                ...this.getRepo(), message: formatMessage, parent,
            }));
            this.plugin.localStorage.setConflict(false);
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 从远程拉取更改 - Pull changes from remote
     * 执行 fetch + merge 操作
     * Performs fetch + merge operation
     */
    async pull(): Promise<FileStatusResult[]> {
        const progressNotice = this.showNotice("正在初始化拉取");
        try {
            this.plugin.setPluginState({ gitAction: CurrentGitAction.pull });
            const localCommit = await this.resolveRef("HEAD");
            await this.fetch();
            const branchInfo = await this.branchInfo();
            await this.checkAuthorInfo();

            const mergeRes = await this.wrapFS(git.merge({
                ...this.getRepo(),
                ours: branchInfo.current,
                theirs: branchInfo.tracking!,
                abortOnConflict: false,
                mergeDriver: this.plugin.settings.mergeStrategy !== "none"
                    ? ({ contents }) => {
                        const baseContent = contents[0];
                        const ourContent = contents[1];
                        const theirContent = contents[2];
                        const LINEBREAKS = /^.*(\r?\n|$)/gm;
                        const ours = ourContent.match(LINEBREAKS) ?? [];
                        const base = baseContent.match(LINEBREAKS) ?? [];
                        const theirs = theirContent.match(LINEBREAKS) ?? [];
                        const result = diff3Merge(ours, base, theirs);
                        let mergedText = "";
                        for (const item of result) {
                            if (item.ok) mergedText += item.ok.join("");
                            if (item.conflict) {
                                mergedText += this.plugin.settings.mergeStrategy === "ours"
                                    ? item.conflict.a.join("")
                                    : item.conflict.b.join("");
                            }
                        }
                        return { cleanMerge: true, mergedText };
                    }
                    : undefined,
            }));

            if (!mergeRes.alreadyMerged) {
                await this.wrapFS(git.checkout({
                    ...this.getRepo(),
                    ref: branchInfo.current,
                    onProgress: (progress) => {
                        progressNotice?.setMessage(this.getProgressText("检出", progress));
                    },
                    remote: branchInfo.remote,
                }));
            }
            progressNotice?.hide();

            const upstreamCommit = await this.resolveRef("HEAD");
            const changedFiles = await this.getFileChangesCount(localCommit, upstreamCommit);
            this.showNotice("拉取完成", false);

            return changedFiles.map<FileStatusResult>((file) => ({
                path: file.path,
                workingDir: "P",
                index: "P",
                vaultPath: this.getRelativeVaultPath(file.path),
            }));
        } catch (error) {
            progressNotice?.hide();
            if (error instanceof Errors.MergeConflictError) {
                await this.plugin.handleConflict(
                    error.data.filepaths.map((file) => this.getRelativeVaultPath(file))
                );
            }
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 推送到远程 - Push to remote
     * 将本地提交推送到远程仓库
     * Push local commits to remote repository
     */
    async push(): Promise<number> {
        if (!(await this.canPush())) return 0;
        const progressNotice = this.showNotice("正在初始化推送");
        try {
            this.plugin.setPluginState({ gitAction: CurrentGitAction.status });
            const status = await this.branchInfo();
            const numChangedFiles = (
                await this.getFileChangesCount(status.current!, status.tracking!)
            ).length;

            this.plugin.setPluginState({ gitAction: CurrentGitAction.push });
            const remote = await this.getCurrentRemote();
            await this.wrapFS(git.push({
                ...this.getRepo(),
                remote,
                onProgress: (progress) => {
                    progressNotice?.setMessage(this.getProgressText("推送", progress));
                },
            }));
            progressNotice?.hide();
            return numChangedFiles;
        } catch (error) {
            progressNotice?.hide();
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 初始化 Git 仓库 - Initialize git repository
     * 在当前目录创建新的 .git 目录
     * Creates a new .git directory in the current directory
     */
    async init(): Promise<void> {
        try {
            await this.wrapFS(git.init(this.getRepo()));
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 获取分支信息 - Get branch info
     * 返回当前分支、跟踪分支和所有分支列表
     * Returns current branch, tracking branch, and all branches
     */
    async branchInfo(): Promise<BranchInfo & { remote: string }> {
        try {
            const current = (await git.currentBranch(this.getRepo())) || "";
            const branches = await git.listBranches(this.getRepo());
            const remote = (await this.getConfig(`branch.${current}.remote`)) ?? "origin";
            const trackingBranch = (await this.getConfig(`branch.${current}.merge`))
                ?.split("refs/heads")[1];
            const tracking = trackingBranch ? remote + trackingBranch : undefined;
            return { current, tracking, branches, remote };
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    // ── 辅助方法 - Helper methods ─────────────────────────────────────

    /**
     * 检查仓库是否存在 - Check if repository exists
     */
    async checkRequirements(): Promise<"valid" | "missing-repo"> {
        const headExists = await this.plugin.app.vault.adapter.exists(
            `${this.getRepo().dir}/.git/HEAD`
        );
        return headExists ? "valid" : "missing-repo";
    }

    /**
     * 暂存所有更改的文件 - Stage all changed files
     */
    // 暂存所有更改的文件 - Stage all changed files
    // unstagedFiles: { path: string; type: string }[] 未暂存文件列表
    private async stageAll({
        dir, status, unstagedFiles,
    }: {
        dir?: string; status?: Status; unstagedFiles?: { path: string; type: string }[];
    }): Promise<void> {
        try {
            if (status) {
                await Promise.all(status.changed.map((file) =>
                    file.workingDir !== "D"
                        ? this.wrapFS(git.add({ ...this.getRepo(), filepath: file.path }))
                        : git.remove({ ...this.getRepo(), filepath: file.path })
                ));
            } else {
                const filesToStage = unstagedFiles ?? (await this.getUnstagedFiles(dir ?? "."));
                await Promise.all(filesToStage.map(({ path, type }) =>
                    type == "D"
                        ? git.remove({ ...this.getRepo(), filepath: path })
                        : this.wrapFS(git.add({ ...this.getRepo(), filepath: path }))
                ));
            }
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 从远程获取更改 - Fetch from remote
     */
    private async fetch(remote?: string): Promise<void> {
        const progressNotice = this.showNotice("正在初始化获取");
        try {
            await this.wrapFS(git.fetch({
                ...this.getRepo(),
                onProgress: (progress: GitProgressEvent) => {
                    progressNotice?.setMessage(this.getProgressText("获取", progress));
                },
                remote: remote ?? (await this.getCurrentRemote()),
            }));
            progressNotice?.hide();
        } catch (error) {
            progressNotice?.hide();
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 检查是否有未推送的提交 - Check if there are unpushed commits
     */
    private async canPush(): Promise<boolean> {
        const status = await this.branchInfo();
        const current = await this.resolveRef(status.current!);
        const tracking = await this.resolveRef(status.tracking!);
        return current != tracking;
    }

    /**
     * 获取当前远程名称 - Get current remote name
     */
    private async getCurrentRemote(): Promise<string> {
        const current = (await git.currentBranch(this.getRepo())) || "";
        return (await this.getConfig(`branch.${current}.remote`)) ?? "origin";
    }

    /**
     * 解析引用为 commit hash - Resolve ref to commit hash
     */
    private resolveRef(ref: string): Promise<string> {
        return this.wrapFS(git.resolveRef({ ...this.getRepo(), ref }));
    }

    /**
     * 获取两个 commit 之间的文件变更 - Get file changes between two commits
     */
    private async getFileChangesCount(commitHash1: string, commitHash2: string) {
        return this.wrapFS(git.walk({
            ...this.getRepo(),
            trees: [git.TREE({ ref: commitHash1 }), git.TREE({ ref: commitHash2 })],
            map: async function (filepath, [A, B]) {
                if (filepath[0] === ".") return null;
                if ((await A?.type()) === "tree" || (await B?.type()) === "tree") return;
                const Aoid = await A?.oid();
                const Boid = await B?.oid();
                if (Aoid === Boid) return;
                let type = "M";
                if (Aoid === undefined) type = "A";
                if (Boid === undefined) type = "D";
                return { path: filepath, type };
            },
        }));
    }

    /**
     * 获取未暂存的文件列表 - Get list of unstaged files
     */
    private async getUnstagedFiles(base = ".") {
        let notice: Notice | undefined;
        const timeout = window.setTimeout(() => {
            notice = new Notice("获取状态耗时较长，请稍候...", this.noticeLength);
        }, 20000);
        try {
            const repo = this.getRepo();
            const res = await this.wrapFS(git.walk({
                ...repo,
                trees: [git.WORKDIR(), git.STAGE()],
                map: async function (filepath, [workdir, stage]) {
                    if (!stage && workdir) {
                        if (await git.isIgnored({ ...repo, filepath })) return null;
                    }
                    if (filepath[0] === ".") return null;
                    const [workdirType, stageType] = await Promise.all([
                        workdir && workdir.type(),
                        stage && stage.type(),
                    ]);
                    const isBlob = [workdirType, stageType].includes("blob");
                    if ((workdirType === "tree" || workdirType === "special") && !isBlob) return;
                    if (stageType === "commit") return null;
                    if ((stageType === "tree" || stageType === "special") && !isBlob) return;

                    const stageOid = stageType === "blob" ? await stage!.oid() : undefined;
                    let workdirOid;
                    if (workdirType === "blob" && stageType !== "blob") workdirOid = "42";
                    else if (workdirType === "blob") workdirOid = await workdir!.oid();

                    if (!workdirOid) return { path: filepath, type: "D" };
                    if (!stageOid) return { path: filepath, type: "A" };
                    if (workdirOid !== stageOid) return { path: filepath, type: "M" };
                    return null;
                },
            }));
            window.clearTimeout(timeout);
            notice?.hide();
            return res;
        } catch (error) {
            window.clearTimeout(timeout);
            notice?.hide();
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 获取 Git 配置值 - Get git config value
     */
    async getConfig(path: string): Promise<string> {
        try {
            return this.wrapFS(git.getConfig({ ...this.getRepo(), path }) as Promise<string>);
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    /**
     * 设置 Git 配置值 - Set git config value（传 undefined 则取消设置）
     */
    async setConfig(path: string, value: string | undefined): Promise<void> {
        try {
            if (value !== undefined) {
                await this.wrapFS(git.setConfig({ ...this.getRepo(), path, value }));
            } else {
                await this.wrapFS(git.setConfig({ ...this.getRepo(), path, value: undefined }));
            }
        } catch (error) {
            this.plugin.displayError(error);
            throw error;
        }
    }

    // ── 私有工具方法 - Private utility methods ────────────────────────

    /**
     * 将 statusMatrix 行转换为文件状态结果
     * Convert statusMatrix row to file status result
     */
    private getFileStatusResult(
        row: [string, 0 | 1, 0 | 1 | 2, 0 | 1 | 2 | 3]
    ): FileStatusResult {
        const status = (this.status_mapping as any)[
            `${row[this.HEAD]}${row[this.WORKDIR]}${row[this.STAGE]}`
        ] as string;
        return {
            index: status[0] == "?" ? "U" : status[0],
            workingDir: status[1] == "?" ? "U" : status[1],
            path: row[this.FILE],
            vaultPath: this.getRelativeVaultPath(row[this.FILE]),
        };
    }

    /**
     * 检查作者信息是否已配置 - Check if author info is configured
     */
    private async checkAuthorInfo(): Promise<void> {
        const name = await this.getConfig("user.name");
        const email = await this.getConfig("user.email");
        if (!name || !email) {
            throw Error("Git 提交作者名称和邮箱未设置。请在设置中填写这两项。");
        }
    }

    /**
     * 显示通知（如果未禁用） - Show notice (if not disabled)
     */
    private showNotice(message: string, infinity = true): Notice | undefined {
        if (!this.plugin.settings.disablePopups) {
            return new Notice(message, infinity ? this.noticeLength : undefined);
        }
    }

    /**
     * 格式化进度文本 - Format progress text
     */
    private getProgressText(action: string, event: GitProgressEvent): string {
        let out = `${action}进度:`;
        if (event.phase) out = `${out} ${event.phase}:`;
        if (event.loaded) {
            out = `${out} ${event.loaded}`;
            if (event.total) out = `${out}/${event.total}`;
        }
        return out;
    }
}

// ── 工具函数 - Utility functions ──────────────────────────────────────

function arrayBufferToAsyncIterator(buffer: ArrayBuffer): AsyncIterableIterator<Uint8Array> {
    return (async function* () { yield new Uint8Array(buffer); })();
}

async function asyncIteratorToArrayBuffer(iterator: AsyncIterableIterator<Uint8Array>): Promise<ArrayBuffer> {
    const stream = new ReadableStream({
        async start(controller) {
            for await (const chunk of iterator) controller.enqueue(chunk);
            controller.close();
        },
    });
    return await new Response(stream).arrayBuffer();
}
