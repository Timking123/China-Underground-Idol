#!/bin/bash
# 整个服务持锁；业务进程降权，root只执行固定路径的发布助手。
set -euo pipefail
case "${1:-}" in
  daily|weekly|health) ;;
  *) printf '%s\n' 'unsupported-maintenance-kind' >&2; exit 64 ;;
esac
unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH PYTHONHOME NODE_OPTIONS BASH_ENV ENV
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
cd /srv/china-underground-idol/maintenance/workspace/work/phase3-20260909
/usr/sbin/runuser -u idol-maint -- /usr/bin/node --experimental-strip-types private/server/runner.ts "$1"
/usr/bin/python3 -I /usr/local/libexec/idol-maintenance-publish.py
/usr/sbin/runuser -u idol-maint -- /usr/bin/node --experimental-strip-types private/server/runner.ts publish-result
