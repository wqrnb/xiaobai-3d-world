#!/bin/sh
# Restore the pre-upgrade page, stylesheet, and scripts.
# Shared images, texture scripts, music, catalog data, and three.js stay in place.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
cp rollback/v1/index.html index.html
cp rollback/v1/world.css assets/css/world.css
cp rollback/v1/app.js assets/js/app.js
cp rollback/v1/world.js assets/js/world.js
printf '%s\n' '已恢复升级前的 index.html、world.css、app.js、world.js。'
printf '%s\n' '封面、贴图、音乐、data.js 和 three.js 仍是原来的文件。'
printf '%s\n' '对比页面仍可打开 index.legacy.html。'
