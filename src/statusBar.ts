import { setIcon, moment } from "obsidian";
import type ObsidianGit from "./main";
import { CurrentGitAction } from "./types";

interface StatusBarMessage {
    message: string;
    timeout: number;
}

export class StatusBar {
    private messages: StatusBarMessage[] = [];
    private currentMessage: StatusBarMessage | null;
    private lastCommitTimestamp?: Date;
    private unPushedCommits?: number;
    public lastMessageTimestamp: number | null;
    private base = "obsidian-git-statusbar-";
    private iconEl: HTMLElement;
    private conflictEl: HTMLElement;
    private pausedEl: HTMLElement;
    private textEl: HTMLElement;

    constructor(
        private statusBarEl: HTMLElement,
        private readonly plugin: ObsidianGit
    ) {
        this.statusBarEl.setAttribute("data-tooltip-position", "top");

        plugin.registerEvent(
            plugin.app.workspace.on("obsidian-git:refreshed", () => {
                this.refreshCommitTimestamp().catch(console.error);
            })
        );
    }

    public displayMessage(message: string, timeout: number) {
        this.messages.push({
            message: `Git: ${message.slice(0, 100)}`,
            timeout: timeout,
        });
        this.display();
    }

    public display() {
        if (this.messages.length > 0 && !this.currentMessage) {
            this.currentMessage = this.messages.shift() as StatusBarMessage;
            this.statusBarEl.addClass(this.base + "message");
            this.statusBarEl.ariaLabel = "";
            this.statusBarEl.setText(this.currentMessage.message);
            this.lastMessageTimestamp = Date.now();
        } else if (this.currentMessage) {
            const messageAge =
                Date.now() - (this.lastMessageTimestamp as number);
            if (messageAge >= this.currentMessage.timeout) {
                this.currentMessage = null;
                this.lastMessageTimestamp = null;
            }
        } else {
            this.displayState();
        }
    }

    private displayState() {
        //Messages have to be removed before the state is set
        if (
            this.statusBarEl.getText().length > 3 ||
            !this.statusBarEl.hasChildNodes()
        ) {
            this.statusBarEl.empty();

            this.conflictEl = this.statusBarEl.createDiv();
            this.conflictEl.setAttribute("data-tooltip-position", "top");
            this.conflictEl.style.float = "left";

            this.pausedEl = this.statusBarEl.createDiv();
            this.pausedEl.setAttribute("data-tooltip-position", "top");
            this.pausedEl.style.float = "left";

            this.iconEl = this.statusBarEl.createDiv();
            this.iconEl.style.float = "left";

            this.textEl = this.statusBarEl.createDiv();
            this.textEl.style.float = "right";
            this.textEl.style.marginLeft = "5px";
        }

        if (this.plugin.localStorage.getConflict()) {
            setIcon(this.conflictEl, "alert-circle");
            this.conflictEl.ariaLabel =
                "存在合并冲突。请解决冲突后再提交。";
            this.conflictEl.style.marginRight = "5px";
            this.conflictEl.addClass(this.base + "conflict");
        } else {
            this.conflictEl.empty();
            this.conflictEl.style.marginRight = "";
        }

        if (this.plugin.localStorage.getPausedAutomatics()) {
            setIcon(this.pausedEl, "pause-circle");
            this.pausedEl.ariaLabel =
                "自动任务当前已暂停。";
            this.pausedEl.style.marginRight = "5px";
            this.pausedEl.addClass(this.base + "paused");
        } else {
            this.pausedEl.empty();
            this.pausedEl.style.marginRight = "";
        }

        switch (this.plugin.state.gitAction) {
            case CurrentGitAction.idle:
                this.displayFromNow();
                break;
            case CurrentGitAction.status:
                this.statusBarEl.ariaLabel = "正在检查仓库状态...";
                setIcon(this.iconEl, "refresh-cw");
                this.statusBarEl.addClass(this.base + "status");
                break;
            case CurrentGitAction.add:
                this.statusBarEl.ariaLabel = "正在添加文件...";
                setIcon(this.iconEl, "archive");
                this.statusBarEl.addClass(this.base + "add");
                break;
            case CurrentGitAction.commit:
                this.statusBarEl.ariaLabel = "正在提交更改...";
                setIcon(this.iconEl, "git-commit");
                this.statusBarEl.addClass(this.base + "commit");
                break;
            case CurrentGitAction.push:
                this.statusBarEl.ariaLabel = "正在推送更改...";
                setIcon(this.iconEl, "upload");
                this.statusBarEl.addClass(this.base + "push");
                break;
            case CurrentGitAction.pull:
                this.statusBarEl.ariaLabel = "正在拉取更改...";
                setIcon(this.iconEl, "download");
                this.statusBarEl.addClass(this.base + "pull");
                break;
            default:
                this.statusBarEl.ariaLabel = "初始化失败！";
                setIcon(this.iconEl, "alert-triangle");
                this.statusBarEl.addClass(this.base + "failed-init");
                break;
        }
    }

    private displayFromNow(): void {
        const timestamp = this.lastCommitTimestamp;
        const offlineMode = this.plugin.state.offlineMode;
        if (timestamp) {
            const fromNow = moment(timestamp).fromNow();
            this.statusBarEl.ariaLabel = `${
                offlineMode ? "离线: " : ""
            }上次提交: ${fromNow}`;

            if ((this.unPushedCommits ?? 0) > 0) {
                this.statusBarEl.ariaLabel += `\n(${this.unPushedCommits} 个未推送的提交)`;
            }
        } else {
            this.statusBarEl.ariaLabel = offlineMode
                ? "Git 离线"
                : "Git 就绪";
        }

        if (offlineMode) {
            setIcon(this.iconEl, "globe");
        } else {
            setIcon(this.iconEl, "check");
        }
        if (
            this.plugin.settings.changedFilesInStatusBar &&
            this.plugin.cachedStatus
        ) {
            this.textEl.setText(
                this.plugin.cachedStatus.changed.length.toString()
            );
        }
        this.statusBarEl.addClass(this.base + "idle");
    }

    private async refreshCommitTimestamp() {
        this.lastCommitTimestamp =
            await this.plugin.gitManager.getLastCommitTime();
        this.unPushedCommits =
            await this.plugin.gitManager.getUnpushedCommits();
    }

    public remove() {
        this.statusBarEl.remove();
    }
}
