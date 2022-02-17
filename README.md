# koishi-plugin-meme

基于 [GIMP](https://www.gimp.org/) 的适用于 [koishi v4](https://koishi.js.org/) 机器人的梗图生成器。

## 创建模板
本插件所用梗图模板为 GIMP 生成的 XCF 文件。要制作一个梗图模板，请将在 GIMP 中照常编辑图片，但把需要替换文字的文字图层命名为 `$1` `$2` ... `$n`。注意，由于 GIMP 的限制，文字图层创建后请不要使用其他工具（比如旋转工具）修改文字图层，否则会导致修改后的文字图层无法正常替换。编辑完成后，请将 XCF 文件放入 `imgDir` 目录下。由于 xcf 文件名（不带拓展名）会作为命令的一部分，为了指令的简洁明确你可能需要重命名这些文件。完成后，可通过指令 `meme 模板文件名 $1 $2 ...` 生成梗图。

> 提示：可以使用 [teach 插件](https://koishi.js.org/plugins/teach)的插值调用功能简化梗图生成指令。

### 例子
本仓库在 [examples](./examples/) 目录下提供了几个 XCF 文件梗图模板的例子以供测试。注意：使用包管理器下载的时候不会包含这些样例文件。

## 插件配置项
这个插件无需任何配置项即可使用，同时也提供了一些可能会用到的配置项。你也可以利用 [Koishi 控制台](https://koishi.js.org/guide/console/)进行配置。

| 配置项 | 默认值 | 说明 |
| - | - | - |
| `gimpCommand` | `gimp` (Windows 下为 `gimp-console-2.10.exe`) | GIMP 命令 |
| `imgDir` | `memes` | xcf 图片所在文件夹路径 |
| `tempOut` | `temp.png` | 生成的临时图片所在的路径 |
| `authority.upload` | 2 | 在控制台添加梗图模板所需的权限等级 |
| `authority.delete` | 3 | 在控制台删除梗图模板所需的权限等级 |
 
## 运行需求
需要 koishi v4，并安装 GIMP（如果不配置 `gimpCommand` 的话，需要安装后将 `bin` 文件夹加入 `path` 环境变量）。

## 特别感谢
本插件的灵感来源于 [idlist](https://github.com/idlist) 开发的 2bot 机器人的插件 [low-high-eq](https://github.com/idlist/2bot-v3/blob/main/plugins/common/low-high-eq.js)。模板 [lheq](./examples/lheq.xcf) 即为相似功能的实现。
