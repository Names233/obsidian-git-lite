// 触发管理器 - Trigger manager
// 替代原有 AutomaticsManager，提供多种自动同步触发方式
// Replaces AutomaticsManager, provides multiple auto-sync trigger methods
//
// 触发方式 - Trigger methods:
// 1. 空闲超时：监听 vault.modify 事件，debounce 后触发同步
//    Idle timeout: listens to vault.modify, triggers sync after debounce
// 2. 窗口失焦：监听 workspace.on('blur') 事件
//    Window blur: listens to workspace.on('blur')
// 3. 网络检测：navigator.onLine，断网时暂停触发器
//    Network detection: navigator.onLine, pauses triggers when offline
// 4. 生命周期：监听 Obsidian 应用暂停/恢复事件
//    Lifecycle: listens to Obsidian app suspend/resume events

import { debounce, type Debouncer } from "obsidian";
import type ObsidianGit from "./main";

// ── 防抖延迟（毫秒） - Debounce delay (ms) ──────────────────────
const BLUR_DEBOUNCE_MS = 5_000;    // 窗口失焦防抖 5 秒 - Window blur debounce 5s
const NETWORK_CHECK_INTERVAL_MS = 30_000; // 网络状态检查间隔 30 秒 - Network check interval 30s

export default class TriggerManager {
    // ── 内部状态 - Internal state ─────────────────────────────────
    // 空闲超时防抖器 - Idle timeout debouncer
    private idleDebouncer?: Debouncer<[], void>;
    // 窗口失焦防抖器 - Window blur debouncer
    private blurDebouncer?: Debouncer<[], void>;
    // 网络检测定时器 - Network check interval timer
    private networkCheckTimer?: number;
    // 是否已暂停 - Whether triggers are suspended
    private suspended = false;
    // 是否因断网而暂停 - Whether suspended due to network loss
    private pausedByNetwork = false;
    // 事件引用，用于卸载时清理 - Event references for cleanup on unload
    private readonly eventRefs: Array<() => void> = [];

    constructor(private readonly plugin: ObsidianGit) {}

    // ── 生命周期方法 - Lifecycle methods ──────────────────────────

    /**
     * 初始化所有触发器 - Initialize all triggers
     * 设置空闲超时、窗口失焦、网络检测和生命周期监听
     * Sets up idle timeout, window blur, network detection and lifecycle listeners
     */
    async init(): Promise<void> {
        // 设置空闲超时触发器 - Set up idle timeout trigger
        this.setUpIdleTrigger();
        // 设置窗口失焦触发器 - Set up window blur trigger
        this.setUpBlurTrigger();
        // 设置网络检测 - Set up network detection
        this.setUpNetworkDetection();
        // 设置生命周期监听 - Set up lifecycle listeners
        this.setUpLifecycleListeners();
    }

    /**
     * 卸载所有触发器 - Unload all triggers
     * 清除所有定时器和事件监听 - Clear all timers and event listeners
     */
    unload(): void {
        // 取消防抖器 - Cancel debouncers
        this.idleDebouncer?.cancel();
        this.idleDebouncer = undefined;
        this.blurDebouncer?.cancel();
        this.blurDebouncer = undefined;
        // 清除插件的防抖器引用 - Clear plugin debouncer reference
        this.plugin.autoCommitDebouncer = undefined;

        // 清除网络检测定时器 - Clear network check timer
        if (this.networkCheckTimer !== undefined) {
            window.clearInterval(this.networkCheckTimer);
            this.networkCheckTimer = undefined;
        }

        // 移除所有事件监听 - Remove all event listeners
        for (const cleanup of this.eventRefs) {
            cleanup();
        }
        this.eventRefs.length = 0;

        // 重置暂停状态 - Reset suspend state
        this.suspended = false;
        this.pausedByNetwork = false;
    }

    /**
     * 重新加载指定类型的触发器 - Reload specified trigger type
     * 当设置变更时调用 - Called when settings change
     *
     * @param type - 要重新加载的任务类型 - Task type to reload
     */
    reload(...type: ("commit" | "push" | "pull")[]): void {
        // 如果已暂停，不重新加载 - Don't reload if paused
        if (this.plugin.localStorage.getPausedAutomatics()) return;

        // 仅处理 commit 类型 - Only handle commit type
        if (type.contains("commit")) {
            // 清除并重建空闲触发器 - Clear and rebuild idle trigger
            this.idleDebouncer?.cancel();
            this.plugin.autoCommitDebouncer = undefined;
            this.setUpIdleTrigger();
        }
        // push 和 pull 由 commit-and-sync 流程处理
        // push and pull are handled by commit-and-sync flow
    }

    // ── 触发器设置方法 - Trigger setup methods ────────────────────

    /**
     * 设置空闲超时触发器 - Set up idle timeout trigger
     * 当启用自动提交且 idleTimeout > 0 时，创建防抖器
     * Creates debouncer when auto commit is enabled and idle timeout > 0
     * 文件修改事件（vault.modify）会触发此防抖器
     * File modify events (vault.modify) will trigger this debouncer
     */
    private setUpIdleTrigger(): void {
        const { autoCommitEnabled, idleTimeout } = this.plugin.settings;

        // 自动提交未启用或超时为 0 时跳过 - Skip if disabled or timeout is 0
        if (!autoCommitEnabled || idleTimeout <= 0) return;

        // 将分钟转换为毫秒 - Convert minutes to milliseconds
        const timeMs = idleTimeout * 60_000;

        // 创建防抖器：文件变更后等待指定时间再触发同步
        // Create debouncer: wait specified time after file change before triggering sync
        this.idleDebouncer = debounce(
            () => this.doCommitAndSync("idle"),
            timeMs,
            true,
        );

        // 注册到插件，以便文件变更事件可以触发它
        // Register to plugin so file change events can trigger it
        this.plugin.autoCommitDebouncer = this.idleDebouncer;
    }

    /**
     * 设置窗口失焦触发器 - Set up window blur trigger
     * 当 Obsidian 窗口失去焦点时触发同步（例如切换到其他应用）
     * Triggers sync when Obsidian window loses focus (e.g., switching to another app)
     */
    private setUpBlurTrigger(): void {
        // 创建失焦防抖器 - Create blur debouncer
        this.blurDebouncer = debounce(
            () => this.doCommitAndSync("blur"),
            BLUR_DEBOUNCE_MS,
            true,
        );

        // 监听 workspace blur 事件 - Listen to workspace blur event
        const ref = this.plugin.app.workspace.on("blur", () => {
            // 仅在自动提交启用时触发 - Only trigger when auto commit is enabled
            if (!this.plugin.settings.autoCommitEnabled) return;
            // 检查网络状态 - Check network status
            if (!this.isOnline()) return;
            this.blurDebouncer?.();
        });
        // 保存事件引用以便清理 - Save event reference for cleanup
        this.eventRefs.push(() => this.plugin.app.workspace.offref(ref));
    }

    /**
     * 设置网络状态检测 - Set up network status detection
     * 使用 navigator.onLine 检测网络，断网时暂停所有触发器
     * Uses navigator.onLine to detect network, pauses all triggers when offline
     */
    private setUpNetworkDetection(): void {
        // 初始检查网络状态 - Initial network status check
        if (!this.isOnline()) {
            this.handleNetworkLoss();
        }

        // 监听 online/offline 事件 - Listen to online/offline events
        const onOnline = () => this.handleNetworkRestore();
        const onOffline = () => this.handleNetworkLoss();
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        this.eventRefs.push(() => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        });

        // 定期检查网络状态（作为 fallback）
        // Periodically check network status (as fallback)
        this.networkCheckTimer = window.setInterval(() => {
            const online = this.isOnline();
            if (!online && !this.pausedByNetwork) {
                this.handleNetworkLoss();
            } else if (online && this.pausedByNetwork) {
                this.handleNetworkRestore();
            }
        }, NETWORK_CHECK_INTERVAL_MS);
    }

    /**
     * 设置 Obsidian 生命周期监听 - Set up Obsidian lifecycle listeners
     * 监听应用暂停/恢复事件 - Listen to app suspend/resume events
     */
    private setUpLifecycleListeners(): void {
        // 监听窗口可见性变化 - Listen to window visibility changes
        const onVisibilityChange = () => {
            if (document.hidden) {
                this.suspend();
            } else {
                this.resume();
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        this.eventRefs.push(() =>
            document.removeEventListener("visibilitychange", onVisibilityChange)
        );
    }

    // ── 核心同步方法 - Core sync method ───────────────────────────

    /**
     * 执行提交并同步 - Execute commit and sync
     * 所有触发器共用此方法 - All triggers share this method
     *
     * @param source - 触发来源，用于日志 - Trigger source, for logging
     */
    private doCommitAndSync(source: string): void {
        // 已暂停时不执行 - Don't execute when suspended
        if (this.suspended) {
            this.plugin.log(`TriggerManager: 已暂停，跳过 ${source} 触发 - Suspended, skipping ${source} trigger`);
            return;
        }

        // 通过 promise 队列串行化执行 - Serialized via promise queue
        this.plugin.promiseQueue.addTask(
            async () => {
                this.plugin.log(`TriggerManager: ${source} 触发同步 - ${source} triggered sync`);
                // 执行提交并同步 - Execute commit and sync
                await this.plugin.commitAndSync({
                    fromAutoBackup: true,
                });
                return true;
            },
            () => {
                // 保存最后自动备份时间 - Save last auto backup time
                this.plugin.localStorage.setLastAutoBackup(
                    new Date().toString(),
                );
            },
        );
    }

    // ── 网络状态处理 - Network status handling ────────────────────

    /**
     * 检查网络是否在线 - Check if network is online
     * @returns 是否在线 - Whether online
     */
    private isOnline(): boolean {
        return navigator.onLine;
    }

    /**
     * 处理网络断开 - Handle network loss
     * 暂停触发器并通知插件进入离线模式
     * Pauses triggers and notifies plugin to enter offline mode
     */
    private handleNetworkLoss(): void {
        if (this.pausedByNetwork) return;
        this.pausedByNetwork = true;
        this.plugin.log("TriggerManager: 网络断开，暂停触发器 - Network lost, pausing triggers");
        this.plugin.setPluginState({ offlineMode: true });
    }

    /**
     * 处理网络恢复 - Handle network restoration
     * 恢复触发器并通知插件退出离线模式
     * Resumes triggers and notifies plugin to exit offline mode
     */
    private handleNetworkRestore(): void {
        if (!this.pausedByNetwork) return;
        this.pausedByNetwork = false;
        this.plugin.log("TriggerManager: 网络恢复，恢复触发器 - Network restored, resuming triggers");
        this.plugin.setPluginState({ offlineMode: false });
    }

    // ── 暂停/恢复方法 - Suspend/Resume methods ───────────────────

    /**
     * 暂停所有触发器 - Suspend all triggers
     * 应用进入后台时调用 - Called when app enters background
     */
    private suspend(): void {
        if (this.suspended) return;
        this.suspended = true;
        // 取消所有待执行的防抖器 - Cancel all pending debouncers
        this.idleDebouncer?.cancel();
        this.blurDebouncer?.cancel();
        this.plugin.log("TriggerManager: 已暂停 - Suspended");
    }

    /**
     * 恢复所有触发器 - Resume all triggers
     * 应用回到前台时调用 - Called when app returns to foreground
     */
    private resume(): void {
        if (!this.suspended) return;
        this.suspended = false;
        this.plugin.log("TriggerManager: 已恢复 - Resumed");
    }
}
