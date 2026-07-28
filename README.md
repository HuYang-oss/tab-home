# tab-home

一个完全在本地运行的 Chrome 新标签页：把自定义收藏、当前窗口的标签页分组和 Chrome 书签放在同一处管理，同时保留按域名整理当前标签页的原有工作流。

本项目是对 [wolfyxbt/tab-home](https://github.com/wolfyxbt/tab-home) 的社区定制；`tab-home` 本身派生自 Zara Zhang 的 [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out)。感谢两位原作者公开源代码。本仓库继续采用 MIT License，并保留原始版权声明。

## 功能

- 三档主题：跟随系统、浅色、深色；跟随系统时会实时响应 Chrome/macOS 外观变化。
- 自定义收藏分类：分类可新增、重命名、折叠、排序和安全删除，收藏可在分类内或分类之间拖动。
- 高清收藏图标：优先网页触控图标、Manifest 图标和高分辨率 favicon，本地生成适合 Retina 显示的缓存；用户上传的图标永不被自动覆盖。
- 三种收藏来源：自定义收藏、当前窗口的 Chrome 标签页分组、完整 Chrome 书签目录树可以单独开启或同时显示；首次使用默认只显示标签页分组。
- 双向同步：标签页分组的名称、折叠、顺序和组内标签顺序，以及书签的标题、网址、目录和顺序，都可以从左栏直接修改并写回 Chrome。
- 跨来源移动：可以把单个条目拖到另一来源；扩展先创建目标，成功后才删除原收藏、书签或关闭原标签页，并在执行前明确确认。
- 紧凑自适应布局：每个分组只占实际内容需要的高度，不再固定附加一整排空白放置格。
- 零依赖、零构建、无账号、无服务器，数据保存在浏览器本地。

> Chrome 扩展公开 API 只能读取当前窗口里已经打开的标签页分组，不能读取 Chrome 菜单中“已保存但尚未打开”的分组；从菜单恢复分组后，它会自动出现在 tab-home。

## 安装

### 下载发布包

从仓库的 Releases 页面下载 `tab-home-v1.2.0.zip` 并解压，然后：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择解压后的 `tab-home-v1.2.0` 文件夹。

### 从源码安装

```bash
git clone https://github.com/HuYang-oss/tab-home.git
```

随后在 `chrome://extensions` 中选择仓库根目录。

如果你此前已经加载过本地版本，请在原目录内更新文件并在扩展管理页点击“重新加载”；保持同一个加载目录可以继续使用原扩展 ID 下的 `chrome.storage.local` 数据。

## 权限与隐私

| 权限 | 用途 |
| --- | --- |
| `tabs` | 读取标签标题和网址、定位、移动或关闭用户明确操作的标签页 |
| `tabGroups` | 展示并管理当前窗口的标签页分组 |
| `bookmarks`（可选） | 用户主动开启“书签”来源后，展示并管理 Chrome 书签 |
| `storage` | 保存自定义收藏、分类、主题、语言和界面折叠状态 |
| `contextMenus` | 从网页或链接右键菜单加入自定义收藏 |
| `favicon` | 通过 Chrome 本地图标接口获取 favicon |
| `<all_urls>` | 从收藏网站自身解析清晰图标；不向第三方图标服务上传网址 |

书签权限只在用户第一次开启“书签”来源时请求。扩展不会收集、统计、出售或上传书签、标签页、浏览记录和自定义收藏，详见 [PRIVACY.md](PRIVACY.md)。

## 数据与升级

自定义收藏继续保存在原有的 `favorites` 和 `favoriteCategories` 键中，升级不会更改网址、标题、分类、自定义图标或排序。新增的来源选择和书签文件夹折叠状态只保存在 `chrome.storage.local`；标签页分组和书签本身始终由 Chrome 管理，不会被复制为隐藏数据库。

跨来源拖动采用“移动”语义。目标创建失败时原项目保持不变；目标已创建但来源移除失败时，两份内容都会保留并显示提示。

## 开发与校验

项目使用 Manifest V3、原生 JavaScript 和 CSS，无需安装依赖或执行构建：

```bash
node --check app.js
node --check sources.js
node --check background.js
python3 -m json.tool manifest.json
```

## 致谢与许可证

- Community customization: [HuYang-oss](https://github.com/HuYang-oss)
- Based on [wolfyxbt/tab-home](https://github.com/wolfyxbt/tab-home) by [WolfyXBT](https://x.com/wolfyxbt)
- Originally forked from [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out) by [Zara Zhang](https://x.com/zarazhangrui)

MIT License，见 [LICENSE](LICENSE)。
