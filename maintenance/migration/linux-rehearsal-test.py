"""仅在无网络、无宿主挂载的临时测试容器内运行；全部数据由 seed 创建。"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

tools = Path('/root/idol-migration-tools-20260923')
spec = importlib.util.spec_from_file_location('migration', tools / 'snapshot.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert set(os.listdir('/sys/class/net')) == {'lo'}
subprocess.run(['/usr/bin/node', '--experimental-strip-types', '/fixture/migration/seed.ts'], check=True)
Path('/var/lib/idol-migration').mkdir(mode=0o700, exist_ok=True)
Path('/var/lib/idol-migration-rehearsals').mkdir(mode=0o711, exist_ok=True)
os.chmod('/var/lib/idol-migration-rehearsals', 0o711)
for name in m.LEDGERS:
    m.SOURCES[name].mkdir(parents=True, mode=0o700, exist_ok=True)
    (m.SOURCES[name] / 'synthetic-ledger.json').write_text('{"dedupe":"preserved"}', encoding='utf-8')
initial = Path('/var/lib/idol-migration/initial')
command = ['/usr/local/bin/python3', '-I', str(tools / 'snapshot.py')]
result = subprocess.run([*command, 'snapshot', '--package', str(initial), '--phase', 'initial'], capture_output=True, text=True)
assert result.returncode == 0, result.stderr
generation = json.loads(result.stdout)['generation']
manifest = m.sha((m.REHEARSAL_APP / 'manifest.sha256').read_bytes())
result = subprocess.run([*command, 'rehearsal-worker', '--package', str(initial), '--generation', generation, '--console-manifest-sha256', manifest], capture_output=True, text=True)
assert result.returncode == 0, result.stderr
rehearsal = json.loads((m.REHEARSALS / generation / 'rehearsal.json').read_bytes())
assert rehearsal['httpStatuses'] == [200, 401] and rehearsal['applicationStopped'] and rehearsal['sourceUnchanged']
final = Path('/var/lib/idol-migration/final')
receipt = m.snapshot(final, m.SOURCES, phase='final', origin='old', verify=m.inspect_database, frozen=lambda: None)
parent = Path('/var/lib/idol-restored-fixture'); parent.mkdir(mode=0o755); os.chmod(parent, 0o755)
destinations = {name: parent / name for name in m.SOURCES}
restored = m.restore(final, destinations, generation=receipt['generation'], direction='forward', verify=m.inspect_database, frozen=lambda: None, receipt_path=parent / 'restored.json')
assert all(item['accessVerified'] for item in restored['ownership'])
assert {item['account'] for item in restored['ownership']} == {'idol-console', 'idol-maint'}
assert destinations['console'].stat().st_uid == 993
assert destinations['weekly'].stat().st_uid == 994
print(json.dumps({'status': 'passed', 'node': subprocess.check_output(['/usr/bin/node', '--version'], text=True).strip(), 'rehearsal': rehearsal, 'restore': restored}))
