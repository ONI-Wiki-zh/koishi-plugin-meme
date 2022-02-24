# koishi-plugin-meme

基于 [Inkscape](https://inkscape.org/) 或 [GIMP](https://www.gimp.org/) 的适用于 [koishi v4](https://koishi.js.org/) 机器人的梗图生成器。

## 创建模板
本插件可以使用由 Inkscape 或 GIMP 创建的特殊格式的文件作为梗图模板。由于 svg/xcf 文件名（不带拓展名）会作为命令的一部分，为了指令的简洁明确你可能需要重命名模板文件。在通过 Koishi 控制台或其他方式放入 `imgDir` 目录下后，即可通过指令 `meme 模板文件名 $1 $2 ...` 生成梗图。

### Inkscape
要制作一个 Inkscape 模板，请在 Inkscape 中照常编辑图片（导入位图时请选择图片导入类型为“内嵌”），但把需要替换文字的文字元素写为 `__$1__` `__$2__` ... `__$n__`。

### GIMP
本插件所用梗图模板为 GIMP 生成的 XCF 文件。要制作一个梗图模板，请将在 GIMP 中照常编辑图片，但把需要替换文字的文字图层命名为 `$1` `$2` ... `$n`。注意，由于 GIMP 的限制，文字图层创建后请不要使用其他工具（比如旋转工具）修改文字图层，否则会导致修改后的文字图层无法正常替换。

> 提示：可以使用 [teach 插件](https://koishi.js.org/plugins/teach)的插值调用功能简化梗图生成指令。
>
> 提示2：一般认为 Inkscape 对服务器的压力更小，而且支持更多的文字编辑功能（旋转、描边、形变等）。
>
> 提示3：插件会自动根据文件后缀名匹配对应的梗图文件模板类型。如果存在同名模板，则优先使用 Inkscape 模板。可以使用选项 `-g` 强制使用 GIMP 模板。

### 例子
本仓库在 [examples](./examples/) 目录下提供了几个 SVG/XCF 文件梗图模板的例子以供测试。注意：使用包管理器下载的时候不会包含这些样例文件。

## 插件配置项
这个插件无需任何配置项即可使用，同时也提供了一些可能会用到的配置项。你也可以利用 [Koishi 控制台](https://koishi.js.org/guide/console/)进行配置。

| 配置项 | 默认值 | 说明 |
| - | - | - |
| `gimpPath` | `gimp` (Windows 下为 `gimp-console-2.10.exe`) | GIMP 命令 |
| `inkscapePath` | `inkscape` (Windows 下为 `inkscape.com`) | Inkscape 命令 |
| `imgDir` | `memes` | 梗图模板文件所在路径 |
| `tempOut` | `temp.png` | 生成的临时图片所在的路径 |
| `minInterval` | 60000 | 梗图生成命令的速率限制（毫秒） |
| `listLimit` | 10 | 聊天中显示列表时的最大长度 |
| `queueLimit` | 5 | 图片生成队列的最大长度 |
| `pendingLimit` | 20 | 待审核模板的最大数量，超出后将不允许无审核权限的用户上传新的模板 |
| `authority.upload` | 2 | 在控制台添加梗图模板所需的权限等级 |
| `authority.delete` | 3 | 在控制台删除梗图模板所需的权限等级，由当前用户上传的模板被当前用户请求删除时无需权限 |
| `authority.approve` | 3 | 审核由控制台添加的梗图模板所需的权限等级 |

### 审核机制
为了让广大使用者也能制作梗图的同时防止机器人账号因发送违规图片而被封禁，本插件引入了审核机制，使在控制台中上传的图像需要审核后方可被机器人用于生成梗图：
- 审核机制需要数据库支持，且关闭数据库后之前的未审核模板也能在群聊中使用
- 由具有审核权限的用户上传的梗图模板会自动被标记为已审核
- 具有审核权限的用户可以在群聊中使用 `meme.approve` 系列指令或在控制台通过按钮切换梗图的审核状态

## 运行需求
需要 koishi v4，并安装 GIMP（如果不配置 `gimpPath` 的话，windows 安装后需要将 `bin` 文件夹加入 `path` 环境变量）或/和 Inkscape。

## 特别感谢
本插件的灵感来源于 [idlist](https://github.com/idlist) 开发的 2bot 机器人的插件 [low-high-eq](https://github.com/idlist/2bot-v3/blob/main/plugins/common/low-high-eq.js)。模板 [lheq](./examples/lheq.xcf) 即为相似功能的实现。
