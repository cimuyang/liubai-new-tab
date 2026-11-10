# 留白标签页

极简、本地、私密的浏览器新标签页扩展，适用于 Microsoft Edge 和 Chrome。

[English](#english)

## 特点

- **自由布局**：时间、日期、搜索、天气、链接、分组，每个组件都可以拖动、缩放、显示或隐藏。带吸附、对齐线、撤销，可保存多套布局。
- **默认不联网**：没有账号、统计和后台进程。数据只存在本机。
- **即时**：网站图标读取自浏览器的本地缓存，切换分组不产生任何请求。
- **轻**：原生 HTML / CSS / JavaScript，无依赖，无构建步骤。

## 安装

1. 下载本仓库。
2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），开启「开发人员模式」。
3. 点击「加载解压缩的扩展」，选择 `liubai` 文件夹。

## 使用

| 操作 | 方法 |
|---|---|
| 打开菜单 | 在空白处点击右键 |
| 调整布局 | 长按空白处，或右键 →「编辑布局」；拖动移动，拖四角缩放，`Esc` 完成 |
| 添加链接 | 右键 →「添加链接」，或从收藏夹导入 |
| 管理链接 | 右键图标可编辑、删除；拖动排序；拖到分组名上可移动 |
| 管理分组 | 双击重命名，拖动排序，`←` `→` 切换 |
| 搜索 | 直接打字。先匹配自己的链接，否则使用浏览器的默认搜索引擎 |
| 壁纸与主题 | 右键 →「外观」 |
| 备份与恢复 | 右键 →「导入与导出」。备份是可读的 JSON 文件 |

## 隐私

留白只在你主动开启以下功能时联网，两者默认关闭：

| 功能 | 连接到 | 发送的内容 |
|---|---|---|
| 天气 | `api.open-meteo.com` | 精确到 0.1°（约 10 公里）的坐标。城市到坐标的换算在本地完成 |
| 必应壁纸 | `www.bing.com` | 无。请求不带账号信息 |

除此之外的任何外部连接，都会被扩展的内容安全策略拦截。

权限：`storage`（保存数据）、`favicon`（读取浏览器本地的网站图标）、`search`（调用默认搜索引擎）。收藏夹与必应的访问权限只在使用时申请，用完或关闭后归还。

## 致谢

天气数据来自 [Open-Meteo](https://open-meteo.com/)。

---

<a id="english"></a>

# Liubai New Tab

A minimal, local-first, private new tab extension for Microsoft Edge and Chrome. The interface is in Chinese.

## Features

- **Free layout**: clock, date, search, weather, links and groups can each be moved, resized, shown or hidden, with snapping, alignment guides, undo and saved layouts.
- **Offline by default**: no account, no analytics, no background process. Your data stays on your device.
- **Instant**: site icons come from the browser's local favicon cache, so switching groups makes no requests.
- **Light**: plain HTML / CSS / JavaScript, no dependencies, no build step.

## Install

1. Download this repository.
2. Open `edge://extensions` (or `chrome://extensions`) and turn on Developer mode.
3. Click "Load unpacked" and select the `liubai` folder.

## Usage

| Action | How |
|---|---|
| Open the menu | Right-click an empty area |
| Edit the layout | Long-press an empty area, or right-click → 编辑布局; drag to move, drag a corner to resize, `Esc` to finish |
| Add links | Right-click → 添加链接, or import from bookmarks |
| Manage links | Right-click an icon to edit or delete; drag to reorder; drop on a group name to move |
| Manage groups | Double-click to rename, drag to reorder, `←` `→` to switch |
| Search | Just type. Your own links match first; otherwise the browser's default search engine is used |
| Wallpaper and theme | Right-click → 外观 |
| Backup and restore | Right-click → 导入与导出. Backups are readable JSON files |

## Privacy

Liubai goes online only for the two features below, both off by default:

| Feature | Connects to | What is sent |
|---|---|---|
| Weather | `api.open-meteo.com` | Coordinates rounded to 0.1° (about 10 km). City lookup happens locally |
| Bing wallpaper | `www.bing.com` | Nothing. Requests carry no account information |

Any other outbound connection is blocked by the extension's content security policy.

Permissions: `storage` (save your data), `favicon` (read the browser's local site icons), `search` (use the default search engine). Access to bookmarks and Bing is requested only when used and released afterwards.

## Credits

Weather data by [Open-Meteo](https://open-meteo.com/).
