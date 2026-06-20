// AI 提交消息生成模块 - AI commit message generation module
// 调用 OpenAI 兼容 API 自动生成简洁的 commit message
// Calls OpenAI-compatible API to generate concise commit messages

import { requestUrl } from "obsidian";
import type ObsidianGit from "./main";

// ── 缓存条目 - Cache entry ───────────────────────────────────────
// 用于避免短时间内对相同 diff 重复调用 API
// Avoids repeated API calls for the same diff within a short time
interface CacheEntry {
    message: string;   // 缓存的提交消息 - Cached commit message
    timestamp: number; // 缓存创建时间戳 - Cache creation timestamp
}

// ── 缓存过期时间（毫秒） - Cache expiry time (ms) ──────────────
const CACHE_TTL_MS = 60_000; // 60 秒内相同 diff 不重复调用 - No repeat call within 60s for same diff

// ── diff 截断阈值（字节） - Diff truncation threshold (bytes) ───
const DIFF_MAX_BYTES = 3072; // 3KB，超过则截断 - Truncate if exceeds 3KB

// ── API 请求超时（毫秒） - API request timeout (ms) ─────────────
const REQUEST_TIMEOUT_MS = 10_000; // 10 秒超时 - 10 second timeout

// ── 默认回退消息模板 - Default fallback message template ─────────
const FALLBACK_TEMPLATE = "vault backup: {date}";

/**
 * AI 提交消息生成器 - AI commit message generator
 *
 * 功能特性 - Features:
 * - 调用 OpenAI 兼容 API（fetch） - Calls OpenAI-compatible API via fetch
 * - AI 自动检测语言（中文/英文） - AI auto-detects language (Chinese/English)
 * - diff 超过 3KB 时截断 - Truncates diff when exceeding 3KB
 * - 请求超时 10 秒 - 10 second request timeout
 * - 失败时 fallback 到默认消息 - Falls back to default message on failure
 * - 缓存机制：相同 diff 60 秒内不重复调用 - Cache: no repeat call within 60s for same diff
 */
export class AICommitMessageGenerator {
    // API 响应缓存 - API response cache
    private cache: CacheEntry | null = null;

    // 插件实例引用 - Plugin instance reference
    constructor(private readonly plugin: ObsidianGit) {}

    /**
     * 生成提交消息 - Generate commit message
     *
     * @param diff - git diff 字符串 - git diff string
     * @returns 生成的提交消息 - Generated commit message
     */
    async generate(diff: string): Promise<string> {
        // ── 检查缓存 - Check cache ──
        if (this.cache && Date.now() - this.cache.timestamp < CACHE_TTL_MS) {
            this.plugin.log("AI commit message: 使用缓存结果 - Using cached result");
            return this.cache.message;
        }

        // ── 读取配置 - Read config ──
        const { aiBaseUrl, aiApiKey, aiModel } = this.plugin.settings;

        // 未配置 API key 时直接回退 - Fallback directly when API key is not configured
        if (!aiApiKey) {
            this.plugin.log("AI commit message: 未配置 API key，使用默认消息 - No API key, using fallback");
            return this.getFallbackMessage();
        }

        // ── 截断 diff - Truncate diff ──
        const truncatedDiff = this.truncateDiff(diff);

        // ── 构建请求 - Build request ──
        const message = await this.callAPI(aiBaseUrl, aiApiKey, aiModel, truncatedDiff);

        // ── 缓存结果 - Cache result ──
        if (message) {
            this.cache = {
                message,
                timestamp: Date.now(),
            };
            return message;
        }

        // API 调用失败，回退到默认消息 - API call failed, fallback to default message
        return this.getFallbackMessage();
    }

    /**
     * 调用 OpenAI 兼容 API - Call OpenAI-compatible API
     *
     * @param baseUrl - API 基础 URL - API base URL
     * @param apiKey - API 密钥 - API key
     * @param model - 模型名称 - Model name
     * @param diff - 截断后的 diff - Truncated diff
     * @returns 生成的消息或 null - Generated message or null
     */
    private async callAPI(
        baseUrl: string,
        apiKey: string,
        model: string,
        diff: string,
    ): Promise<string | null> {
        try {
            // 构建 API 端点 URL - Build API endpoint URL
            // 移除末尾斜杠，拼接 chat completions 路径
            // Remove trailing slash, append chat completions path
            // 智能拼接 API 端点 - Smart API endpoint construction
            // 如果 base_url 已包含 /v1，直接加 /chat/completions
            // If base_url already contains /v1, append /chat/completions directly
            const cleanBase = baseUrl.replace(/\/+$/, "");
            const endpoint = cleanBase.endsWith("/v1")
                ? cleanBase + "/chat/completions"
                : cleanBase + "/v1/chat/completions";

            // 构建请求体 - Build request body
            const body = {
                model,
                messages: [
                    {
                        role: "system",
                        content: "Generate a concise git commit message. Use Chinese if changes contain Chinese, otherwise English. Max 72 chars. Output ONLY the commit message.",
                    },
                    {
                        role: "user",
                        content: diff,
                    },
                ],
                temperature: 0.3,
                max_tokens: 100,
            };

            this.plugin.log("AI commit message: 正在调用 API - Calling API...");

            // 使用 Obsidian requestUrl 避免 CORS 问题
            // Use Obsidian requestUrl to avoid CORS issues
            const response = await requestUrl({
                url: endpoint,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                throw: false,
            });

            // 检查响应状态 - Check response status
            if (response.status >= 400) {
                console.error(
                    `AI commit message: API 请求失败 - API request failed: ${response.status} ${response.text}`,
                );
                return null;
            }

            // 解析响应 - Parse response
            const data = response.json as {
                choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
            };

            // 提取消息内容 - Extract message content
            // MiMo 模型使用 reasoning 模式时，内容可能在 reasoning_content 中
            // MiMo model uses reasoning mode, content may be in reasoning_content
            const content = data.choices?.[0]?.message?.content?.trim() ||
                           data.choices?.[0]?.message?.reasoning_content?.trim();
            if (!content) {
                console.error("AI commit message: API 返回空内容 - API returned empty content");
                return null;
            }

            this.plugin.log("AI commit message: API 调用成功 - API call successful");
            return content;
        } catch (error) {
            // 处理请求错误 - Handle request errors
            console.error("AI commit message: API 调用出错 - API call error:", error);
            return null;
        }
    }

    /**
     * 截断 diff 到指定大小 - Truncate diff to specified size
     *
     * @param diff - 原始 diff 字符串 - Original diff string
     * @returns 截断后的 diff - Truncated diff
     */
    private truncateDiff(diff: string): string {
        // 将字符串编码为字节数组来计算大小
        // Encode string to byte array to calculate size
        const encoder = new TextEncoder();
        const bytes = encoder.encode(diff);

        // 未超过阈值则直接返回 - Return directly if under threshold
        if (bytes.length <= DIFF_MAX_BYTES) {
            return diff;
        }

        // 截断到阈值并解码回字符串 - Truncate to threshold and decode back to string
        const truncatedBytes = bytes.slice(0, DIFF_MAX_BYTES);
        const truncated = new TextDecoder().decode(truncatedBytes);

        this.plugin.log(
            `AI commit message: diff 已截断 ${bytes.length} -> ${DIFF_MAX_BYTES} bytes - Diff truncated`,
        );

        return truncated + "\n... (truncated)";
    }

    /**
     * 获取默认回退消息 - Get default fallback message
     *
     * @returns 格式化的默认消息 - Formatted default message
     */
    private getFallbackMessage(): string {
        // 使用当前日期格式化回退消息 - Format fallback message with current date
        const now = new Date();
        const dateStr = now.toISOString().replace("T", " ").substring(0, 19);
        return FALLBACK_TEMPLATE.replace("{date}", dateStr);
    }

    /**
     * 清除缓存 - Clear cache
     * 在设置变更或手动调用时使用 - Used when settings change or manually called
     */
    clearCache(): void {
        this.cache = null;
    }
}
