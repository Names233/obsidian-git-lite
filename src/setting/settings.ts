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
                text: "Git 尚未就绪。当所有设置正确后，您可以配置提交同步等选项。",
            });
            containerEl.createEl("br");
        }

        // ── 自动提交设置 - Auto commit settings ──
        if (gitReady) {
            new Setting(containerEl).setName("自动提交").setHeading();

            // 自动提交开关 - Auto commit toggle
            new Setting(containerEl)
                .setName("启用自动提交")
                .setDesc(
                    "在指定的空闲超时后自动提交更改。"
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
                .setName("空闲超时（分钟）")
                .setDesc(
                    "最后一次文件编辑后等待多长时间自动提交。设为 0 禁用。"
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
        new Setting(containerEl).setName("提交消息").setHeading();

        // 手动提交消息模板 - Manual commit message template
        const manualCommitMessageSetting = new Setting(containerEl)
            .setName("手动提交消息模板")
            .setDesc(
                "可用占位符：{{date}}（见下方）、{{hostname}}（见下方）、{{numFiles}}（提交中更改的文件数量）和 {{files}}（提交消息中的更改文件）。留空则每次提交需要手动输入。"
            );
        manualCommitMessageSetting.addTextArea((text) => {
            manualCommitMessageSetting.addButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(
                        `重置为默认值：「${DEFAULT_SETTINGS.commitMessage}」`
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
            .setName("{{date}} 占位符格式")
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
            text: ` 指定自定义日期格式，例如 "${DEFAULT_SETTINGS.commitDateFormat}"。详见 `,
        });
        datePlaceholderSetting.descEl.createEl("a", {
            text: "Moment.js 文档",
            href: FORMAT_STRING_REFERENCE_URL,
            attr: {
                target: "_blank",
            },
        });
        datePlaceholderSetting.descEl.createSpan({
            text: " 了解更多格式。",
        });

        // {{hostname}} 占位符替换 - {{hostname}} placeholder replacement
        new Setting(containerEl)
            .setName("{{hostname}} 占位符替换")
            .setDesc(
                "为每台设备指定自定义主机名。桌面端未设置时默认使用系统主机名。"
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
            .setName("预览提交消息")
            .addButton((button) =>
                button.setButtonText("预览").onClick(async () => {
                    const commitMessagePreview =
                        await plugin.gitManager.formatCommitMessage(
                            plugin.settings.commitMessage
                        );
                    new Notice(`${commitMessagePreview}`);
                })
            );

        // ── 拉取设置 - Pull settings ──
        new Setting(containerEl).setName("拉取").setHeading();

        // 合并策略（仅 SimpleGit） - Merge strategy (SimpleGit only)
        if (plugin.gitManager instanceof SimpleGit)
            new Setting(containerEl)
                .setName("合并策略")
                .setDesc(
                    "选择如何将远程分支的 commit 合并到本地分支。"
                )
                .addDropdown((dropdown) => {
                    const options: Record<SyncMethod, string> = {
                        merge: "Merge（合并）",
                        rebase: "Rebase（变基）",
                        reset: "其他同步服务（仅更新 HEAD，不修改工作目录）",
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
            .setName("启动时自动拉取")
            .setDesc("Obsidian 启动时自动拉取 commit。")
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
            .setName("提交并同步")
            .setDesc(
                "使用默认设置的「提交并同步」意味着：暂存所有文件 → 提交 → 拉取 → 推送。理想情况下，这是您定期执行的单一操作，用于保持本地和远程仓库同步。"
            )
            .setHeading();

        // 推送开关 - Push toggle
        const pushSetting = new Setting(containerEl)
            .setName("提交并同步时推送")
            .setDesc(
                `通常提交后需要推送。关闭此选项会将「提交并同步」操作变为仅提交${plugin.settings.pullBeforePush ? "和拉取" : ""}。名称仍显示为「提交并同步」。`
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
            .setName("提交并同步时拉取")
            .setDesc(
                `提交并同步时同时拉取 commit。关闭此选项会将「提交并同步」操作变为仅提交${plugin.settings.disablePush ? "" : "和推送"}。`
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
        new Setting(containerEl).setName("其他").setHeading();

        // 禁用通知 - Disable notifications
        new Setting(containerEl)
            .setName("禁用信息通知")
            .setDesc(
                "禁用 Git 操作的信息通知以减少干扰（可参考状态栏获取更新）。"
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
            .setName("禁用错误通知")
            .setDesc(
                "禁用所有类型的错误通知以减少干扰（可参考状态栏获取更新）。"
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
                .setName("隐藏无更改通知")
                .setDesc(
                    "当没有需要提交或推送的更改时，不显示通知。"
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
            .setName("显示状态栏")
            .setDesc(
                "需要重启 Obsidian 才能使更改生效。"
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
            .setName("显示分支状态栏")
            .setDesc(
                "需要重启 Obsidian 才能使更改生效。"
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
            .setName("在状态栏显示更改文件数")
            .setDesc(
                "在状态栏中显示已修改文件的数量。"
            )
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
                "文件变更时自动刷新源代码管理视图"
            )
            .setDesc(
                "在较慢的机器上可能会导致卡顿。如有此情况，请禁用此选项。"
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
            .setName("源代码管理视图刷新间隔")
            .setDesc(
                "文件变更后刷新源代码管理视图前等待的毫秒数。"
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
                .setName("认证 / 提交作者")
                .setHeading();
        } else {
            new Setting(containerEl).setName("提交作者").setHeading();
        }

        // 用户名（仅 IsomorphicGit） - Username (IsomorphicGit only)
        if (plugin.gitManager instanceof IsomorphicGit)
            new Setting(containerEl)
                .setName(
                    "Git 服务器用户名"
                )
                .setDesc(
                    "例如您在 GitHub 上的用户名。"
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
                .setName("密码 / 个人访问令牌")
                .setDesc(
                    "输入您的密码。输入后将无法再次查看。"
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
                .setName("提交作者名称")
                .setDesc(
                    "Git 提交时使用的作者名称。"
                )
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
                .setName("提交作者邮箱")
                .setDesc(
                    "Git 提交时使用的作者邮箱。"
                )
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
            .setName("高级设置")
            .setDesc(
                "这些设置通常不需要更改，但在特殊配置下可能需要调整。"
            )
            .setHeading();

        // 自定义 Git 二进制路径（仅 SimpleGit） - Custom Git binary path (SimpleGit only)
        if (plugin.gitManager instanceof SimpleGit)
            new Setting(containerEl)
                .setName("自定义 Git 二进制路径")
                .setDesc(
                    "指定 Git 可执行文件的路径。Git 应已在系统 PATH 中。仅在自定义 Git 安装时需要设置。"
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
            .setName("自定义基础路径（Git 仓库路径）")
            .setDesc(
                `设置相对于 Vault 的路径，Git 命令将在此目录下执行。通常用于设置 Git 仓库路径，仅在 Git 仓库位于 Vault 根目录之下时需要设置。Windows 系统请使用 "\\" 代替 "/"。`
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
            .setName("自定义 Git 目录路径（替代 '.git'）")
            .setDesc(
                `对应 GIT_DIR 环境变量。需要重启 Obsidian 才能生效。Windows 系统请使用 "\\" 代替 "/"。`
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
            .setName("在此设备上禁用")
            .setDesc(
                "在此设备上禁用插件。此设置不会被同步。"
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
                            "需要重启 Obsidian 才能使更改生效。"
                        );
                    })
            );

        // ── 支持信息 - Support section ──
        new Setting(containerEl).setName("支持").setHeading();
        new Setting(containerEl)
            .setName("捐赠")
            .setDesc(
                "如果您喜欢此插件，欢迎捐赠以支持持续开发。"
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
        debugButton.setText("复制调试信息");
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
                "调试信息已复制到剪贴板。可能包含敏感信息！"
            );
        };

        // 桌面端显示调试快捷键提示 - Show debug shortcut hint on desktop
        if (Platform.isDesktopApp) {
            const info = containerEl.createDiv();
            info.setAttr("align", "center");
            info.setText(
                "调试与日志：\n您可以通过以下快捷键打开控制台，查看此插件及其他插件的日志"
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
