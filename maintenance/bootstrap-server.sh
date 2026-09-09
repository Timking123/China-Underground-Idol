#!/bin/bash
# 创建专用运行账户与依赖目录；不启用定时器，不修改网站入口。
set -euo pipefail
unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH PYTHONHOME NODE_OPTIONS BASH_ENV ENV
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
test "$(/usr/bin/id -u)" = 0
BASE=/srv/china-underground-idol/maintenance
ACCOUNT_HOME=/var/lib/idol-maint

fail() { printf '%s\n' "bootstrap: $*" >&2; exit 1; }
check_root_dir() {
  local owner mode
  test -d "$1" && test ! -L "$1" || fail "不安全的父目录: $1"
  read -r owner mode < <(/usr/bin/stat -c '%u %a' -- "$1")
  test "$owner" = 0 && (( (8#$mode & 0022) == 0 )) || fail "父目录须由 root 持有且不可由其他账户写入: $1"
}
check_account_dir() {
  local owner group mode
  test -d "$1" && test ! -L "$1" || fail "不安全的账户目录: $1"
  read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$1")
  test "$owner:$group" = "$ACCOUNT_UID:$ACCOUNT_GID" && (( (8#$mode & 0022) == 0 )) || fail "账户目录归属或权限不符: $1"
  test "$1" != "$BASE" || test "$mode" = 700 || fail "工作目录须为 0700: $1"
}
# 逐层验证固定父目录；用户无法替换其下由 root 新建的叶子。
for parent in / /srv /var /var/lib; do check_root_dir "$parent"; done
if test ! -e /srv/china-underground-idol && test ! -L /srv/china-underground-idol; then
  /usr/bin/mkdir -m 0755 -- /srv/china-underground-idol
fi
check_root_dir /srv/china-underground-idol
if ! /usr/bin/getent passwd idol-maint >/dev/null; then
  for dir in "$BASE" "$ACCOUNT_HOME"; do
    test ! -e "$dir" && test ! -L "$dir" || fail "账户不存在但目录已存在: $dir"
  done
  /usr/sbin/useradd --system --user-group --no-create-home --home-dir "$ACCOUNT_HOME" --shell /usr/sbin/nologin idol-maint
fi
IFS=: read -r account_name account_password ACCOUNT_UID ACCOUNT_GID account_gecos account_home account_shell < <(/usr/bin/getent passwd idol-maint)
test "$account_name" = idol-maint && test "$account_home" = "$ACCOUNT_HOME" || fail '专用账户家目录不符'
test "$ACCOUNT_UID" -gt 0 && test "$ACCOUNT_GID" -gt 0 || fail '专用账户不得使用 root UID/GID'
for dir in "$BASE" "$ACCOUNT_HOME"; do
  if test ! -e "$dir" && test ! -L "$dir"; then
    /usr/bin/mkdir -m 0700 -- "$dir"
    # 只对刚在可信父目录创建的空叶子交付所有权，绝不递归处理用户树。
    /usr/bin/chown -- "$ACCOUNT_UID:$ACCOUNT_GID" "$dir"
  fi
  check_account_dir "$dir"
done
test "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" = 22 || fail '需要 /usr/bin/node 22'

/usr/sbin/runuser -u idol-maint -- /usr/bin/env -i HOME="$ACCOUNT_HOME" USER=idol-maint LOGNAME=idol-maint PATH=/usr/bin:/bin /bin/bash --noprofile --norc -s -- "$BASE" <<'PREPARE'
set -euo pipefail
umask 077
BASE=$1
ACCOUNT_UID=$(/usr/bin/id -u)
ACCOUNT_GID=$(/usr/bin/id -g)
fail() { printf '%s\n' "bootstrap-user: $*" >&2; exit 1; }
check_dir() {
  test -d "$1" && test ! -L "$1" || fail "不安全的目录: $1"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "$1")" = "$ACCOUNT_UID:$ACCOUNT_GID:700" || fail "目录归属或权限不符: $1"
}
check_file() {
  test -f "$1" && test ! -L "$1" || fail "不安全的文件: $1"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "$1")" = "$ACCOUNT_UID:$ACCOUNT_GID:$2" || fail "文件归属或权限不符: $1"
}
check_dir "$BASE"
test -d "$HOME" && test ! -L "$HOME" || fail '不安全的家目录'
read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$HOME")
test "$owner:$group" = "$ACCOUNT_UID:$ACCOUNT_GID" && (( (8#$mode & 0022) == 0 )) || fail '家目录归属或权限不符'
# 先验证全部已存在的入口，再创建任何文件。
for dir in "$BASE/vendor" "$BASE/workspace" "$BASE/state" "$BASE/seed" "$HOME/.ssh" "$BASE/vendor/npm"; do
  if test -e "$dir" || test -L "$dir"; then check_dir "$dir"; fi
done
for dir in "$BASE/vendor" "$BASE/workspace" "$BASE/state" "$BASE/seed" "$HOME/.ssh" "$BASE/vendor/npm"; do
  if test ! -e "$dir"; then /usr/bin/mkdir -m 0700 -- "$dir"; fi
done
for dir in "$BASE/vendor/node_modules" "$BASE/vendor/browsers"; do
  if test -e "$dir" || test -L "$dir"; then
    test -d "$dir" && test ! -L "$dir" || fail "不安全的依赖目录: $dir"
    read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$dir")
    test "$owner:$group" = "$ACCOUNT_UID:$ACCOUNT_GID" && (( (8#$mode & 0022) == 0 )) || fail "依赖目录归属或权限不符: $dir"
  fi
done
KEY="$HOME/.ssh/github-idol"
if test -e "$KEY" || test -L "$KEY"; then
  check_file "$KEY" 600
  test -f "$KEY.pub" && test ! -L "$KEY.pub" || fail '已有密钥缺少安全的公钥文件'
  read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$KEY.pub")
  test "$owner:$group" = "$ACCOUNT_UID:$ACCOUNT_GID" && [[ "$mode" = 600 || "$mode" = 644 ]] || fail '公钥归属或权限不符'
else
  test ! -e "$KEY.pub" && test ! -L "$KEY.pub" || fail '存在孤立公钥'
  /usr/bin/ssh-keygen -t ed25519 -N '' -C 'idol-server-maintenance' -f "$KEY" >/dev/null
fi
PACKAGE='{"name":"idol-server-vendor","private":true,"dependencies":{"@weibo-ai/weibo-cli":"0.9.1","playwright":"1.63.0"}}'
if test -e "$BASE/vendor/package.json" || test -L "$BASE/vendor/package.json"; then
  test -f "$BASE/vendor/package.json" && test ! -L "$BASE/vendor/package.json" || fail '不安全的依赖清单'
  read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$BASE/vendor/package.json")
  test "$owner:$group" = "$ACCOUNT_UID:$ACCOUNT_GID" && [[ "$mode" = 600 || "$mode" = 644 ]] || fail '依赖清单归属或权限不符'
  test "$(< "$BASE/vendor/package.json")" = "$PACKAGE" || fail '已有依赖清单不符，停止覆盖'
else
  (set -o noclobber; printf '%s\n' "$PACKAGE" > "$BASE/vendor/package.json")
fi
LINK="$BASE/vendor/npm/node_modules"
if test -e "$LINK" || test -L "$LINK"; then
  test -L "$LINK" && test "$(/usr/bin/readlink -- "$LINK")" = "$BASE/vendor/node_modules" || fail '已有 npm 查找路径不符'
else
  /usr/bin/ln -s -- "$BASE/vendor/node_modules" "$LINK"
fi
PREPARE

# Ubuntu 24.04 Chromium 系统依赖只通过固定系统包安装，root 不执行用户树中的 JS。
/usr/bin/apt-get install -y --no-install-recommends \
  ca-certificates fonts-liberation fonts-noto-color-emoji fonts-wqy-zenhei \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
  libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
/usr/sbin/runuser -u idol-maint -- /usr/bin/env -i HOME="$ACCOUNT_HOME" USER=idol-maint LOGNAME=idol-maint PATH=/usr/bin:/bin /bin/bash --noprofile --norc -s -- "$BASE" <<'DEPENDENCIES'
set -euo pipefail
umask 077
BASE=$1
/usr/bin/npm install --prefix "$BASE/vendor" --ignore-scripts --no-audit --no-fund
PLAYWRIGHT_BROWSERS_PATH="$BASE/vendor/browsers" /usr/bin/node "$BASE/vendor/node_modules/playwright/cli.js" install chromium
DEPENDENCIES
printf '%s\n' 'bootstrap-complete'
