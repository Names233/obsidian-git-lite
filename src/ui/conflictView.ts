// 冲突详情 Modal - Conflict detail Modal
// 显示冲突文件列表和冲突类型，供用户查看后手动解决
// Shows conflicted file list and conflict types for user to resolve manually

import { Modal } from "obsidian";
import type ObsidianGit from "../main";

// ── 冲突类型枚举 - Conflict type enum ────────────────────────────
export enum ConflictType {
    // 双方修改 - Both sides modified
    BothModified = "both-modified",
    // 删除冲突 - Delete/modify conflict
    DeleteConflict = "delete-conflict",
    // 添加冲突 - Both sides added
    AddConflict = "add-conflict",
    // 未知类型 - Unknown type
    Unknown = "unknown",
}

// ── 冲突文件信息 - Conflict file info ─────────────────────────────
export interface ConflictFileInfo {
    // 文件路径 - File path
    path: string;
    // 冲突类型 - Conflict type
    type: ConflictType;
}

/**
 * 冲突详情 Modal 类 - Conflict detail Modal class
 *
 * 继承 Obsidian Modal，显示冲突文件列表和冲突类型
 * Extends Obsidian Modal, shows conflicted file list and conflict types
 *
 * 使用方式 - Usage:
 *   const modal = new ConflictModal(app, plugin, conflictedFiles);
 *   modal.open();
 */
export class ConflictModal extends Modal {
    // 插件实例引用 - Plugin instance reference
    private readonly plugin: ObsidianGit;
    // 冲突文件列表 - Conflicted file list
    private readonly files: ConflictFileInfo[];

    /**
     * 构造函数 - Constructor
     *
     * @param app - Obsidian App 实例 - Obsidian App instance
     * @param plugin - 插件实例 - Plugin instance
     * @param conflictedPaths - 冲突文件路径列表 - Conflicted file path list
     */
    constructor(
        app: ConstructorParameters<typeof Modal>[0],
        plugin: ObsidianGit,
        conflictedPaths: string[],
    ) {
        super(app);
        this.plugin = plugin;
        // 将路径列表转换为带类型的冲突文件信息
        // Convert path list to conflict file info with type
        this.files = conflictedPaths.map((path) => ({
            path,
            type: ConflictType.Unknown,
        }));
    }

    /**
     * 打开 Modal - Open modal
     * 渲染冲突文件列表和操作提示
     * Renders conflicted file list and action hints
     */
    onOpen(): void {
        const { contentEl } = this;

        // ── 标题 - Title ──
        contentEl.createEl("h2", {
            text: "文件冲突详情",
            cls: "conflict-modal-title",
        });

        // ── 说明文字 - Description ──
        contentEl.createEl("p", {
            text: "以下文件存在冲突，请手动解决后重新提交。",
            cls: "conflict-modal-desc",
        });

        // ── 冲突文件列表 - Conflict file list ──
        if (this.files.length === 0) {
            // 无冲突文件时显示提示 - Show hint when no conflict files
            contentEl.createEl("p", {
                text: "没有冲突文件。",
                cls: "conflict-modal-empty",
            });
        } else {
            // 创建文件列表容器 - Create file list container
            const listEl = contentEl.createEl("ul", {
                cls: "conflict-modal-list",
            });

            // 遍历冲突文件，创建列表项 - Iterate conflict files, create list items
            for (const file of this.files) {
                const itemEl = listEl.createEl("li", {
                    cls: "conflict-modal-item",
                });

                // 文件路径 - File path
                const pathEl = itemEl.createEl("span", {
                    text: file.path,
                    cls: "conflict-modal-filepath",
                });

                // 冲突类型标签 - Conflict type badge
                const badgeEl = itemEl.createEl("span", {
                    cls: "conflict-modal-badge",
                });

                // 根据冲突类型设置标签样式和文本
                // Set badge style and text based on conflict type
                switch (file.type) {
                    case ConflictType.BothModified:
                        badgeEl.setText("双方修改");
                        badgeEl.addClass("conflict-badge-both-modified");
                        break;
                    case ConflictType.DeleteConflict:
                        badgeEl.setText("删除冲突");
                        badgeEl.addClass("conflict-badge-delete");
                        break;
                    case ConflictType.AddConflict:
                        badgeEl.setText("添加冲突");
                        badgeEl.addClass("conflict-badge-add");
                        break;
                    default:
                        badgeEl.setText("未知");
                        badgeEl.addClass("conflict-badge-unknown");
                        break;
                }
            }
        }

        // ── 操作提示 - Action hints ──
        const hintEl = contentEl.createEl("div", {
            cls: "conflict-modal-hints",
        });
        hintEl.createEl("p", {
            text: "解决冲突后，请使用以下步骤完成同步：",
        });
        const stepsEl = hintEl.createEl("ol");
        stepsEl.createEl("li", { text: "在编辑器中打开冲突文件，解决冲突标记（<<<<<<< / ======= / >>>>>>>）" });
        stepsEl.createEl("li", { text: "保存文件后，使用「提交并同步」命令重新提交" });

        // ── 关闭按钮 - Close button ──
        const buttonContainer = contentEl.createEl("div", {
            cls: "conflict-modal-buttons",
        });
        const closeBtn = buttonContainer.createEl("button", {
            text: "关闭",
            cls: "conflict-modal-close-btn",
        });
        closeBtn.addEventListener("click", () => this.close());
    }

    /**
     * 关闭 Modal - Close modal
     * 清理 DOM 内容 - Clean up DOM content
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
