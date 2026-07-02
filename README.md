# Probe

AI 驱动的代码库分析工具。导入 Codex CLI、Claude Code 等 AI 工具的会话日志，通过可视化界面浏览分析结果。

## 它能做什么

- **导入 AI 工具会话**：支持单文件、目录导入，自动扫描增量导入。当前支持 Codex CLI，后续将加入 Claude Code 等更多工具
- **对话树视图**：可视化展示 Codex 与模型的交互流程和 token 消耗
- **时间线视图**：按事件序列浏览会话中的每一步操作
- **对话视图**：以对话形式查看 Codex 与模型的完整交互内容
- **原始数据视图**：查看会话的底层 JSON 结构与字段详情
- **多会话管理**：按日期 / 项目组织会话列表，LRU 缓存详情
- **搜索与设置**：会话搜索、语言切换（中/英）、应用自动更新

<!-- TODO: 替换为实际截图/GIF -->
![Probe 界面截图](./assets/screenshot.png)

## 安装

### macOS

**方式一：Homebrew Cask（推荐）**

```bash
brew install ChickmagnetL/probe/probe
```

通过 Homebrew 安装的应用不带 macOS Gatekeeper 隔离属性，可直接打开使用。

升级时运行：

```bash
brew upgrade probe
```

卸载：

```bash
brew uninstall probe
```

**方式二：GitHub Release DMG**

从 [最新 Release](https://github.com/ChickmagnetL/Probe/releases/latest/download/Probe_aarch64.dmg) 下载 `.dmg` 文件：

1. 打开 DMG，将 `Probe.app` 拖入 `/Applications`
2. 首次打开时，macOS 可能提示"应用已损坏"（Gatekeeper 限制）
3. 在终端运行以下命令修复：
   ```bash
   xattr -cr /Applications/Probe.app
   ```
4. 之后即可正常打开

### Windows

从 [最新 Release](https://github.com/ChickmagnetL/Probe/releases/latest/download/Probe_x64-setup.exe) 下载 `.exe` 安装包。

## 文档

技术文档见 [docs/](./docs/) 目录。

## 开发

开发指南见 [CLAUDE.md](./CLAUDE.md)。

## 许可证

MIT