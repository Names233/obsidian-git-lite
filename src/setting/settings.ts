// Git Auto Sync 设置面板 - Settings tab for Git Auto Sync plugin
// 精简为自动同步功能所需的设置项 - Simplified to auto-sync settings only

import type { App, TextComponent } from "obsidian";
import {
    Notice,
    Platform,
    PluginSettingTab,
    Setting,
    TextAreaComponent,
} from "obsidian";
import { DEFAULT_SETTINGS } from "src/types";
import { IsomorphicGit } from "src/gitManager/isomorphicGit";
import { SimpleGit } from "src/gitManager/simpleGit";
import type ObsidianGit from "src/main";
import type {
    GitAutoSyncSettings,
    SyncMethod,
} from "src/types";

// Moment.js 格式字符串参考链接 - Moment.js format string reference URL
const FORMAT_STRING_REFERENCE_URL =
    "https://momentjs.com/docs/#/parsing/string-format/";

/**
 * Git Auto Sync 设置面板类 - Git Auto Sync settings tab class
 * 提供插件配置 UI - Provides plugin configuration UI
 */
export class ObsidianGitSettingsTab extends PluginSettingTab {
    constructor(
        app: App,
        private plugin: ObsidianGit
    ) {
        super(app, plugin);
    }

    // 图标 - Icon
    icon = "git-pull-request";

    // 获取插件设置的便捷访问器 - Convenience accessor for plugin settings
    private get settings() {
        return this.plugin.settings;
    }

    /**
     * 渲染设置面板 - Render settings panel
     * 根据 Git 是否就绪显示不同内容 - Shows different content based on git readiness
     */
    display(): void {
        const { containerEl } = this;
        const plugin: ObsidianGit = this.plugin;

        // Git 是否就绪 - Whether git is ready
        const gitReady = plugin.gitReady;

        // 清空容器 - Clear container
        containerEl.empty();

        // Git 未就绪时显示提示 - Show hint when git is not ready
        if (!gitReady) {
            containerEl.createEl("p", {
                text: "Git is not ready. When all settings are correct you can configure commit-sync, etc.",
            });
            containerEl.createEl("br");
        }

        // ── 自动提交设置 - Auto commit settings ──
        if (gitReady) {
            new Setting(containerEl).setName("Automatic").setHeading();

            // 自动提交开关 - Auto commit toggle
            new Setting(containerEl)
                .setName("Enable auto commit")
                .setDesc(
                    "Automatically commit changes after the specified idle timeout."
                )
                .addToggle((toggle) =>
                    toggle
                        .setValue(plugin.settings.autoCommitEnabled)
                        .onChange(async (value) => {
                            // 更新设置并保存 - Update setting and save
                            plugin.settings.autoCommitEnabled = value;
                            await plugin.saveSettings();
                            // 重新加载自动任务 - Reload automatics
                            plugin.automaticsManager.reload("commit");
                            this.refreshDisplayWithDelay();
                        })
                );

            // 空闲超时设置 - Idle timeout setting
            let setting = new Setting(containerEl)
                .setName("Idle timeout (minutes)")
                .setDesc(
                    "Time to wait after the last file edit before auto committing. Set to 0 to disable."
                )
                .addText((text) => {
                    text.inputEl.type = "number";
                    // 仅在非默认值时显示实际值 - Show value only if non-default
                    this.setNonDefaultValue({
                        text,
                        settingsProperty: "idleTimeout",
                    });
                    text.setPlaceholder(
                        String(DEFAULT_SETTINGS.idleTimeout)
                    );
                    text.onChange(async (value) => {
                        if (value !== "") {
                            plugin.settings.idleTimeout = Number(value);
                        } else {
                            plugin.settings.idleTimeout =
                                DEFAULT_SETTINGS.idleTimeout;
                        }
                        await plugin.saveSettings();
                        plugin.automaticsManager.reload("commit");
                    });
                });
            // 自动提交禁用时灰显 - Grey out when auto commit is disabled
            this.mayDisableSetting(setting, !plugin.settings.autoCommitEnabled);
        }

        // ── 提交消息设置 - Commit message settings ──
        new Setting(containerEl).setName("Commit message").setHeading();

        // 手动提交消息模板 - Manual commit message template
        const manualCommitMessageSetting = new Setting(containerEl)
            .setName("Commit message on manual commit")
            .setDesc(
                "Available placeholders: {{date}} (see below), {{hostname}} (see below), {{numFiles}} (number of changed files in the commit) and {{files}} (changed files in commit message). Leave empty to require manual input on each commit."
            );
        manualCommitMessageSetting.addTextArea((text) => {
            manualCommitMessageSetting.addButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(
                        `Set to default: "${DEFAULT_SETTINGS.commitMessage}"`
                    )
                    .onClick(() => {
                        // 重置为默认值 - Reset to default value
                        text.setValue(DEFAULT_SETTINGS.commitMessage);
                        text.onChanged();
                    });
            });
            text.setValue(plugin.settings.commitMessage);
            text.onChange(async (value) => {
                plugin.settings.commitMessage = value;
                await plugin.saveSettings();
            });
        });

        // {{date}} 占位符格式设置 - {{date}} placeholder format setting
        const datePlaceholderSetting = new Setting(containerEl)
            .setName("{{date}} placeholder format")
            .addMomentFormat((text) =>
                text
                    .setDefaultFormat(plugin.settings.commitDateFormat)
                    .setValue(plugin.settings.commitDateFormat)
                    .onChange(async (value) => {
                        plugin.settings.commitDateFormat = value;
                        await plugin.saveSettings();
                    })
            );

        // 格式说明链接 - Format description link
        datePlaceholderSetting.descEl.createSpan({
            text: ` Specify custom date format. E.g. "${DEFAULT_SETTINGS.commitDateFormat}. See `,
        });
        datePlaceholderSetting.descEl.createEl("a", {
            text: "Moment.js documentation",
            href: FORMAT_STRING_REFERENCE_URL,
            attr: {
                target: "_blank",
            },
        });
        datePlaceholderSetting.descEl.createSpan({
            text: " for more formats.",
        });

        // {{hostname}} 占位符替换 - {{hostname}} placeholder replacement
        new Setting(containerEl)
            .setName("{{hostname}} placeholder replacement")
            .setDesc(
                "Specify custom hostname for every device. Defaults to the OS hostname if not set on desktop."
            )
            .addText((text) =>
                text
                    .setValue(plugin.localStorage.getHostname() ?? "")
                    .onChange((value) => {
                        plugin.localStorage.setHostname(value);
                    })
            );

        // 预览提交消息按钮 - Preview commit message button
        new Setting(containerEl)
            .setName("Preview commit message")
            .addButton((button) =>
                button.setButtonText("Preview").onClick(async () => {
                    const commitMessagePreview =
                        await plugin.gitManager.formatCommitMessage(
                            plugin.settings.commitMessage
                        );
                    new Notice(`${commitMessagePreview}`);
                })
            );

        // ── 拉取设置 - Pull settings ──
        new Setting(containerEl).setName("Pull").setHeading();

        // 合并策略（仅 SimpleGit） - Merge strategy (SimpleGit only)
        if (plugin.gitManager instanceof SimpleGit)
            new Setting(containerEl)
                .setName("Merge strategy")
                .setDesc(
                    "Decide how to integrate commits from your remote branch into your local branch."
                )
                .addDropdown((dropdown) => {
                    const options: Record<SyncMethod, string> = {
                        merge: "Merge",
                        rebase: "Rebase",
                        reset: "Other sync service (Only updates the HEAD without touching the working directory)",
                    };
                    dropdown.addOptions(options);
                    dropdown.setValue(plugin.settings.syncMethod);

                    dropdown.onChange(async (option: SyncMethod) => {
                        plugin.settings.syncMethod = option;
                        await plugin.saveSettings();
                    });
                });

        // 启动时自动拉取 - Auto pull on boot
        new Setting(containerEl)
            .setName("Pull on startup")
            .setDesc("Automatically pull commits when Obsidian starts.")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.autoPullOnBoot)
                    .onChange(async (value) => {
                        plugin.settings.autoPullOnBoot = value;
                        await plugin.saveSettings();
                    })
            );

        // ── 提交并同步设置 - Commit-and-sync settings ──
        new Setting(containerEl)
            .setName("Commit-and-sync")
            .setDesc(
                "Commit-and-sync with default settings means staging everything -> committing -> pulling -> pushing. Ideally this is a single action that you do regularly to keep your local and remote repository in sync."
            )
            .setHeading();

        // 推送开关 - Push toggle
        const pushSetting = new Setting(containerEl)
            .setName("Push on commit-and-sync")
            .setDesc(
                `Most of the time you want to push after committing. Turning this off turns a commit-and-sync action into commit ${plugin.settings.pullBeforePush ? "and pull " : ""}only. It will still be called commit-and-sync.`
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(!plugin.settings.disablePush)
                    .onChange(async (value) => {
                        plugin.settings.disablePush = !value;
                        this.refreshDisplayWithDelay();
                        await plugin.saveSettings();
                    })
            );

        // 拉取开关 - Pull toggle
        new Setting(containerEl)
            .setName("Pull on commit-and-sync")
            .setDesc(
                `On commit-and-sync, pull commits as well. Turning this off turns a commit-and-sync action into commit ${plugin.settings.disablePush ? "" : "and push "}only.`
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.pullBeforePush)
                    .onChange(async (value) => {
                        plugin.settings.pullBeforePush = value;
                        this.refreshDisplayWithDelay();
                        await plugin.saveSettings();
                    })
            );

        // ── 杂项设置 - Miscellaneous settings ──
        new Setting(containerEl).setName("Miscellaneous").setHeading();

        // 禁用通知 - Disable notifications
        new Setting(containerEl)
            .setName("Disable informative notifications")
            .setDesc(
                "Disable informative notifications for git operations to minimize distraction (refer to status bar for updates)."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.disablePopups)
                    .onChange(async (value) => {
                        plugin.settings.disablePopups = value;
                        this.refreshDisplayWithDelay();
                        await plugin.saveSettings();
                    })
            );

        // 禁用错误通知 - Disable error notifications
        new Setting(containerEl)
            .setName("Disable error notifications")
            .setDesc(
                "Disable error notifications of any kind to minimize distraction (refer to status bar for updates)."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(!plugin.settings.showErrorNotices)
                    .onChange(async (value) => {
                        plugin.settings.showErrorNotices = !value;
                        await plugin.saveSettings();
                    })
            );

        // 无更改时隐藏通知 - Hide notifications for no changes
        if (!plugin.settings.disablePopups)
            new Setting(containerEl)
                .setName("Hide notifications for no changes")
                .setDesc(
                    "Don't show notifications when there are no changes to commit or push."
                )
                .addToggle((toggle) =>
                    toggle
                        .setValue(plugin.settings.disablePopupsForNoChanges)
                        .onChange(async (value) => {
                            plugin.settings.disablePopupsForNoChanges = value;
                            await plugin.saveSettings();
                        })
                );

        // 显示状态栏 - Show status bar
        new Setting(containerEl)
            .setName("Show status bar")
            .setDesc(
                "Obsidian must be restarted for the changes to take affect."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.showStatusBar)
                    .onChange(async (value) => {
                        plugin.settings.showStatusBar = value;
                        await plugin.saveSettings();
                    })
            );

        // 显示分支状态栏 - Show branch status bar
        new Setting(containerEl)
            .setName("Show branch status bar")
            .setDesc(
                "Obsidian must be restarted for the changes to take affect."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.showBranchStatusBar)
                    .onChange(async (value) => {
                        plugin.settings.showBranchStatusBar = value;
                        await plugin.saveSettings();
                    })
            );

        // 状态栏显示更改文件数 - Show changed files count in status bar
        new Setting(containerEl)
            .setName("Show the count of modified files in the status bar")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.changedFilesInStatusBar)
                    .onChange(async (value) => {
                        plugin.settings.changedFilesInStatusBar = value;
                        await plugin.saveSettings();
                    })
            );

        // 自动刷新源代码管理视图 - Auto refresh source control view
        new Setting(containerEl)
            .setName(
                "Automatically refresh source control view on file changes"
            )
            .setDesc(
                "On slower machines this may cause lags. If so, just disable this option."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.refreshSourceControl)
                    .onChange(async (value) => {
                        plugin.settings.refreshSourceControl = value;
                        await plugin.saveSettings();
                    })
            );

        // 源代码管理刷新间隔 - Source control refresh interval
        new Setting(containerEl)
            .setName("Source control view refresh interval")
            .setDesc(
                "Milliseconds to wait after file change before refreshing the Source Control View."
            )
            .addText((text) => {
                const MIN_SOURCE_CONTROL_REFRESH_INTERVAL = 500;
                text.inputEl.type = "number";
                this.setNonDefaultValue({
                    text,
                    settingsProperty: "refreshSourceControlTimer",
                });
                text.setPlaceholder(
                    String(DEFAULT_SETTINGS.refreshSourceControlTimer)
                );
                text.onChange(async (value) => {
                    // 无输入或无效输入时使用默认值 - Use default if empty or invalid
                    if (value !== "" && Number.isInteger(Number(value))) {
                        plugin.settings.refreshSourceControlTimer = Math.max(
                            Number(value),
                            MIN_SOURCE_CONTROL_REFRESH_INTERVAL
                        );
                    } else {
                        plugin.settings.refreshSourceControlTimer =
                            DEFAULT_SETTINGS.refreshSourceControlTimer;
                    }
                    await plugin.saveSettings();
                    plugin.setRefreshDebouncer();
                });
            });

        // ── 认证/作者设置 - Authentication/author settings ──
        if (plugin.gitManager instanceof IsomorphicGit) {
            new Setting(containerEl)
                .setName("Authentication/commit author")
                .setHeading();
        } else {
            new Setting(containerEl).setName("Commit author").setHeading();
        }

        // 用户名（仅 IsomorphicGit） - Username (IsomorphicGit only)
        if (plugin.gitManager instanceof IsomorphicGit)
            new Setting(containerEl)
                .setName(
                    "Username on your git server. E.g. your username on GitHub"
                )
                .addText((cb) => {
                    cb.setValue(plugin.localStorage.getUsername() ?? "");
                    cb.onChange((value) => {
                        plugin.localStorage.setUsername(value);
                    });
                });

        // 密码（仅 IsomorphicGit） - Password (IsomorphicGit only)
        if (plugin.gitManager instanceof IsomorphicGit)
            new Setting(containerEl)
                .setName("Password/Personal access token")
                .setDesc(
                    "Type in your password. You won't be able to see it again."
                )
                .addText((cb) => {
                    cb.inputEl.autocapitalize = "off";
                    cb.inputEl.autocomplete = "off";
                    cb.inputEl.spellcheck = false;
                    cb.onChange((value) => {
                        plugin.localStorage.setPassword(value);
                    });
                });

        // 提交作者名 - Commit author name
        if (plugin.gitReady)
            new Setting(containerEl)
                .setName("Author name for commit")
                .addText(async (cb) => {
                    cb.setValue(
                        (await plugin.gitManager.getConfig("user.name")) ?? ""
                    );
                    cb.onChange(async (value) => {
                        await plugin.gitManager.setConfig(
                            "user.name",
                            value == "" ? undefined : value
                        );
                    });
                });

        // 提交作者邮箱 - Commit author email
        if (plugin.gitReady)
            new Setting(containerEl)
                .setName("Author email for commit")
                .addText(async (cb) => {
                    cb.setValue(
                        (await plugin.gitManager.getConfig("user.email")) ?? ""
                    );
                    cb.onChange(async (value) => {
                        await plugin.gitManager.setConfig(
                            "user.email",
                            value == "" ? undefined : value
                        );
                    });
                });

        // ── 高级设置 - Advanced settings ──
        new Setting(containerEl)
            .setName("Advanced")
            .setDesc(
                "These settings usually don't need to be changed, but may be required for special setups."
            )
            .setHeading();

        // 自定义 Git 二进制路径（仅 SimpleGit） - Custom Git binary path (SimpleGit only)
        if (plugin.gitManager instanceof SimpleGit)
            new Setting(containerEl)
                .setName("Custom Git binary path")
                .setDesc(
                    "Specify the path to the Git binary/executable. Git should already be in your PATH. Should only be necessary for a custom Git installation."
                )
                .addText((cb) => {
                    cb.setValue(plugin.localStorage.getGitPath() ?? "");
                    cb.setPlaceholder("git");
                    cb.onChange((value) => {
                        plugin.localStorage.setGitPath(value);
                        plugin.gitManager
                            .updateGitPath(value || "git")
                            .catch((e) => plugin.displayError(e));
                    });
                });

        // 自定义基础路径 - Custom base path
        new Setting(containerEl)
            .setName("Custom base path (Git repository path)")
            .setDesc(
                `
            Sets the relative path to the vault from which the Git binary should be executed.
             Mostly used to set the path to the Git repository, which is only required if the Git repository is below the vault root directory. Use "\\" instead of "/" on Windows.
            `
            )
            .addText((cb) => {
                cb.setValue(plugin.settings.basePath);
                cb.setPlaceholder("directory/directory-with-git-repo");
                cb.onChange(async (value) => {
                    plugin.settings.basePath = value;
                    await plugin.saveSettings();
                    plugin.gitManager
                        .updateBasePath(value || "")
                        .catch((e) => plugin.displayError(e));
                });
            });

        // 自定义 Git 目录路径 - Custom Git directory path
        new Setting(containerEl)
            .setName("Custom Git directory path (Instead of '.git')")
            .setDesc(
                `Corresponds to the GIT_DIR environment variable. Requires restart of Obsidian to take effect. Use "\\" instead of "/" on Windows.`
            )
            .addText((cb) => {
                cb.setValue(plugin.settings.gitDir);
                cb.setPlaceholder(".git");
                cb.onChange(async (value) => {
                    plugin.settings.gitDir = value;
                    await plugin.saveSettings();
                });
            });

        // 禁用此设备 - Disable on this device
        new Setting(containerEl)
            .setName("Disable on this device")
            .setDesc(
                "Disables the plugin on this device. This setting is not synced."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.localStorage.getPluginDisabled())
                    .onChange((value) => {
                        plugin.localStorage.setPluginDisabled(value);
                        if (value) {
                            plugin.unloadPlugin();
                        } else {
                            plugin
                                .init({ fromReload: true })
                                .catch((e) => plugin.displayError(e));
                        }
                        new Notice(
                            "Obsidian must be restarted for the changes to take affect."
                        );
                    })
            );

        // ── 支持信息 - Support section ──
        new Setting(containerEl).setName("Support").setHeading();
        new Setting(containerEl)
            .setName("Donate")
            .setDesc(
                "If you like this Plugin, consider donating to support continued development."
            )
            .addButton((bt) => {
                const link = bt.buttonEl.parentElement?.createEl("a", {
                    href: "https://ko-fi.com/F1F195IQ5",
                    attr: {
                        target: "_blank",
                    },
                });
                if (link) {
                    link.createEl("img", {
                        attr: {
                            height: "36",
                            style: "border:0px;height:36px;",
                            src: "https://cdn.ko-fi.com/cdn/kofi3.png?v=3",
                            border: "0",
                            alt: "Buy Me a Coffee at ko-fi.com",
                        },
                    });
                    bt.buttonEl.remove();
                }
            });

        // ── 调试信息 - Debug info section ──
        const debugDiv = containerEl.createDiv();
        debugDiv.setAttr("align", "center");
        debugDiv.setAttr("style", "margin: var(--size-4-2)");

        const debugButton = debugDiv.createEl("button");
        debugButton.setText("Copy Debug Information");
        debugButton.onclick = async () => {
            await window.navigator.clipboard.writeText(
                JSON.stringify(
                    {
                        settings: this.plugin.settings,
                        pluginVersion: this.plugin.manifest.version,
                    },
                    null,
                    4
                )
            );
            new Notice(
                "Debug information copied to clipboard. May contain sensitive information!"
            );
        };

        // 桌面端显示调试快捷键提示 - Show debug shortcut hint on desktop
        if (Platform.isDesktopApp) {
            const info = containerEl.createDiv();
            info.setAttr("align", "center");
            info.setText(
                "Debugging and logging:\nYou can always see the logs of this and every other plugin by opening the console with"
            );
            const keys = containerEl.createDiv();
            keys.setAttr("align", "center");
            keys.addClass("obsidian-git-shortcuts");
            if (Platform.isMacOS === true) {
                keys.createEl("kbd", { text: "CMD (⌘) + OPTION (⌥) + I" });
            } else {
                keys.createEl("kbd", { text: "CTRL + SHIFT + I" });
            }
        }
    }

    /**
     * 禁用设置项 - Disable a setting
     * @param setting - 要禁用的设置项 - Setting to disable
     * @param disable - 是否禁用 - Whether to disable
     */
    mayDisableSetting(setting: Setting, disable: boolean) {
        if (disable) {
            setting.setDisabled(disable);
            setting.setClass("obsidian-git-disabled");
        }
    }

    /**
     * 设置非默认值 - Set non-default value
     * 仅在保存值与默认值不同时显示实际值 - Only show value if different from default
     * @param settingsProperty - 设置属性名 - Settings property name
     * @param text - 文本组件 - Text component
     */
    private setNonDefaultValue({
        settingsProperty,
        text,
    }: {
        settingsProperty: keyof GitAutoSyncSettings;
        text: TextComponent | TextAreaComponent;
    }): void {
        const storedValue = this.plugin.settings[settingsProperty];
        const defaultValue = DEFAULT_SETTINGS[settingsProperty];

        if (defaultValue !== storedValue) {
            // 根据类型转换值 - Convert value based on type
            if (
                typeof storedValue === "string" ||
                typeof storedValue === "number" ||
                typeof storedValue === "boolean"
            ) {
                text.setValue(String(storedValue));
            } else {
                text.setValue(JSON.stringify(storedValue));
            }
        }
    }

    /**
     * 延迟刷新设置面板 - Delayed settings display refresh
     * 用于切换设置时的动画过渡 - Used for animation transition when toggling settings
     * @param timeout - 延迟毫秒数 - Delay in milliseconds
     */
    private refreshDisplayWithDelay(timeout = 80): void {
        window.setTimeout(() => this.display(), timeout);
    }
}
