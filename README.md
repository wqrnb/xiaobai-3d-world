# 小白大世界 · 3D 星空展馆

小白超白的的独立 3D 作品集。中央 LED 球面巡游、漂浮作品岛、粉色日间与深紫夜间双氛围。

线上地址：<https://wqrnb.github.io/xiaobai-3d-world/>

## 打开方式

直接双击 `index.html`。浏览网站不需要 Node.js、npm、构建工具、CDN 或网络连接。只有点击「打开原作品」或个人主页时才会访问对应平台。

全部 Three.js 与 OrbitControls、EffectComposer、UnrealBloomPass、OutputPass、RoomEnvironment 已本地合并为经典脚本 `assets/lib/three-bundle.js`，版本 r180，许可证见同目录 `THREE-LICENSE.txt`。

## 展馆内容

- 32 件小红书作品，保留原始作品链接及其完整参数。
- 42 条 B 站视频，BV 号以原始完整 URL 为准。
- 精选岛展示上述真实作品中的 6 件精选，不额外增加总作品数。
- 不含「图文整理中」占位。
- 主页互动统计为本次整理的历史快照，不自动更新，也不把本地 42 条视频误称为全部投稿。

## 交互

- 拖动旋转、滚轮缩放；手机支持触屏单指旋转与双指缩放。
- 导航和底部岛屿按钮会平滑传送视角。
- 点击球面封面或发光画框查看大图、标题、原始互动数据与外链。
- 搜索标题、分类或平台，选择结果后传送并高亮画框。
- 键盘：`/` 打开搜索，`Esc` 关闭浮层，搜索框回车选择首条结果；传送后回车打开详情。聚焦 3D 画布后可用方向键旋转、`+` / `-` 缩放。
- 音乐默认关闭，仅点击后加载本地原创 CC0 配乐。页面切到后台时自动暂停。
- 手机上支持感应视角的浏览器会显示开关；需要权限时由访客手动允许。未提供有效传感器数据时继续使用触屏。
- 支持减少动态偏好及手动暂停自动巡游。

## 设备兼容

桌面使用辉光与更高像素比，移动设备降低分辨率和粒子数量。持续低帧率会降低光效或打开完整的轻量作品网格。缺少 WebGL2、3D 初始化失败、上下文丢失时自动回退。

可直接使用 `?view=2d` 打开轻量展馆，例如 <https://wqrnb.github.io/xiaobai-3d-world/?view=2d>。实际帧率依设备而异；手机感应需要浏览器和设备提供传感器支持。

`file://` 下的 3D 贴图使用本地经典脚本加载内嵌图像，避免模块、fetch JSON 和本地画布跨源问题。画框贴图仅在进入相机视野后解码，球面使用一张含全部作品的拼接纹理。

## 内容维护

`assets/js/data.js` 中的 `window.SITE_DATA` 是单一作品目录。每项包含 `id`、`title`、`platform`、`category`、`url`、`image`、`texture`，以及原始 `likes` 或 `play` / `danmu` / `date`。

修改文字或已有作品链接时直接修改 `data.js`。替换封面时，同时更新 `assets/images/` 的展示图和 `assets/textures/` 中对应 ID 的贴图脚本；球面合集位于 `assets/textures/sphere.js`。新增/删除作品还需同步 `counts`、精选 ID、页面显示数量和球面映射列/行数。

如需从原始导出数据批量重建，可使用本地项目旁的 `tools/build.mjs`：

```powershell
cd ..\tools
npm ci
node build.mjs "你的 xhs-home 数据目录"
```

这些工具只用于作者更新已打包素材，访客与本地浏览无需运行。原始封面与资料属于创作者及相应权利人，未作为 CC0 内容重新授权；CC0 仅适用于本项目原创合成配乐。

## GitHub Pages 发布

仓库：`wqrnb/xiaobai-3d-world`，公开分支 `main`，Pages 来源为仓库根目录。首次发布：

```powershell
gh auth login
git init -b main
git add .
git commit -m "Create Xiaobai 3D portfolio world"
gh repo create xiaobai-3d-world --public --source=. --remote=origin --push
gh api repos/wqrnb/xiaobai-3d-world/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

之后更新：

```powershell
git add .
git commit -m "Update portfolio"
git push origin main
```

`.nojekyll` 保证已完成的静态文件按原样发布。服务器不保存访客数据；本地存储仅记住当前设备的日夜偏好。
