#!/bin/bash
# 仅配置专用账户对本站仓库的部署密钥；已有不同配置须人工核对。
set -euo pipefail
unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH PYTHONHOME NODE_OPTIONS BASH_ENV ENV
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
test "$(/usr/bin/id -u)" = 0
fail() { printf '%s\n' "configure-git: $*" >&2; exit 1; }
for dir in / /var /var/lib; do
  test -d "$dir" && test ! -L "$dir" || fail "不安全的父目录: $dir"
  read -r owner mode < <(/usr/bin/stat -c '%u %a' -- "$dir")
  test "$owner" = 0 && (( (8#$mode & 0022) == 0 )) || fail "父目录归属或权限不符: $dir"
done
IFS=: read -r account_name account_password account_uid account_gid account_gecos account_home account_shell < <(/usr/bin/getent passwd idol-maint)
test "$account_name" = idol-maint && test "$account_home" = /var/lib/idol-maint || fail '专用账户家目录不符'
test "$account_uid" -gt 0 && test "$account_gid" -gt 0 || fail '专用账户不得使用 root UID/GID'
test -d "$account_home" && test ! -L "$account_home" || fail '不安全的家目录'
read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$account_home")
test "$owner:$group" = "$account_uid:$account_gid" && (( (8#$mode & 0022) == 0 )) || fail '家目录归属或权限不符'

# root 不打开、写入、chmod 或 chown 用户的 .ssh 子树。
/usr/sbin/runuser -u idol-maint -- /usr/bin/env -i HOME="$account_home" USER=idol-maint LOGNAME=idol-maint PATH=/usr/bin:/bin /bin/bash --noprofile --norc -s <<'CONFIGURE'
set -euo pipefail
umask 077
DIR="$HOME/.ssh"
ACCOUNT_UID=$(/usr/bin/id -u)
ACCOUNT_GID=$(/usr/bin/id -g)
fail() { printf '%s\n' "configure-git-user: $*" >&2; exit 1; }
check_file() {
  test -f "$1" && test ! -L "$1" || fail "不安全的文件: $1"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "$1")" = "$ACCOUNT_UID:$ACCOUNT_GID:600" || fail "文件归属或权限不符: $1"
}
for dir in "$HOME" "$DIR"; do
  test -d "$dir" && test ! -L "$dir" || fail "不安全的目录: $dir"
  read -r owner group mode < <(/usr/bin/stat -c '%u %g %a' -- "$dir")
  test "$owner:$group" = "$ACCOUNT_UID:$ACCOUNT_GID" && (( (8#$mode & 0022) == 0 )) || fail "目录归属或权限不符: $dir"
  test "$dir" != "$DIR" || test "$mode" = 700 || fail '.ssh 权限须为 0700'
done
check_file "$DIR/github-idol"
HOST_KEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
CONFIG='Host github.com
  HostName github.com
  User git
  IdentityFile /var/lib/idol-maint/.ssh/github-idol
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  HostKeyAlgorithms ssh-ed25519'
# 先核对两个目标，任何冲突都在写入和 Git 联网前停止。
for name in known_hosts config; do
  if test -e "$DIR/$name" || test -L "$DIR/$name"; then
    check_file "$DIR/$name"
    expected=$HOST_KEY
    if test "$name" = config; then expected=$CONFIG; fi
    test "$(< "$DIR/$name")" = "$expected" || fail "已有 $name 内容不符，停止覆盖"
  fi
done
if test ! -e "$DIR/known_hosts"; then
  (set -o noclobber; printf '%s\n' "$HOST_KEY" > "$DIR/known_hosts")
fi
if test ! -e "$DIR/config"; then
  (set -o noclobber; printf '%s\n' "$CONFIG" > "$DIR/config")
fi
/usr/bin/git ls-remote git@github.com:Timking123/China-Underground-Idol.git refs/heads/main
CONFIGURE
