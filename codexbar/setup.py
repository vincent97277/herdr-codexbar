#!/usr/bin/env python3
"""Install the codexbar Herdr sidebar and a personal copy of the main layout."""

import argparse
import ast
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent


def make_layout(base):
    tree = json.loads(json.dumps(base))

    def find(node, node_id):
        if node.get('id') == node_id:
            return node
        for child in node.get('children', []):
            result = find(child, node_id)
            if result is not None:
                return result
        return None

    body = find(tree, 'work-body')
    work = find(tree, 'work')
    if body is None or work is None:
        raise RuntimeError('This main layout has no work-body/work node; no layout was changed.')
    if find(tree, 'codexbar-sidebar') is not None:
        raise RuntimeError('This layout already has a codexbar sidebar.')
    tabs_index = next((i for i, child in enumerate(work['children']) if child.get('id') == 'tabs'), None)
    if tabs_index is None:
        raise RuntimeError('This main layout has no tabs block; no layout was changed.')
    tabs = work['children'][tabs_index]
    row_size = tabs.get('size', {'px': 42})
    tabs['size'] = {'weight': 1}
    work['children'][tabs_index] = {
        'id': 'codexbar-tabs-row', 'type': 'row', 'size': row_size, 'resizable': False,
        'children': [tabs, {'id': 'codexbar-toggle', 'type': 'block', 'size': {'px': 112}, 'content': {'mod': 'codexbar', 'props': {'role': 'toggle'}}}],
    }
    body['children'].append({
        'id': 'codexbar-sidebar', 'type': 'block', 'size': {'px': 360}, 'min': 300, 'max': 520,
        'background': 'chrome', 'radius': 10, 'hidden': False,
        'content': {'mod': 'codexbar'},
    })
    tree['preview'] = 'layouts/codexbar.svg'
    return tree


def check_package():
    for path in (ROOT / 'mods/codexbar').glob('*.py'):
        ast.parse(path.read_text(), filename=str(path))
    json.loads((ROOT / 'mods/codexbar/mod.json').read_text())
    tree = json.loads((ROOT / 'layouts/codexbar.json').read_text())
    ids = set()

    def visit(node):
        if node['id'] in ids:
            raise RuntimeError('Duplicate layout node: ' + node['id'])
        ids.add(node['id'])
        for child in node.get('children', []):
            visit(child)

    visit(tree)
    if not (ROOT / tree['preview']).is_file():
        raise RuntimeError('Layout preview is missing.')
    for path in (ROOT / 'mods/codexbar').rglob('*.svg'):
        ET.parse(path)
    for percent in range(1, 101):
        if not (ROOT / 'mods/codexbar/rings' / (str(percent) + '.svg')).is_file():
            raise RuntimeError('Missing quota ring asset: ' + str(percent))
    print('Package structure, layout and Python syntax passed.', flush=True)


def command(herdr, *args):
    result = subprocess.run([herdr, *args], text=True, capture_output=True, timeout=45)
    print(result.stdout, end='', flush=True)
    if result.stderr:
        print(result.stderr, end='', file=sys.stderr)
    result.check_returncode()
    return result.stdout


def native_checks(herdr):
    source = ROOT / 'mods/codexbar'
    command(herdr, 'check', str(source))
    # The regular checker only sees the initial empty state. Force each deferred
    # view with synthetic usage so native rings, populated cards and settings
    # are also checked. Check processes use ephemeral in-memory shared state.
    now = time.time()
    fixture = {'entries': [
        {'key': 'test:personal', 'provider': 'claude', 'name': 'Claude', 'account': 'Personal', 'plan': 'ultra', 'updatedAt': now, 'windows': [
            {'id': 'weekly', 'label': 'Weekly', 'left': 40, 'used': 60, 'resetsAt': now + 180000},
            {'id': 'session', 'label': 'Session', 'left': 18, 'used': 82, 'resetsAt': now + 4000}]},
        {'key': 'test:work', 'provider': 'codex', 'name': 'ChatGPT', 'account': 'Work', 'updatedAt': now, 'windows': [
            {'id': 'session', 'label': 'Session', 'left': 0, 'used': 100, 'resetsAt': now + 6000}]},
    ], 'missing': []}
    scenarios = [(display, appearance, page, fill) for display in ('bars', 'icons') for appearance in ('dark', 'light') for page in ('all', 'priority') for fill in ('remaining', 'used')]
    scenarios += [('settings', appearance, 'all', 'remaining') for appearance in ('dark', 'light')]
    for display, appearance, page, fill in scenarios:
        with tempfile.TemporaryDirectory(prefix='codexbar-check-') as temp:
            target = Path(temp) / 'codexbar'
            shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.d.ts', 'jsconfig.json'))
            code = (source / 'main.js').read_text().replace('export default class Codexbar', 'class Codexbar', 1)
            values = json.dumps({'display': display if display != 'settings' else 'bars', 'appearance': appearance, 'page': page, 'fill': fill, 'pinnedProviders': ['claude']})
            role = 'settings' if display == 'settings' else 'panel'
            code += '\nexport default class NativeCheck extends Codexbar { init(_p, cx) {\n'
            if role == 'settings':
                # Exercise the real overlay init/focus path, not a fake settings instance.
                code = code.replace("this.role = props()?.role ?? 'panel';", "this.role = 'settings';", 1)
                code += 'super.init(_p, cx);\n'
            else:
                code += 'this.role = "panel"; this.handle = cx.focus_handle();\n'
            code += 'this.data = clean(' + json.dumps(fixture) + '); this.error = null; this.busy = false; this.lastAttempt = Date.now()/1000;\n'
            code += 'setShared(PREFS, ' + values + ');\n} }\n'
            (target / 'main.js').write_text(code)
            print('Native scenario: ' + ' / '.join((display, appearance, page, fill)), flush=True)
            command(herdr, 'check', str(target))


def capture_views(herdr, app):
    """Capture real data in both styles/fill directions, then restore preferences."""
    try:
        original = json.loads((app / 'shared.json').read_text()).get('codexbar.preferences.v2', {})
    except (OSError, ValueError):
        original = {}
    if not isinstance(original, dict):
        original = {}
    display = original.get('display', 'bars')
    display = 'icons' if display in ('icons', 'priority') else 'bars'
    page = 'priority' if original.get('page') == 'priority' else 'all'
    fill = 'used' if original.get('fill') == 'used' else 'remaining'
    try:
        command(herdr, 'do', 'codexbar.all')
        for style in ('icons', 'bars'):
            command(herdr, 'do', 'codexbar.' + style)
            for direction in ('remaining', 'used'):
                command(herdr, 'do', 'codexbar.' + direction)
                time.sleep(0.5)
                command(herdr, 'shot', str(ROOT / ('verified-' + style + '-' + direction + '.png')))
    finally:
        command(herdr, 'do', 'codexbar.' + display)
        command(herdr, 'do', 'codexbar.' + fill)
        command(herdr, 'do', 'codexbar.' + page)
        time.sleep(0.3)


def capture_settings(herdr):
    """Open the installed settings through its command path and capture the popup."""
    try:
        command(herdr, 'do', 'codexbar.settings')
        time.sleep(0.5)
        status = json.loads(command(herdr, 'status'))
        errors = [error for error in status.get('errors', []) if 'codexbar' in str(error).lower()]
        if errors:
            raise RuntimeError('Settings failed: ' + '; '.join(map(str, errors)))
        if 'codexbar' not in json.dumps(status.get('overlays', [])):
            raise RuntimeError('The settings command did not open a codexbar overlay.')
        command(herdr, 'shot', str(ROOT / 'verified-settings.png'))
    finally:
        # Close only the overlay this sidebar opened, never another app dialog.
        command(herdr, 'do', 'codexbar.close-settings')
        time.sleep(0.3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--update', action='store_true', help='Back up and update the installed codexbar sidebar')
    parser.add_argument('--remove', action='store_true', help='Switch to main and move this integration into a backup')
    args = parser.parse_args()
    app = Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app'))).expanduser()
    herdr = shutil.which('herdr-app')
    if args.verify_only:
        check_package()
        return
    if not herdr:
        raise RuntimeError('herdr-app is not available in PATH.')
    mod = app / 'mods/codexbar'
    layout = app / 'layouts/codexbar.json'
    preview = app / 'layouts/codexbar.svg'
    if args.remove:
        command(herdr, 'do', 'layout.switch', '--name', 'main')
        backup = Path(tempfile.mkdtemp(prefix='removed-', dir=ROOT))
        for path in (layout, preview, mod):
            if os.path.lexists(path):
                target = backup / path.relative_to(app)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(path), str(target))
        print('Removed codexbar integration. Backup: ' + str(backup))
        return

    check_package()
    if args.update:
        if not (mod / 'main.js').is_file() or not layout.is_file():
            raise RuntimeError('codexbar is not installed. Run setup without --update first.')
        print('Checking the updated native mod...', flush=True)
        native_checks(herdr)
        backup = Path(tempfile.mkdtemp(prefix='backup-', dir=ROOT))
        shutil.copytree(mod, backup / 'mods/codexbar', ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.d.ts', 'jsconfig.json'))
        (backup / 'layouts').mkdir()
        shutil.copy2(layout, backup / 'layouts/codexbar.json')
        if preview.is_file():
            shutil.copy2(preview, backup / 'layouts/codexbar.svg')
        print('Backup: ' + str(backup), flush=True)
        # Hot reload sees each file. Keep old exports compatible, and replace main last.
        files = sorted((ROOT / 'mods/codexbar').rglob('*'), key=lambda path: (path.name == 'main.js', str(path)))
        for source in files:
            if not source.is_file() or source.suffix not in ('.js', '.json', '.py', '.svg', '.txt'):
                continue
            if source.name == 'jsconfig.json':
                continue
            if '__pycache__' in source.parts:
                continue
            destination = mod / source.relative_to(ROOT / 'mods/codexbar')
            destination.parent.mkdir(parents=True, exist_ok=True)
            pending_file = destination.with_name('.' + destination.name + '.tmp')
            shutil.copy2(source, pending_file)
            os.replace(pending_file, destination)
        personal = json.loads(layout.read_text())
        def resize(node):
            if node.get('id') == 'codexbar-sidebar':
                if node.get('size') == {'px': 304}:
                    node['size'] = {'px': 360}
                node['min'] = 300
                node['max'] = 520
            for child in node.get('children', []):
                resize(child)
        resize(personal)
        pending_layout = layout.with_suffix('.json.tmp')
        pending_layout.write_text(json.dumps(personal, indent=2, ensure_ascii=False) + '\n')
        os.replace(pending_layout, layout)
        shutil.copy2(ROOT / 'layouts/codexbar.svg', preview)
        time.sleep(1)
        command(herdr, 'do', 'layout.switch', '--name', 'codexbar')
        status = json.loads(command(herdr, 'status'))
        relevant = [error for error in status.get('errors', []) if 'codexbar' in str(error).lower()]
        if relevant:
            raise RuntimeError('Herdr reported: ' + '; '.join(map(str, relevant)))
        time.sleep(3)
        capture_views(herdr, app)
        capture_settings(herdr)
        command(herdr, 'shot', str(ROOT / 'installed-codexbar.png'))
        print('Updated codexbar: All Usage / Priority, provider pins, and remaining/used fill.')
        print('Open Sidebar settings to choose refresh interval and appearance.')
        return
    for path in (mod, layout, preview):
        if os.path.lexists(path):
            raise RuntimeError('Refusing to overwrite: ' + str(path))
    # Check the installed Python path used by the mod before changing Herdr.
    if not Path('/usr/bin/python3').is_file():
        raise RuntimeError('/usr/bin/python3 is required to read CodexBar snapshots.')
    make_layout(json.loads((app / 'layouts/main.json').read_text()))
    print('Checking the native mod...', flush=True)
    native_checks(herdr)
    shutil.copytree(ROOT / 'mods/codexbar', mod, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.d.ts', 'jsconfig.json'))
    with preview.open('xb') as output:
        output.write((ROOT / 'layouts/codexbar.svg').read_bytes())
    try:
        command(herdr, 'do', 'layout.clone', json.dumps({'name': 'main', 'as': 'codexbar'}))
    except Exception:
        print('Mod files were copied but cloning failed. Run with --remove before retrying.', file=sys.stderr)
        raise
    # Clone through Herdr first so the current main look and click state are preserved.
    personal = make_layout(json.loads(layout.read_text()))
    pending = layout.with_suffix('.json.tmp')
    try:
        pending.write_text(json.dumps(personal, indent=2, ensure_ascii=False) + '\n')
        os.replace(pending, layout)
    finally:
        pending.unlink(missing_ok=True)
    # Give hot reload time to observe the complete mod and personal layout.
    time.sleep(1)
    command(herdr, 'do', 'layout.switch', '--name', 'codexbar')
    status = json.loads(command(herdr, 'status'))
    relevant = [error for error in status.get('errors', []) if 'codexbar' in str(error).lower()]
    if relevant:
        raise RuntimeError('Herdr reported: ' + '; '.join(map(str, relevant)))
    if status.get('layout') != 'codexbar':
        raise RuntimeError('Herdr did not switch to the codexbar layout.')
    # Allow the first snapshot read to finish before capturing the actual native UI.
    time.sleep(1)
    capture_settings(herdr)
    command(herdr, 'shot', str(ROOT / 'installed-codexbar.png'))
    print('Installed codexbar. The top-bar button shows or hides the sidebar.')
    print('Native screenshot: ' + str(ROOT / 'installed-codexbar.png'))
    print('Switch back: herdr-app do layout.switch --name main')
    print('Remove: python3 ' + str(Path(__file__).resolve()) + ' --remove')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print('Setup stopped: ' + str(exc), file=sys.stderr)
        sys.exit(1)
