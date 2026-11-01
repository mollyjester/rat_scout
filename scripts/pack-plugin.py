#!/usr/bin/env python3
"""Package Rat Scout's two pbws for the plugin preview.

  build/rat-scout.pbw          the watchface: `pebble build` output with manifestVersion 2,
                               which a watchapp needs to read any plugin (preview guide,
                               "Writing a watchface or app that uses plugins").
  build/rat-scout-glucose.pbw  the plugin-only pbw built from plugin/ (no SDK needed):
                               appinfo.json from plugin/package.json plus the files it names
                               (plugin.script and a file configPage).

SDK 4.33.1 can't do either: it copies package.json's `pebble` block into appinfo.json but sets
no manifestVersion, adds no plugin files and has no plugin-only projects (PebbleOS PR #2483
adds all three; no published SDK has it yet). build/<project dir name>.pbw is left as the
legacy watchface pbw, which can't read plugins.

Steps: check plugin/plugin.js is up to date (node scripts/build-plugin.js --check); run
`pebble clean` + `pebble build`; write both pbws. A watchface pbw that is already
manifestVersion 2 is copied unchanged, so this retires itself once the SDK catches up.

Run with `python3 -I scripts/pack-plugin.py` from anywhere. Options:
  --no-build   pack the existing watchface build output without rebuilding
  --selftest   run the built-in self test on in-memory pbws and exit

Sideload only: never publish the results to the appstore.
"""

import io
import json
import os
import re
import subprocess
import sys
import zipfile

MANIFEST_VERSION = 2
FACE_OUTPUT = 'rat-scout.pbw'
PLUGIN_DIR = 'plugin'
PLUGIN_OUTPUT = 'rat-scout-glucose.pbw'

# definesPermissions rules as PebbleOS PR #2483 and pypkjs 3.0.3 (plugins/manifest.py) check them.
# The preview guide also lists `dangerous`, but neither of those accepts it.
PERMISSION_KINDS = ('read', 'write', 'exfiltrating')
PERMISSION_NAME = re.compile(r'[A-Za-z][A-Za-z0-9]*')
RESERVED_PERMISSION_NAMES = ('InvokeAction',)


class PackError(Exception):
    pass


def permission_errors(plugin):
    """Problems with the plugin's definesPermissions, as human-readable strings."""
    errors = []
    for d in plugin.get('definesPermissions', []):
        name = d.get('name', '')
        if not PERMISSION_NAME.fullmatch(str(name)):
            errors.append("permission name '%s' must be alphanumeric" % name)
        if name in RESERVED_PERMISSION_NAMES:
            errors.append("permission name '%s' is reserved" % name)
        if not str(d.get('label', '')).strip():
            errors.append("permission '%s' has no label" % name)
        if d.get('kind') not in PERMISSION_KINDS:
            errors.append("permission '%s' needs a kind: one of %s" % (name, ', '.join(PERMISSION_KINDS)))
    return errors


def pack_face(pbw_bytes):
    """Return (watchface pbw bytes with manifestVersion 2, message)."""
    with zipfile.ZipFile(io.BytesIO(pbw_bytes)) as z:
        appinfo = json.loads(z.read('appinfo.json'))
        entries = [(info, z.read(info)) for info in z.infolist() if info.filename != 'appinfo.json']
    if int(appinfo.get('manifestVersion', 0) or 0) >= MANIFEST_VERSION:
        return pbw_bytes, 'watchface already manifestVersion %d: copied unchanged' % MANIFEST_VERSION
    appinfo['manifestVersion'] = MANIFEST_VERSION
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('appinfo.json', json.dumps(appinfo, indent=2))
        for info, data in entries:
            z.writestr(info, data)
    return out.getvalue(), 'watchface: set manifestVersion %d' % MANIFEST_VERSION


def plugin_appinfo(pkg):
    """appinfo.json for a plugin-only pbw, as upstream pack-plugin-pbw.py builds it."""
    pebble = pkg.get('pebble', {})
    display = pebble.get('displayName') or pkg.get('name', '')
    appinfo = dict(pebble)
    appinfo['manifestVersion'] = MANIFEST_VERSION
    appinfo.setdefault('shortName', display)
    appinfo.setdefault('longName', display)
    appinfo.setdefault('companyName', pkg.get('author', ''))
    appinfo.setdefault('versionLabel', pkg.get('version', '1.0.0'))
    appinfo.setdefault('sdkVersion', '3')
    appinfo.setdefault('resources', {'media': []})
    appinfo.setdefault('watchapp', {'watchface': False})
    return appinfo


def files_named_by(appinfo):
    """The loose files the phone reads: plugin.script, and configPage unless it is a URL."""
    names = []
    plugin = appinfo.get('plugin')
    if isinstance(plugin, dict):
        names.append(plugin.get('script') or 'plugin.js')
    config = appinfo.get('configPage')
    if isinstance(config, str) and not config.startswith(('http://', 'https://')):
        names.append(config)
    return names


def pack_plugin_only(pkg, read_file):
    """Return (plugin-only pbw bytes, message). read_file(path) -> bytes or None."""
    appinfo = plugin_appinfo(pkg)
    if not appinfo.get('uuid'):
        raise PackError('plugin/package.json pebble block needs a uuid')
    plugin = appinfo.get('plugin')
    if not isinstance(plugin, dict):
        raise PackError('plugin/package.json pebble block has no plugin')
    errors = permission_errors(plugin)
    if errors:
        raise PackError('bad plugin manifest:\n  ' + '\n  '.join(errors))
    out = io.BytesIO()
    names = files_named_by(appinfo)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('appinfo.json', json.dumps(appinfo, indent=2))
        for name in names:
            data = read_file(name)
            if data is None:
                raise PackError("appinfo names '%s' but it does not exist in %s/" % (name, PLUGIN_DIR))
            z.writestr(name, data)
    return out.getvalue(), 'plugin: %s' % ', '.join(['appinfo.json'] + names)


def selftest():
    def make(appinfo, extra=()):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr('appinfo.json', json.dumps(appinfo))
            z.writestr('pebble-js-app.js', 'js')
            for name, data in extra:
                z.writestr(name, data)
        return b.getvalue()

    out, _ = pack_face(make({'uuid': 'f'}))
    with zipfile.ZipFile(io.BytesIO(out)) as z:
        assert json.loads(z.read('appinfo.json'))['manifestVersion'] == 2, 'face: manifestVersion set'
        assert z.read('pebble-js-app.js') == b'js', 'face: other entries kept'
        assert z.namelist()[0] == 'appinfo.json', 'face: appinfo first'
    already = make({'uuid': 'f', 'manifestVersion': 2})
    out2, msg2 = pack_face(already)
    assert out2 == already and 'unchanged' in msg2, 'face: retires itself'

    good = {'name': 'g', 'author': 'A', 'version': '1.0.0',
            'pebble': {'displayName': 'G', 'uuid': 'p', 'projectType': 'plugin', 'configPage': 'config.html',
                       'plugin': {'script': 'plugin.js',
                                  'definesPermissions': [{'name': 'Glucose', 'label': 'Read', 'kind': 'read'}]}}}
    files = {'plugin.js': b'src', 'config.html': b'<html>'}
    out3, _ = pack_plugin_only(good, files.get)
    with zipfile.ZipFile(io.BytesIO(out3)) as z:
        info = json.loads(z.read('appinfo.json'))
        assert info['manifestVersion'] == 2 and info['uuid'] == 'p', 'plugin: appinfo'
        assert info['shortName'] == 'G' and info['companyName'] == 'A' and info['versionLabel'] == '1.0.0', 'plugin: names'
        assert z.read('plugin.js') == b'src' and z.read('config.html') == b'<html>', 'plugin: files added'
        assert 'pebble-js-app.js' not in z.namelist(), 'plugin: no watchapp files'
    url = json.loads(json.dumps(good))
    url['pebble']['configPage'] = 'https://example.com/c.html'
    with zipfile.ZipFile(io.BytesIO(pack_plugin_only(url, files.get)[0])) as z:
        assert z.namelist() == ['appinfo.json', 'plugin.js'], 'plugin: a URL configPage is not bundled'
    for bad_def, needle in (({'name': 'Glu cose', 'label': 'L', 'kind': 'read'}, 'alphanumeric'),
                            ({'name': 'InvokeAction', 'label': 'L', 'kind': 'read'}, 'reserved'),
                            ({'name': 'G', 'label': ' ', 'kind': 'read'}, 'no label'),
                            ({'name': 'G', 'label': 'L', 'kind': 'bogus'}, 'needs a kind'),
                            ({'name': 'G', 'label': 'L', 'kind': 'dangerous'}, 'needs a kind')):
        bad = json.loads(json.dumps(good))
        bad['pebble']['plugin']['definesPermissions'] = [bad_def]
        try:
            pack_plugin_only(bad, files.get)
        except PackError as e:
            assert needle in str(e), 'error mentions %s: %s' % (needle, e)
        else:
            raise AssertionError('accepted %r' % bad_def)
    for broken, needle in ((dict(good, pebble=dict(good['pebble'], uuid='')), 'uuid'),
                           (dict(good, pebble={'uuid': 'p'}), 'no plugin')):
        try:
            pack_plugin_only(broken, files.get)
        except PackError as e:
            assert needle in str(e), e
        else:
            raise AssertionError('accepted %r' % broken)
    try:
        pack_plugin_only(good, {'plugin.js': b'x'}.get)
    except PackError as e:
        assert 'does not exist' in str(e)
    else:
        raise AssertionError('accepted a missing config page')
    print('selftest passed')


def main(argv):
    if '--selftest' in argv:
        selftest()
        return
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    subprocess.run(['node', os.path.join('scripts', 'build-plugin.js'), '--check'], cwd=project, check=True)
    legacy = os.path.join(project, 'build', os.path.basename(project) + '.pbw')
    if '--no-build' not in argv:
        subprocess.run(['pebble', 'clean'], cwd=project, check=True)
        subprocess.run(['pebble', 'build'], cwd=project, check=True)
    if not os.path.isfile(legacy):
        raise PackError('%s not found: run pebble build' % legacy)

    with open(legacy, 'rb') as f:
        face, face_msg = pack_face(f.read())
    face_path = os.path.join(project, 'build', FACE_OUTPUT)
    with open(face_path, 'wb') as f:
        f.write(face)

    plugin_dir = os.path.join(project, PLUGIN_DIR)
    with open(os.path.join(plugin_dir, 'package.json')) as f:
        pkg = json.load(f)

    def read_file(rel):
        path = os.path.join(plugin_dir, rel)
        if not os.path.isfile(path):
            return None
        with open(path, 'rb') as f:
            return f.read()

    plugin, plugin_msg = pack_plugin_only(pkg, read_file)
    plugin_path = os.path.join(project, 'build', PLUGIN_OUTPUT)
    with open(plugin_path, 'wb') as f:
        f.write(plugin)
    rel = lambda p: os.path.relpath(p, project)
    print('%s; wrote %s' % (face_msg, rel(face_path)))
    print('%s; wrote %s' % (plugin_msg, rel(plugin_path)))
    print('legacy watchface (cannot read plugins): %s' % rel(legacy))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except PackError as e:
        sys.exit('pack-plugin: %s' % e)
