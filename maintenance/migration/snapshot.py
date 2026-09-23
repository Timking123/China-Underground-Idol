"""本站一次性迁移：SQLite 在线初始副本，以及停写后同代数据库/账本包。

仅 CLI 使用生产固定路径；测试调用函数注入临时根。密钥从独立路径读取，永不进入包。
"""
from contextlib import contextmanager, closing
from datetime import datetime, timezone
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import socket
import stat
import subprocess
import sys
import time
import uuid

BASE = Path('/srv/china-underground-idol')
STAGE = BASE / 'maintenance/workspace/work/phase3-20260909'
SOURCES = {
    'console': Path('/var/lib/idol-console'),
    'state': BASE / 'maintenance/state',
    'activity': STAGE / 'private/store',
    'weekly': STAGE / 'private/weekly-runtime',
    'application': STAGE / 'private/weekly-application-v2',
    'price': STAGE / 'private/provider-price',
}
LEDGERS = ('state', 'activity', 'weekly', 'application', 'price')
KEY = Path('/etc/idol-console/master.key')
CONTROL = Path('/etc/china-underground-idol/maintenance-control.json')
TOOLS = Path('/root/idol-migration-tools-20260923')
REHEARSAL_APP = Path('/var/lib/idol-migration/console-candidate')
REHEARSALS = Path('/var/lib/idol-migration-rehearsals')


def require(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def ordinary(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'absolute_unambiguous_path_required')
    for part in [*reversed(path.parents), path]:
        st = part.lstat()
        require(not stat.S_ISLNK(st.st_mode), 'symlink_refused')
        if part == path and not directory:
            require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1, 'regular_file_required')
        else:
            require(stat.S_ISDIR(st.st_mode), 'directory_required')
    return path


def private_package_path(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts and path.is_relative_to(Path('/var/lib/idol-migration')), 'private_migration_root_required')
    return path


def write_new(path, raw):
    with path.open('xb') as stream:
        os.chmod(path, 0o600)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def inspect_database(directory, key=KEY, tools=TOOLS, node='/usr/bin/node'):
    ordinary(key)
    require(key.stat().st_size == 32, 'original_key_required')
    ordinary(tools, True)
    if os.name == 'posix':
        require(tools.stat().st_uid == 0 and tools.stat().st_mode & 0o077 == 0, 'tool_directory_not_private_root')
    manifest = json.loads(ordinary(tools / 'manifest.json').read_bytes())
    require(manifest.get('schemaVersion') == 'idol-migration-tools-v1' and set(manifest.get('files', {})) == {'verify-store.mjs', 'snapshot.py', 'verify-release.py'}, 'tool_manifest_invalid')
    for name, checksum in manifest['files'].items():
        require(sha(ordinary(tools / name).read_bytes()) == checksum, 'tool_hash_mismatch')
    result = subprocess.run([node, str(tools / 'verify-store.mjs'), '--data-dir', str(directory), '--key-file', str(key)], capture_output=True, timeout=120)
    require(result.returncode == 0, 'database_or_original_key_invalid')
    # 不复制错误输出或解密后的业务内容。
    receipt = json.loads(result.stdout)
    require(receipt.get('status') == 'verified' and receipt.get('initialized') is False, 'database_verification_invalid')
    return receipt


def online_database_copy(source, target):
    """SQLite backup 包括已提交 WAL；不复制活动 main/WAL 文件，也不导出业务 JSON。"""
    ordinary(source)
    ordinary(target.parent, True)
    write_new(target, b'')
    deadline = time.monotonic() + 90
    def progress(_status, _remaining, _total):
        require(time.monotonic() < deadline, 'snapshot_timeout_preserve_partial')
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=5)) as reader:
        with closing(sqlite3.connect(target)) as writer:
            reader.backup(writer, pages=256, sleep=0.05, progress=progress)
            require(writer.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'snapshot_integrity_failed')
            writer.execute('PRAGMA journal_mode=DELETE')
    # backup 目标正常关闭后是完整数据库；不得带未提交事务继续封口。
    require(not Path(str(target) + '-wal').exists(), 'snapshot_wal_unclosed')
    with target.open('r+b') as stream:
        os.fsync(stream.fileno())


def frozen_services():
    ordinary(CONTROL)
    for directory in [*CONTROL.parents, CONTROL]:
        info = directory.stat()
        require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'pause_not_root_controlled')
    value = json.loads(CONTROL.read_bytes())
    require(value == {'schemaVersion': 'idol-maintenance-control-v1', 'mode': 'paused'}, 'maintenance_not_paused')
    require(CONTROL.stat().st_uid == 0 and CONTROL.stat().st_mode & 0o022 == 0, 'pause_not_root_controlled')
    for kind in ('daily', 'weekly', 'health'):
        for unit in (f'idol-maintenance-{kind}.timer', f'idol-maintenance@{kind}.service'):
            result = subprocess.run(['systemctl', 'show', unit, '--property=ActiveState,UnitFileState', '--no-pager'], capture_output=True, text=True, timeout=10)
            fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
            require(result.returncode == 0 and fields.get('ActiveState') == 'inactive', 'maintenance_not_quiescent')
            if unit.endswith('.timer'):
                require(fields.get('UnitFileState') == 'disabled', 'timer_not_disabled')
    result = subprocess.run(['systemctl', 'show', 'idol-console.service', '--property=ActiveState', '--value'], capture_output=True, text=True, timeout=10)
    require(result.returncode == 0 and result.stdout.strip() == 'inactive', 'console_writer_not_stopped')
    for name in ('pending.json', 'preparing.json', '.prepare.lock'):
        require(not (SOURCES['state'] / 'publish' / name).exists(), 'pending_publication_requires_review')


@contextmanager
def production_locks():
    import fcntl
    handles = []
    try:
        for name in ('.maintenance.lock', '.release.lock'):
            target = ordinary(BASE / 'deployments' / name)
            fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
            handles.append(fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        for fd in reversed(handles):
            os.close(fd)


def inventory(root):
    ordinary(root, True)
    records = []
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            ordinary(Path(directory) / name, True)
        for name in sorted(files):
            target = ordinary(Path(directory) / name)
            records.append({'path': target.relative_to(root).as_posix(), 'sha256': sha(target.read_bytes()), 'bytes': target.stat().st_size})
    return sorted(records, key=lambda item: item['path'])


def snapshot(output, sources, *, phase, origin, verify, frozen):
    require(phase in ('initial', 'final') and origin in ('old', 'new'), 'snapshot_scope')
    output = Path(output)
    ordinary(output.parent, True)
    for source in sources.values():
        require(not output.is_relative_to(source) and not source.is_relative_to(output), 'snapshot_source_overlap')
    if phase == 'final':
        frozen()
    estimated = (sources['console'] / 'console.sqlite').stat().st_size
    wal = Path(str(sources['console'] / 'console.sqlite') + '-wal')
    if wal.exists():
        estimated += wal.stat().st_size
    if phase == 'final':
        for name in LEDGERS:
            source = sources[name]
            if name == 'price' and not source.exists():
                continue
            ordinary(source, True)
            for directory, directories, files in os.walk(source):
                for child in directories:
                    ordinary(Path(directory) / child, True)
                estimated += sum(ordinary(Path(directory) / filename).stat().st_size for filename in files)
    require(shutil.disk_usage(output.parent).free >= estimated + 128 * 1024 * 1024, 'insufficient_snapshot_space')
    # 先核验已有 key-check/账户，失败不产生看似可用的包。
    verify(sources['console'])
    output.mkdir(mode=0o700)
    write_new(output / 'intent.json', encode({'phase': phase, 'origin': origin, 'status': 'preparing'}))
    database = output / 'console'
    database.mkdir(mode=0o700)
    online_database_copy(sources['console'] / 'console.sqlite', database / 'console.sqlite')
    verified = verify(database)
    absent = []
    if phase == 'final':
        for name in LEDGERS:
            source = sources[name]
            if not source.exists() and name == 'price':
                absent.append(name)
                continue
            before = inventory(source)
            destination = output / name
            destination.mkdir(mode=0o700)
            for item in before:
                target = destination / item['path']
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                raw = ordinary(source / item['path']).read_bytes()
                require(sha(raw) == item['sha256'], 'ledger_changed_during_snapshot')
                write_new(target, raw)
            require(inventory(source) == before, 'ledger_changed_during_snapshot')
        frozen()
    files = inventory(output)
    receipt = {
        'schemaVersion': 'idol-migration-snapshot-v1', 'generation': str(uuid.uuid4()),
        'phase': phase, 'origin': origin, 'restorable': phase == 'final',
        'completedAt': datetime.now(timezone.utc).isoformat(),
        'database': verified, 'files': files, 'absent': absent,
    }
    write_new(output / 'snapshot.json', encode(receipt))
    return receipt


def validate_package(package, generation, direction, verify, *, rehearsal=False):
    ordinary(package, True)
    receipt = json.loads(ordinary(package / 'snapshot.json').read_bytes())
    require(receipt.get('schemaVersion') == 'idol-migration-snapshot-v1' and receipt.get('generation') == generation, 'snapshot_generation_mismatch')
    initial = rehearsal and receipt.get('phase') == 'initial' and receipt.get('restorable') is False
    require(initial or (receipt.get('phase') == 'final' and receipt.get('restorable') is True), 'initial_snapshot_not_restorable')
    require(receipt.get('origin') == ('new' if direction == 'reverse' else 'old'), 'reverse_snapshot_required_after_new_writes')
    actual = [item for item in inventory(package) if item['path'] != 'snapshot.json']
    require(actual == receipt['files'], 'snapshot_manifest_drift')
    require(all(item['path'] == 'intent.json' or item['path'].startswith(tuple(name + '/' for name in ('console', *LEDGERS))) for item in actual), 'snapshot_unexpected_path')
    require({item['path'] for item in actual if item['path'].startswith('console/')} == {'console/console.sqlite'}, 'snapshot_database_set')
    require(receipt.get('absent') in ([], ['price']), 'snapshot_absent_scope')
    for name in ('console', *LEDGERS):
        if initial and name != 'console':
            require(not (package / name).exists(), 'initial_snapshot_ledger_unexpected')
            continue
        if name in receipt['absent']:
            require(not (package / name).exists(), 'absent_scope_present')
            continue
        ordinary(package / name, True)
    verify(package / 'console')
    return receipt


def handoff_service_ownership(destinations):
    """仅移交本次新建且封口的树；文件先交接，目录最后交接，拒绝未知插入。"""
    import pwd
    require(os.geteuid() == 0, 'ownership_root_required')
    mappings = []
    for name, target in destinations.items():
        if not target.exists():
            continue
        user = 'idol-console' if name == 'console' else 'idol-maint'
        account = pwd.getpwnam(user)
        require(account.pw_uid != 0, 'service_account_must_not_be_root')
        before = inventory(target)
        directories = [target]
        for directory, names, _files in os.walk(target):
            directories.extend(ordinary(Path(directory) / child, True) for child in names)
        for item in before:
            filename = ordinary(target / item['path'])
            require(sha(filename.read_bytes()) == item['sha256'], 'handoff_tree_drift')
            fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fchown(fd, account.pw_uid, account.pw_gid)
                os.fchmod(fd, 0o600)
            finally:
                os.close(fd)
        for directory in sorted(directories, key=lambda value: len(value.parts), reverse=True):
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fchown(fd, account.pw_uid, account.pw_gid)
                os.fchmod(fd, 0o700)
            finally:
                os.close(fd)
        require(inventory(target) == before, 'handoff_tree_drift')
        # 实际服务 UID/GID 打开现存文件并检查目录可写；不修改业务或创建假账本。
        check = 'import os,sys;from pathlib import Path;p=Path(sys.argv[1]);assert os.access(p,os.R_OK|os.W_OK|os.X_OK);[(lambda fd:os.close(fd))(os.open(f,os.O_RDWR)) for f in p.rglob("*") if f.is_file()]'
        result = subprocess.run(['/usr/bin/python3', '-I', '-c', check, str(target)], user=account.pw_uid, group=account.pw_gid, extra_groups=[], capture_output=True, timeout=30)
        require(result.returncode == 0, 'service_identity_access_failed')
        mappings.append({'scope': name, 'account': user, 'uid': account.pw_uid, 'gid': account.pw_gid, 'accessVerified': True})
    return mappings


def restore(package, destinations, *, generation, direction, verify, frozen, receipt_path, handoff=handoff_service_ownership):
    require(direction in ('forward', 'reverse'), 'restore_direction')
    receipt = validate_package(package, generation, direction, verify)
    frozen()
    # 不覆盖任一现存数据库或账本。已有目标先由审批后的停写步骤保全并移开。
    require(all(not target.exists() and not target.is_symlink() for target in destinations.values()), 'restore_destination_exists')
    for target in destinations.values():
        ordinary(target.parent, True)
        require(not package.is_relative_to(target) and not target.is_relative_to(package), 'restore_overlap')
    require(not receipt_path.exists(), 'restore_receipt_exists')
    for name in ('console', *LEDGERS):
        if name in receipt['absent']:
            continue
        target = destinations[name]
        target.mkdir(mode=0o700)
        for item in inventory(package / name):
            destination = target / item['path']
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            write_new(destination, ordinary(package / name / item['path']).read_bytes())
        require(inventory(target) == inventory(package / name), 'restore_copy_drift')
    verify(destinations['console'])
    frozen()
    validate_package(package, generation, direction, verify)
    mappings = handoff(destinations)
    verify(destinations['console'])
    frozen()
    result = {'schemaVersion': 'idol-migration-restore-v1', 'generation': receipt['generation'], 'direction': direction, 'status': 'verified-offline', 'servicesStarted': False, 'ownership': mappings, 'completedAt': datetime.now(timezone.utc).isoformat()}
    write_new(receipt_path, encode(result))
    return result


def rehearse(package, generation, console_manifest):
    """在独立网络命名空间内以真实服务身份启动恢复副本，关闭后确认端口与原包。"""
    import pwd
    require(set(os.listdir('/sys/class/net')) == {'lo'}, 'rehearsal_requires_isolated_network')
    receipt = validate_package(package, generation, 'forward', inspect_database, rehearsal=True)
    ordinary(REHEARSALS, True)
    require(REHEARSALS.stat().st_uid == 0 and REHEARSALS.stat().st_mode & 0o022 == 0, 'rehearsal_parent_untrusted')
    target = REHEARSALS / generation
    require(not target.exists() and not target.is_symlink(), 'rehearsal_already_exists')
    # 复用后台发行包的固定白名单验证器，工具本身已由 inspect_database 核验 SHA。
    spec = importlib.util.spec_from_file_location('verify_release', TOOLS / 'verify-release.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.verify(REHEARSAL_APP, console_manifest)
    target.mkdir(mode=0o711)
    os.chmod(target, 0o711)
    app = target / 'app'
    shutil.copytree(REHEARSAL_APP, app)
    for directory, _, files in os.walk(app):
        os.chmod(directory, 0o755)
        for filename in files:
            os.chmod(Path(directory) / filename, 0o644)
    database = target / 'console'
    database.mkdir(mode=0o700)
    write_new(database / 'console.sqlite', (package / 'console/console.sqlite').read_bytes())
    inspect_database(database)
    mappings = handoff_service_ownership({'console': database})
    account = pwd.getpwnam('idol-console')
    port = 18788
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', port))
    process = subprocess.Popen(['/usr/bin/node', str(app / 'server.mjs'), 'serve', '--data-dir', str(database), '--key-file', str(KEY), '--admin-dir', str(app / 'public'), '--origin', 'https://idol.hi-veblen.com', '--port', str(port)], user=account.pw_uid, group=account.pw_gid, extra_groups=[], env={'PATH': '/usr/bin:/bin', 'NODE_ENV': 'production', 'TZ': 'Asia/Shanghai'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    statuses = []
    try:
        for _ in range(100):
            require(process.poll() is None, 'rehearsal_application_start_failed')
            try:
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
                connection.request('GET', '/admin/')
                response = connection.getresponse()
                require(response.status == 200, 'rehearsal_admin_unavailable')
                response.read(); connection.close()
                statuses.append(200)
                break
            except (ConnectionError, OSError):
                time.sleep(0.1)
        require(statuses == [200], 'rehearsal_start_timeout')
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
        connection.request('GET', '/api/v1/admin/session', headers={'X-Console-Client-IP': '192.0.2.1'})
        response = connection.getresponse()
        require(response.status == 401, 'rehearsal_auth_boundary')
        response.read(); connection.close(); statuses.append(401)
    finally:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=15)
    with socket.socket() as check:
        require(check.connect_ex(('127.0.0.1', port)) != 0, 'rehearsal_listener_not_closed')
    validate_package(package, generation, 'forward', inspect_database, rehearsal=True)
    result = {'status': 'rehearsed-offline', 'generation': generation, 'scope': 'database-only-rehearsal', 'sourcePhase': receipt['phase'], 'ownership': mappings, 'httpStatuses': statuses, 'networkIsolated': True, 'applicationStopped': True, 'sourceUnchanged': True, 'productionChanged': False}
    write_new(target / 'rehearsal.json', encode(result))
    return result


def rehearsal_launch_command(package, generation, console_manifest, tools=TOOLS):
    # sysfs 必须在独立挂载命名空间内重挂，才能让 worker 看到网络命名空间的真实网卡集合。
    isolated = '/usr/bin/mount -t sysfs sysfs /sys && /usr/sbin/ip link set lo up && test "$(/usr/bin/ls /sys/class/net)" = lo && exec "$@"'
    return ['/usr/bin/unshare', '--mount', '--net', '--propagation', 'private', '/bin/sh', '-c', isolated, 'rehearsal', '/usr/bin/python3', '-I', str(tools / 'snapshot.py'), 'rehearsal-worker', '--package', str(package), '--generation', generation, '--console-manifest-sha256', console_manifest]


def main():
    require(sys.platform.startswith('linux') and os.geteuid() == 0 and sys.flags.isolated == 1, 'isolated_root_linux_required')
    require(Path(__file__).absolute() == TOOLS / 'snapshot.py', 'fixed_installed_tool_required')
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='仅本站固定目录的一次性迁移，绝不启动服务')
    parser.add_argument('command', choices=['snapshot', 'restore', 'rehearse', 'rehearsal-worker'])
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--phase', choices=['initial', 'final'], default='final')
    parser.add_argument('--origin', choices=['old', 'new'], default='old')
    parser.add_argument('--generation')
    parser.add_argument('--direction', choices=['forward', 'reverse'], default='forward')
    parser.add_argument('--console-manifest-sha256')
    args = parser.parse_args()
    package = private_package_path(args.package)
    ordinary(package.parent, True)
    require(package.parent.stat().st_uid == 0 and package.parent.stat().st_mode & 0o077 == 0, 'migration_parent_not_private')
    if args.command in ('rehearse', 'rehearsal-worker'):
        require(args.generation and re.fullmatch(r'[a-f0-9-]{36}', args.generation) and args.console_manifest_sha256 and re.fullmatch(r'[a-f0-9]{64}', args.console_manifest_sha256), 'rehearsal_binding_required')
        if args.command == 'rehearse':
            command = rehearsal_launch_command(package, args.generation, args.console_manifest_sha256)
            completed = subprocess.run(command, capture_output=True, timeout=120)
            require(completed.returncode == 0, 'rehearsal_failed_preserve_transaction')
            print(completed.stdout.decode().strip())
            return
        result = rehearse(package, args.generation, args.console_manifest_sha256)
    elif args.command == 'snapshot' and args.phase == 'initial':
        result = snapshot(package, SOURCES, phase='initial', origin=args.origin, verify=inspect_database, frozen=frozen_services)
    else:
        with production_locks():
            if args.command == 'snapshot':
                result = snapshot(package, SOURCES, phase='final', origin=args.origin, verify=inspect_database, frozen=frozen_services)
            else:
                require(args.generation and re.fullmatch(r'[a-f0-9-]{36}', args.generation), 'generation_required')
                result = restore(package, SOURCES, generation=args.generation, direction=args.direction, verify=inspect_database, frozen=frozen_services, receipt_path=package.parent / ('restore-' + args.generation + '.json'))
    print(json.dumps({key: result[key] for key in ('generation', 'phase', 'status', 'restorable') if key in result}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if re.fullmatch(r'[a-z_]{1,90}', str(error)) else 'migration_failed_preserve_transaction'
        print(code, file=sys.stderr)
        sys.exit(1)
