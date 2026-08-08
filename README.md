# IPTVScraper

> 一个基于 Playwright 的智能 IPTV 数据采集工具，专为抓取动态网页内容设计

[![Python Version](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Playwright](https://img.shields.io/badge/Playwright-1.40+-green.svg)](https://playwright.dev/)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)

## 📖 简介

IPTVScraper 是一个强大的异步网页爬虫框架，专门用于采集 IPTV 频道数据。它通过 Playwright 驱动 Chromium 浏览器，自动绕过网站反爬机制，模拟真实用户行为进行数据抓取。

### 核心特性

- 🚀 **完全异步架构** - 基于 `asyncio` 实现高并发采集
- 🛡️ **深度反爬绕过** - 自动注入伪装脚本，规避 `webdriver` 检测
- 🎯 **智能动作编排** - 通过 YAML 配置文件灵活定义采集流程
- 📋 **多格式输出** - 支持 CSV 和 SQLite 数据库存储
- 🔄 **自动翻页处理** - 内置 XHR 翻页检测与等待机制
- 🌐 **多标签页并发** - 支持同时处理多个详情页任务
- 🛠️ **可扩展设计** - 支持自定义下载处理器和动作扩展

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     YAML 配置文件                          │
│  (steps: navigate → interact → dispatch → extract)        │
└────────────────────┬──────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  AntiDetectScraper                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ▪ 反爬伪装注入                                    │   │
│  │  ▪ 异步并发控制 (Semaphore + 冷却锁)              │   │
│  │  ▪ 步骤编排引擎                                   │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────┬──────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Playwright Chromium 浏览器实例                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  标签页1  │  │  标签页2  │  │  标签页3  │  ...         │
│  └──────────┘  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    数据输出层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  CSV文件 │  │ SQLite   │  │ 自定义   │               │
│  └──────────┘  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 环境要求

- Python 3.8+
- 最新版 Chromium（Playwright 自动安装）

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/IPTVScraper.git
cd IPTVScraper

# 安装依赖
pip install -r requirements.txt

# 安装 Playwright 浏览器
playwright install chromium
```

### 配置

创建 `config.yaml` 文件，定义采集流程：

```yaml
stealth_settings:
  user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
  viewport: { width: 1920, height: 1080 }

max_concurrent_tabs: 3

steps:
  - name: "访问主页"
    action_type: "navigate"
    url: "https://iptv.example.com"

  - name: "点击下载按钮"
    action_type: "interact"
    interactions:
      - type: "click"
        selector: "#download-btn"
        wait_after: 2

  - name: "提取频道列表"
    action_type: "extract_table"
    table_selector: "table.iptv-table"
    csv_output: "iptv_channels.csv"
```

### 运行

```bash
python IPTVScraper.py
```

## 📁 项目结构

```
IPTVScraper/
├── IPTVScraper.py          # 主程序文件
├── config.yaml             # 配置文件（需自行创建）
├── iptv_data.db            # SQLite 数据库（自动生成）
├── .logs/                  # 下载文件存储目录
└── requirements.txt        # 依赖列表
```

## 🔧 核心组件说明

### 1. 动作类型 (Action Types)

| 类型 | 描述 | 配置示例 |
|------|------|----------|
| `navigate` | 页面导航 | `url: "https://example.com"` |
| `interact` | 交互操作 | 点击、选择、下载等 |
| `dispatch_tabs` | 多标签分发 | 批量处理列表中的链接 |
| `extract_table` | 表格提取 | 解析 HTML 表格并保存 |

### 2. 反爬机制

- **webdriver 属性抹除** - 删除 `navigator.webdriver` 标识
- **Chrome 对象模拟** - 伪造 `window.chrome` 对象
- **Plugin 数组伪装** - 模拟真实浏览器插件列表
- **User-Agent 轮换** - 支持自定义 UA
- **访问冷却机制** - 内置 `CooledLock` 控制请求频率

### 3. 并发控制

```python
# 最大并发标签页数（通过 YAML 配置）
max_concurrent_tabs: 3

# 冷却锁：每10次请求强制等待15秒
self.single_lock = CooledLock(delay=1.5, group=10)
```

## 🛠️ 扩展开发

### 自定义下载处理器

在 `AntiDetectScraper` 类中添加方法，并在配置中引用：

```python
def custom_process_download(self, page, context, step, **kwargs):
    """
    自定义下载 URL 处理逻辑
    返回值将更新 kwargs 中的 download_url 和 item_id
    """
    original_url = kwargs.get('download_url')
    # 修改 URL 逻辑...
    return {'download_url': new_url, 'item_id': new_id}
```

配置中引用：

```yaml
- type: "download"
  selector: "a.download-link"
  custom_rules:
    - action: "custom_process_download"
  save_prefix: "mylist"
```

## 📊 数据输出

### CSV 格式
自动生成带 UTF-8 BOM 的 CSV 文件，兼容 Excel 打开。

### SQLite 数据库
数据自动写入 `iptv_data.db` 的 `iptv_result` 表。

## ⚠️ 注意事项

1. **合法使用** - 请遵守目标网站的 robots.txt 和服务条款
2. **请求频率** - 建议保持合理的请求间隔，避免对服务器造成压力
3. **错误处理** - 程序内置重试机制，异常时会自动截图（需取消注释）
4. **环境变量** - 可通过环境变量配置代理等参数

## 🐛 故障排查

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 页面加载超时 | 增加 `timeout` 参数或检查网络连接 |
| 反爬检测触发 | 更新 `stealth_settings` 中的 UA 和伪装脚本 |
| 下载文件失败 | 检查 `custom_rules` 配置是否正确 |
| 数据库写入失败 | 确保 `iptv_data.db` 有写入权限 |

### 调试模式

取消代码中的注释可以启用详细日志：

```python
# 启用截图调试
await new_page.screenshot(path=f".logs/error_{item_id}.png")

# 启用详细打印
print(f"[DEBUG] 当前页面URL: {page.url}")
```

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

⭐ 如果这个项目对你有帮助，请给个 Star 支持一下！
