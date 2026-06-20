// 自动任务管理器 - Automatics manager
// 管理空闲超时后的自动提交功能 - Manages auto-commit after idle timeout

import { debounce } from "obsidian";
import type ObsidianGit from "./main";

export default class AutomaticsManager {
    // 空闲超时防抖器 - Idle timeout debouncer
    private idleDebouncer?: ReturnType<typeof debounce>;

    constructor(private readonly plugin: ObsidianGit) {}

    /**
     * 初始化自动任务 - Initialize automatics
     * 设置空闲超时自动提交 - Set up idle timeout auto commit
     */
    async init() {
        await this.setUpAutoCommit();
    }

    /**
     * 卸载自动任务 - Unload automatics
     * 清除所有定时器 - Clear all timers
     */
    unload() {
        this.clearIdleDebouncer();
    }

    /**
     * 重新加载自动任务 - Reload automatics
     * 当设置变更时调用 - Called when settings change
     * @param type - 要重新加载的任务类型 - Task type to reload
     */
    reload(...type: ("commit" | "push" | "pull")[]) {
        if (this.plugin.localStorage.getPausedAutomatics()) return;

        // 仅处理 commit 类型 - Only handle commit type
        if (type.contains("commit")) {
            this.clearIdleDebouncer();
            this.setUpAutoCommit();
        }
        // push 和 pull 由 commit-and-sync 流程处理 - push and pull are handled by commit-and-sync flow
    }

    /**
     * 设置空闲超时自动提交 - Set up idle timeout auto commit
     * 当启用自动提交且空闲超时 > 0 时，创建防抖器
     * Creates debouncer when auto commit is enabled and idle timeout > 0
     */
    private async setUpAutoCommit() {
        const { autoCommitEnabled, idleTimeout } = this.plugin.settings;

        // 自动提交未启用或超时为 0 时跳过 - Skip if auto commit disabled or timeout is 0
        if (!autoCommitEnabled || idleTimeout <= 0) return;

        // 将分钟转换为毫秒 - Convert minutes to milliseconds
        const timeMs = idleTimeout * 60000;

        // 创建防抖器：文件变更后等待指定时间再提交
        // Create debouncer: wait specified time after file change before committing
        this.idleDebouncer = debounce(
            () => this.doAutoCommit(),
            timeMs,
            true
        );

        // 将防抖器注册到插件，以便文件变更事件可以触发它
        // Register debouncer to plugin so file change events can trigger it
        this.plugin.autoCommitDebouncer = this.idleDebouncer;
    }

    /**
     * 执行自动提交 - Execute auto commit
     * 通过 promise 队列串行化执行 - Serialized via promise queue
     */
    private doAutoCommit(): void {
        this.plugin.promiseQueue.addTask(
            async () => {
                // 执行提交并同步 - Execute commit and sync
                await this.plugin.commitAndSync({
                    fromAutoBackup: true,
                });
                return true;
            },
            () => {
                // 保存最后自动备份时间 - Save last auto backup time
                this.plugin.localStorage.setLastAutoBackup(
                    new Date().toString()
                );
            }
        );
    }

    /**
     * 清除空闲防抖器 - Clear idle debouncer
     * @returns 是否有活跃的防抖器 - Whether there was an active debouncer
     */
    private clearIdleDebouncer(): boolean {
        if (this.idleDebouncer) {
            this.idleDebouncer.cancel();
            this.idleDebouncer = undefined;
            this.plugin.autoCommitDebouncer = undefined;
            return true;
        }
        if (this.plugin.autoCommitDebouncer) {
            this.plugin.autoCommitDebouncer.cancel();
            this.plugin.autoCommitDebouncer = undefined;
            return true;
        }
        return false;
    }
}
