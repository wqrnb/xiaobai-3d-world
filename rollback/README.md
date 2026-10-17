# 回滚备份

升级前的页面可以整页打开，也可以覆盖回网站根目录。图片、贴图脚本、音乐和 `assets/lib/three-bundle.js` 没有复制第二份，新旧版本共用。

## 只是对比

打开 [`index.legacy.html`](../index.legacy.html)。它使用：

- `assets/css/world.legacy.css`
- `assets/js/app.legacy.js`
- `assets/js/world.legacy.js`
- 同一份 `assets/js/data.js`、贴图、封面和配乐

## 把根目录换回升级前

在仓库根目录执行：

```sh
sh rollback/restore.sh
```

脚本只覆盖这四个文件：

- `index.html`
- `assets/css/world.css`
- `assets/js/app.js`
- `assets/js/world.js`

`rollback/v1/` 里是这四个文件的原始副本，并附有 `SHA256SUMS`。

## 再回到新版

备份脚本不会删除新版的 `assets/js/catalog.js` 和 `assets/js/shell.js`。若新版已经提交，在仓库根目录执行：

```sh
git checkout -- index.html assets/css/world.css assets/js/app.js assets/js/world.js
```

## 校验

```sh
node rollback/verify.mjs
```

会核对备份指纹、作品数量，以及每件作品的封面和贴图是否都还在。
