"""本站一次性迁移收据生产者；只准备记录，不发布、不运行维护。"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

# 安装时与已审发布器分开复制；不从服务账户可写仓库导入 root 代码。
PUBLISHER = Path('/usr/local/libexec/idol-maintenance-publish.py')
TOOLS = Path('/root/idol-migration-tools-20260923')
BASE = Path('/srv/china-underground-idol')
EVIDENCE = Path('/var/lib/idol-migration/c2-20260924')
ANCHOR = 'bff57aa5d71e30b99cf66ee3094d6c5ac4973808'
ANCHOR_TREE = 'c8b24895d1a103cdbaa194cd591bdeb3f8e66969'
BASE_SHA = '817ed1c210c8f59a47d171cec18b6730b5aa8220'
PUBLIC_COUNT = 5399
OLD_COUNT = 1196
MANIFEST = '2b920b6adaf9321df529371949cada8d7766d5622fdc1bdd88697860c96208d2'
OLD_MANIFEST = '9cd4ed5cfe5065d49f7df52f29a27582d47b094c4133c0ff4c34708f79455ef6'
CONFIG_SHA = '13823b2105ab093d9e1ad0d33a8d28c40182e377d31b276d0dd3ca418cc8e411'
BROWSER_SHA = '5cea3135f6f685a12362b7464bbb8bbc33cc084e87e6ae6230a8b5cbd61b2622'
PROBE_SHA = '4bb339a5624eaa20af669ff9ace26a1db285acc115de8ccc6015a9aa781d2aa6'
PUBLISHER_SHA = '3187ad8e0656ab6050c0cd98cef516ed261092c231735ca693bb56e6d6744e65'
ORIGIN = 'https://github.com/Timking123/China-Underground-Idol.git'
PREVIOUS = 'releases/console-20260918-817ed1c210c8'
RECEIPT_CHANGES = {'maintenance/migration/receipt.py', 'maintenance/migration/test_receipt.py', 'maintenance/migration/README.md'}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def checked_path(path, *, owners=(0,), directory=False, private=False):
    """所有现有祖先无链接/组他写；仅明确的数据树允许服务账户持有。"""
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'path_not_absolute')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'path_link')
        require(stat.S_ISDIR(info.st_mode) if item != path or directory else stat.S_ISREG(info.st_mode), 'path_type')
        if os.name == 'posix':
            require(info.st_uid in owners and info.st_mode & 0o022 == 0, 'path_permissions')
    info = path.lstat()
    require(directory or info.st_nlink == 1, 'path_hardlink')
    if private and os.name == 'posix':
        require(info.st_uid == 0 and info.st_mode & 0o077 == 0, 'path_not_private')
    return path


def load_publisher(path=PUBLISHER):
    checked_path(path)
    import hashlib
    require(hashlib.sha256(path.read_bytes()).hexdigest() == PUBLISHER_SHA, 'publisher_identity')
    spec = importlib.util.spec_from_file_location('idol_migration_publisher', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(repo, *args):
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/var/lib/idol-maint', 'LANG': 'C',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_NO_LAZY_FETCH': '1', 'GIT_OPTIONAL_LOCKS': '0'}
    command = ['/usr/sbin/runuser', '-u', 'idol-maint', '--', '/usr/bin/git',
               '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
               '-c', 'credential.helper=', '-C', str(repo), *args]
    return subprocess.check_output(command, env=env, timeout=30).decode().strip()


def git_evidence(repo, run=git):
    refs = {name: run(repo, 'rev-parse', name) for name in ('HEAD', 'main', 'origin/main')}
    head = refs['HEAD']
    require(re.fullmatch('[a-f0-9]{40}', head) and set(refs.values()) == {head}, 'git_refs')
    require(run(repo, 'branch', '--show-current') == 'main', 'git_branch')
    require(run(repo, 'remote', 'get-url', 'origin') == ORIGIN, 'git_origin')
    require(not run(repo, 'status', '--porcelain=v1', '-uall'), 'git_dirty')
    tree = run(repo, 'rev-parse', 'HEAD^{tree}')
    require(run(repo, 'write-tree') == tree, 'git_index')
    require(run(repo, 'rev-parse', ANCHOR + '^{tree}') == ANCHOR_TREE, 'git_anchor_tree')
    if head != ANCHOR:
        require(run(repo, 'merge-base', '--is-ancestor', ANCHOR, head) == '', 'git_anchor_ancestry')
        changes = set(run(repo, 'diff', '--name-only', ANCHOR, head).splitlines())
        require(changes and changes <= RECEIPT_CHANGES, 'git_non_receipt_changes')
    missing = run(repo, 'rev-list', '--objects', '--missing=print', 'HEAD')
    require(not any(line.startswith('?') for line in missing.splitlines()), 'git_missing_objects')
    remote = run(repo, 'ls-remote', '--exit-code', ORIGIN, 'refs/heads/main')
    require(remote == head + '\trefs/heads/main', 'git_remote_drift')
    require(head != BASE_SHA, 'base_equals_new')
    return {'head': head, 'tree': tree, 'remote': remote, 'anchor': ANCHOR}


@contextmanager
def locks(base):
    import fcntl
    handles = []
    try:
        for name in ('.maintenance.lock', '.release.lock'):
            path = checked_path(base / 'deployments' / name, private=True)
            info = path.lstat()
            require(info.st_size == 0, 'lock_not_empty')
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            handles.append((fd, path, info.st_dev, info.st_ino))
            require(os.fstat(fd).st_ino == info.st_ino, 'lock_drift')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def unchanged():
            for fd, path, device, inode in handles:
                info = path.lstat()
                require(info.st_dev == device and info.st_ino == inode and info.st_size == 0 and
                        stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o077 == 0, 'lock_drift')
        yield unchanged
        unchanged()
    finally:
        for fd, *_ in handles:
            os.close(fd)


def no_pending(p, state, run_id):
    if state.exists() or state.is_symlink():
        checked_path(state, owners=(0, 995), directory=True)
        for parent in (state / 'publish', state / 'publish/verified'):
            if parent.exists() or parent.is_symlink():
                checked_path(parent, owners=(0, 995), directory=True)
        for name in ('pending.json', 'preparing.json', '.prepare.lock', 'verified/' + run_id + '.json'):
            path = state / 'publish' / name
            require(not path.exists() and not path.is_symlink(), 'publication_already_exists')


def collect(p, run_id, *, base=BASE, evidence=EVIDENCE, config=None, probe=None, run_git=git):
    """所有校验完成才返回可序列化内容；CLI 不暴露替代根或假验证参数。"""
    require(re.fullmatch(r'migration-20260924-[a-z0-9-]{1,48}', run_id), 'run_id')
    config = config or Path('/etc/nginx/sites-available/idol.hi-veblen.com.conf')
    probe = probe or evidence / 'c5-browser-probe.mjs'
    p.require(p.maintenance_mode() == 'paused', 'maintenance_not_paused')
    checked_path(base, directory=True)
    repo = base / 'maintenance/repo'
    checked_path(repo, owners=(0, 995), directory=True)
    no_pending(p, base / 'maintenance/state', run_id)
    source = repo / '.build/site'
    git_record = git_evidence(repo, run_git)
    raw, entries = p.verify_site(source, MANIFEST, PUBLIC_COUNT)
    old_raw, _ = p.verify_site(base / PREVIOUS, OLD_MANIFEST, OLD_COUNT, allow_previous=True)
    current = base / 'current'
    require(current.is_symlink() and os.readlink(current) == PREVIOUS, 'current_drift')
    require(current.lstat().st_uid == 0 if os.name == 'posix' else True, 'current_owner')
    config_raw = p.read_regular(checked_path(config))
    require(p.digest(config_raw) == CONFIG_SHA, 'config_drift')
    browser_path = checked_path(evidence / 'c5-site-browser-verification-v5.json')
    browser_raw = p.read_regular(browser_path)
    require(p.digest(browser_raw) == BROWSER_SHA, 'browser_evidence_hash')
    browser = json.loads(browser_raw)
    require(browser.get('status') == 'passed' and browser.get('workerExit') == 0 and
            browser.get('uid') == 995 and browser.get('published') is False and
            browser.get('manifestSha256') == MANIFEST and len(browser.get('checks', [])) == 19 and
            browser.get('errors') == [] and browser.get('externalRequests') == [] and
            browser.get('site') == str(evidence / 'site-2b920-c3'), 'browser_binding')
    # /tmp 父本来全局可写，不作为可信证据源；要求将已审探针先复制到 root 私有证据槽。
    probe_raw = p.read_regular(checked_path(probe))
    require(p.digest(probe_raw) == PROBE_SHA, 'browser_probe_identity')
    values = {'runId': run_id, 'baseSha': BASE_SHA, 'newSha': git_record['head'],
              'source': str(source), 'repoRoot': str(repo), 'manifestSha256': p.digest(raw)}
    verified = dict(schemaVersion='idol-publication-verified-v1', **values,
                    gitPushVerified=True, browserVerified=True)
    verified_raw = p.encode(verified)
    date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    request = dict(schemaVersion='idol-publish-request-v1', **values,
                   release='auto-' + date + '-' + git_record['head'][:12],
                   publicFileCount=len(entries), previous=PREVIOUS,
                   previousManifestSha256=p.digest(old_raw), configSha256=p.digest(config_raw),
                   verificationSha256=p.digest(verified_raw))
    require(set(request) == p.REQUEST_KEYS and len(verified) == 9, 'receipt_schema')
    sidecar = {'schemaVersion': 'idol-migration-evidence-v1', 'runId': run_id,
               'git': git_record, 'browserSha256': p.digest(browser_raw), 'probeSha256': p.digest(probe_raw),
               'requestSha256': p.digest(p.encode(request)), 'verificationSha256': p.digest(verified_raw)}
    return p.encode(request), verified_raw, sidecar


def bind_push(p, bundle, evidence, expected_sha):
    request, verified, sidecar = bundle
    raw = p.read_regular(checked_path(evidence / 'git-push-evidence.json'))
    require(re.fullmatch('[a-f0-9]{64}', expected_sha) and p.digest(raw) == expected_sha, 'push_evidence_hash')
    value = json.loads(raw)
    require(value.get('schemaVersion') == 'idol-git-push-evidence-v1', 'push_evidence_schema')
    require(value.get('repository') == ORIGIN and value.get('remoteRef') == 'refs/heads/main' and
            value.get('pushExitCode') == 0 and value.get('sourceCommit') == value.get('localCommitAtPush') ==
            value.get('remoteAfter') == sidecar['git']['head'], 'push_evidence_binding')
    before = value.get('remoteBefore', '')
    require(re.fullmatch('[a-f0-9]{40}', before) and before != value['remoteAfter'], 'base_equals_new')
    require(before == (BASE_SHA if value['remoteAfter'] == ANCHOR else ANCHOR), 'push_preimage')
    plan, proof = json.loads(request), json.loads(verified)
    plan['baseSha'] = proof['baseSha'] = before
    verified = p.encode(proof)
    plan['verificationSha256'] = p.digest(verified)
    request = p.encode(plan)
    sidecar.update(pushEvidenceSha256=expected_sha, requestSha256=p.digest(request), verificationSha256=p.digest(verified))
    return request, verified, sidecar


def restore_evidence(p, package, generation, *, package_parent=Path('/var/lib/idol-migration')):
    require(re.fullmatch('[a-f0-9-]{36}', generation), 'generation')
    require(package.parent == package_parent, 'fixed_package_parent')
    checked_path(package, directory=True, private=True)
    snapshot = json.loads(p.read_regular(checked_path(package / 'snapshot.json')))
    receipt = json.loads(p.read_regular(checked_path(package.parent / ('restore-' + generation + '.json'))))
    require(snapshot.get('generation') == generation and snapshot.get('phase') == 'final' and
            snapshot.get('origin') == 'old' and snapshot.get('restorable') is True, 'final_snapshot_required')
    require(receipt.get('schemaVersion') == 'idol-migration-restore-v1' and
            receipt.get('generation') == generation and receipt.get('direction') == 'forward' and
            receipt.get('status') == 'verified-offline' and receipt.get('servicesStarted') is False,
            'verified_restore_required')
    require(receipt.get('ownership') and all(x.get('accessVerified') is True for x in receipt['ownership']),
            'restore_access_required')


def install_records(p, state, bundle, recheck):
    request, verified, sidecar = bundle
    run_id = sidecar['runId']
    no_pending(p, state, run_id)
    checked_path(state, owners=(0, 995), directory=True)
    root = state / 'publish'
    root.mkdir(mode=0o700, exist_ok=True)
    checked_path(root, owners=(0, 995), directory=True)
    proofs = root / 'verified'
    proofs.mkdir(mode=0o700, exist_ok=True)
    checked_path(proofs, owners=(0, 995), directory=True)
    p.write_exclusive(proofs / (run_id + '.json'), verified, 0o600)
    p.fsync_directory(proofs)
    require(p.read_regular(proofs / (run_id + '.json')) == verified, 'verification_drift')
    recheck()
    p.write_exclusive(root / 'pending.json', request, 0o600)
    p.fsync_directory(root)


def write_records(p, destination, request, verified, sidecar, recheck):
    require(not destination.exists() and not destination.is_symlink(), 'run_already_exists')
    checked_path(destination.parent, directory=True, private=True)
    destination.mkdir(mode=0o700)
    p.write_exclusive(destination / 'verified.json', verified, 0o600)
    recheck()
    p.write_exclusive(destination / 'evidence.json', p.encode(sidecar), 0o600)
    p.write_exclusive(destination / 'pending.json', request, 0o600)
    p.fsync_directory(destination)


def main():
    require(sys.platform.startswith('linux') and os.geteuid() == 0 and sys.flags.isolated == 1,
            'isolated_root_linux_required')
    require(Path(__file__).absolute() == TOOLS / 'receipt.py', 'fixed_installed_tool_required')
    checked_path(Path(__file__))
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='仅据已验本站证据产生私有迁移收据，不发布')
    parser.add_argument('command', choices=['dry-run', 'prepare'])
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--push-evidence-sha256', required=True)
    parser.add_argument('--package', type=Path)
    parser.add_argument('--generation')
    args = parser.parse_args()
    p = load_publisher()
    # prepare 只供下一次获批最终事务使用；本批仅 dry-run，不把调用能力当授权。
    output_root = TOOLS / 'receipt-dry-runs'
    checked_path(output_root, directory=True, private=True)
    destination = output_root / args.run_id
    require(not destination.exists() and not destination.is_symlink(), 'run_already_exists')
    if args.command == 'prepare':
        require(args.package is not None and args.generation is not None, 'restore_binding_required')
        restore_evidence(p, args.package, args.generation)
        snapshot_path = checked_path(TOOLS / 'snapshot.py')
        spec = importlib.util.spec_from_file_location('fixed_snapshot', snapshot_path)
        snapshot = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(snapshot)
        snapshot.frozen_services()
        require(not (TOOLS / 'receipt-intent.json').exists() and not (TOOLS / 'receipt-intent.json').is_symlink(), 'preparation_started_requires_review')
    with locks(BASE) as check_locks:
        # 双锁内再次核对，已知输出冲突必须早于固定intent；dry-run亦使用同一双锁。
        require(not destination.exists() and not destination.is_symlink(), 'run_already_exists')
        def gather():
            return bind_push(p, collect(p, args.run_id), EVIDENCE, args.push_evidence_sha256)
        bundle = gather()
        request, verified, sidecar = bundle
        sidecar['nonProduction'] = args.command == 'dry-run'
        def recheck():
            again = gather()
            require(again[:2] == bundle[:2], 'evidence_changed')
            check_locks()
        if args.command == 'prepare':
            # 固定意图在全部验证后、第一笔产物前独占写；半完成后不能换runId绕过。
            snapshot.frozen_services()
            p.write_exclusive(TOOLS / 'receipt-intent.json', p.encode(sidecar), 0o600)
            p.fsync_directory(TOOLS)
        write_records(p, destination, request, verified, sidecar, recheck)
        if args.command == 'prepare':
            restore_evidence(p, args.package, args.generation)
            # 当前runId的 verified 是本次刚写的；最后复核不再把它误报为旧未决。
            def final_recheck():
                check_locks()
                # 自己只写root私有intent，没有制造frozen_services所拒的pending/prepare锁。
                snapshot.frozen_services()
                require(p.maintenance_mode() == 'paused', 'maintenance_not_paused')
                require(p.read_regular(BASE / 'maintenance/state/publish/verified' / (args.run_id + '.json')) == verified, 'verification_drift')
                require(p.digest(p.read_regular(p.CONFIG)) == CONFIG_SHA and os.readlink(BASE / 'current') == PREVIOUS, 'preimage_drift')
                require(git_evidence(BASE / 'maintenance/repo')['head'] == sidecar['git']['head'], 'git_changed')
                require(p.digest(p.read_regular(checked_path(EVIDENCE / 'c5-site-browser-verification-v5.json'))) == BROWSER_SHA and
                        p.digest(p.read_regular(checked_path(EVIDENCE / 'c5-browser-probe.mjs'))) == PROBE_SHA and
                        p.digest(p.read_regular(checked_path(EVIDENCE / 'git-push-evidence.json'))) == args.push_evidence_sha256, 'evidence_changed')
                for name in ('pending.json', 'preparing.json', '.prepare.lock'):
                    path = BASE / 'maintenance/state/publish' / name
                    require(not path.exists() and not path.is_symlink(), 'publication_already_exists')
            install_records(p, BASE / 'maintenance/state', bundle, final_recheck)
    print(json.dumps({'status': 'dry-run-not-production' if args.command == 'dry-run' else 'prepared-not-published', 'runId': args.run_id,
                      'requestSha256': p.digest(request), 'verificationSha256': p.digest(verified)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('迁移收据停止：' + str(error), file=sys.stderr)
        sys.exit(1)
