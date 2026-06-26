# Probe

AI 驱动的代码库分析工具。

## 安装

### macOS

**方式一：Homebrew Cask（推荐）**

```bash
# 添加自定义 tap（只需一次）
brew tap ChickmagnetL/probe https://github.com/ChickmagnetL/homebrew-probe

# 安装
brew install --cask probe
```

通过 Homebrew 安装的应用不带 macOS Gatekeeper 隔离属性，可直接打开使用。

**方式二：GitHub Release DMG**

从 [Releases](https://github.com/ChickmagnetL/Probe/releases) 下载 DMG 文件：

1. 打开 DMG，将 `Probe.app` 拖入 `/Applications`
2. 首次打开时，macOS 可能提示"应用已损坏"（Gatekeeper 限制）
3. 在终端运行以下命令修复：
   ```bash
   xattr -cr /Applications/Probe.app
   ```
4. 之后即可正常打开

### Windows

从 [Releases](https://github.com/ChickmagnetL/Probe/releases) 下载 `.exe` 安装包。

## 开发

开发指南见 [CLAUDE.md](./CLAUDE.md)。

## 许可证

MIT
