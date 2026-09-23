"""Install and manage an isolated macOS ARM64 Neo4j Community runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
DOWNLOADS = RUNTIME / 'downloads'
VERSION = '5.26.30'
NEO4J = RUNTIME / f'neo4j-community-{VERSION}'
ENV_FILE = ROOT / '.neo4j.env'


def java_home():
    paths = list((RUNTIME / 'java').glob('*/Contents/Home'))
    if len(paths) != 1:
        raise RuntimeError('Run the setup command first to extract Java.')
    return paths[0]


def environment():
    return {**os.environ, 'JAVA_HOME': str(java_home()), 'NEO4J_HOME': str(NEO4J)}


def download(url, target):
    if not target.exists():
        subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '240', '-o', str(target), url], check=True)


def setup():
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    download(f'https://dist.neo4j.org/neo4j-community-{VERSION}-unix.tar.gz', DOWNLOADS/'neo4j.tar.gz')
    download(f'https://dist.neo4j.org/neo4j-community-{VERSION}-unix.tar.gz.sha256', DOWNLOADS/'neo4j.sha256')
    download('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=aarch64&image_type=jre&os=mac&vendor=eclipse', DOWNLOADS/'jre-assets.json')
    java_asset = json.loads((DOWNLOADS/'jre-assets.json').read_text())[0]
    package = java_asset['binary']['package']
    download(package['link'], DOWNLOADS/'java.tar.gz')
    for name, checksum in [('neo4j', (DOWNLOADS/'neo4j.sha256').read_text().split()[0]), ('java', package['checksum'])]:
        actual = hashlib.file_digest((DOWNLOADS/f'{name}.tar.gz').open('rb'), 'sha256').hexdigest()
        if actual.lower() != checksum.lower():
            raise RuntimeError(f'{name} archive failed checksum validation; remove the partial archive and retry.')
    if not NEO4J.exists():
        with tarfile.open(DOWNLOADS/'neo4j.tar.gz') as archive:
            archive.extractall(RUNTIME, filter='data')
    if not (RUNTIME/'java').exists():
        with tarfile.open(DOWNLOADS/'java.tar.gz') as archive:
            archive.extractall(RUNTIME/'java', filter='data')
    # Bind both transports to loopback; data and logs remain inside the project.
    config = '''server.default_listen_address=127.0.0.1
server.default_advertised_address=localhost
server.bolt.enabled=true
server.bolt.listen_address=127.0.0.1:7687
server.bolt.advertised_address=localhost:7687
server.http.enabled=true
server.http.listen_address=127.0.0.1:7474
server.http.advertised_address=localhost:7474
server.https.enabled=false
server.memory.heap.initial_size=256m
server.memory.heap.max_size=512m
server.memory.pagecache.size=256m
dbms.security.auth_enabled=true
dbms.usage_report.enabled=false
'''
    (NEO4J/'conf/neo4j.conf').write_text(config)
    if not ENV_FILE.exists():
        if (NEO4J/'data/databases/system').exists():
            raise RuntimeError('Database exists but .neo4j.env is missing; restore its credentials instead of resetting them.')
        password = secrets.token_urlsafe(24)
        fd = os.open(ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(f'NEO4J_URI=bolt://127.0.0.1:7687\nNEO4J_USERNAME=neo4j\nNEO4J_PASSWORD={password}\nNEO4J_DATABASE=neo4j\n')
        result = subprocess.run([str(NEO4J/'bin/neo4j-admin'), 'dbms', 'set-initial-password', password],
                                env=environment(), capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Could not initialize database authentication: ' + result.stderr.replace(password, '[redacted]'))
    (RUNTIME/'versions.json').write_text(json.dumps({'neo4j': VERSION, 'java': java_asset['version']['semver'],
                                                  'java_archive_sha256': package['checksum']}, indent=2)+'\n')
    print('Neo4j and Java archives verified and installed. Credentials: .neo4j.env (owner-only access).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'start', 'stop', 'status', 'console'])
    action = parser.parse_args().action
    if action == 'setup':
        setup()
        return
    result = subprocess.run([str(NEO4J/'bin/neo4j'), action], env=environment())
    if result.returncode:
        raise SystemExit(result.returncode)
    if action == 'start':
        for _ in range(45):
            try:
                with urllib.request.urlopen('http://127.0.0.1:7474/', timeout=2) as response:
                    if response.status == 200:
                        print('Neo4j Browser: http://localhost:7474/browser/')
                        return
            except (OSError, TimeoutError):
                time.sleep(1)
        raise RuntimeError('Neo4j did not become ready. Inspect .runtime/neo4j-community-5.26.30/logs/neo4j.log.')


if __name__ == '__main__':
    main()
