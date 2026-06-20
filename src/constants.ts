// 常量定义文件 - Constants definitions
// 只保留 Git Auto Sync 核心功能所需的常量

// 日期格式 - Date format
export const DATE_FORMAT = "YYYY-MM-DD";

// 冲突输出文件名 - Conflict output filename
export const CONFLICT_OUTPUT_FILE = "conflict-files-obsidian-git.md";

// Windows 默认 Git 路径 - Default Git path on Windows
export const DEFAULT_WIN_GIT_PATH = "C:\\Program Files\\Git\\cmd\\git.exe";

// AskPass 输入文件 - AskPass input file
export const ASK_PASS_INPUT_FILE = ".git_credentials_input";

// AskPass 脚本文件 - AskPass script file
export const ASK_PASS_SCRIPT_FILE = "obsidian_askpass.sh";

// AskPass 脚本内容 - AskPass script content
export const ASK_PASS_SCRIPT = `#!/bin/sh

PROMPT="$1"
TEMP_FILE="$OBSIDIAN_GIT_CREDENTIALS_INPUT"

cleanup() {
    rm -f "$TEMP_FILE" "$TEMP_FILE.response"
}
trap cleanup EXIT

echo "$PROMPT" > "$TEMP_FILE"

while [ ! -e "$TEMP_FILE.response" ]; do
    if [ ! -e "$TEMP_FILE" ]; then
        echo "Trigger file got removed: Abort" >&2
        exit 1
    fi
    sleep 0.1
done

RESPONSE=$(cat "$TEMP_FILE.response")

echo "$RESPONSE"
`;
