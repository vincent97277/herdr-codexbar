#!/usr/bin/env python3
"""Read CodexBar's usage snapshots; emit only display fields, never credentials."""

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import time

APPLE_EPOCH = 978307200
NAMES = {'codex': 'ChatGPT', 'claude': 'Claude', 'openai': 'OpenAI API', 'cursor': 'Cursor', 'gemini': 'Gemini', 'copilot': 'GitHub Copilot', 'antigravity': 'Antigravity', 'openrouter': 'OpenRouter'}


def number(value):
    return value if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) else None


def date_value(value, apple=False):
    n = number(value)
    if n is not None:
        return n + (APPLE_EPOCH if apple else 0)
    if isinstance(value, str):
        try:
            parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed.replace(tzinfo=parsed.tzinfo or dt.timezone.utc).timestamp()
        except ValueError:
            pass
    return None


def text(value, maximum=120):
    return value[:maximum] if isinstance(value, str) else ''


def window(raw, label, apple=False, percent_left=None, row_id=None):
    raw = raw if isinstance(raw, dict) else {}
    used = number(raw.get('usedPercent'))
    left = number(percent_left)
    if used is None and left is not None:
        used = 100 - left
    if used is None:
        return None
    minutes = number(raw.get('windowMinutes'))
    identifier = row_id or label
    if label in ('primary', 'secondary', 'tertiary'):
        label = {300: 'Session', 1440: 'Daily', 10080: 'Weekly', 43200: '30 days'}.get(minutes, {'primary': 'Session', 'secondary': 'Weekly', 'tertiary': 'Other usage'}[label])
    if any('\u3400' <= char <= '\u9fff' for char in label):
        label = {300: 'Session', 1440: 'Daily', 10080: 'Weekly'}.get(minutes, 'Usage')
    used = max(0, min(100, used))
    return {'id': identifier, 'label': label, 'used': used, 'left': 100 - used, 'resetsAt': date_value(raw.get('resetsAt'), apple)}


def entry(provider, raw, apple=False, credits=None):
    if not isinstance(provider, str) or not provider or not isinstance(raw, dict):
        return None
    windows = []
    rows = raw.get('usageRows')
    if isinstance(rows, list) and rows:
        for row in rows[:12]:
            if isinstance(row, dict):
                w = window(row.get('window'), text(row.get('title')) or 'Usage', apple, row.get('percentLeft'), text(row.get('id')) or str(len(windows)))
                if w:
                    windows.append(w)
    if not windows:
        for label in ('primary', 'secondary', 'tertiary'):
            w = window(raw.get(label), label, apple)
            if w:
                windows.append(w)
    tokens = raw.get('tokenUsage') or {}
    tokens = tokens if isinstance(tokens, dict) else {}
    cost = raw.get('providerCost') or {}
    cost = cost if isinstance(cost, dict) else {}
    credit_value = number(raw.get('creditsRemaining'))
    if isinstance(credits, dict) and credits.get('balanceReadSucceeded') is not False and credits.get('creditsAvailable') is not False:
        credit_value = number(credits.get('remaining'))
    resets = raw.get('codexResetCredits') or {}
    resets = resets if isinstance(resets, dict) else {}
    identity = raw.get('identity') or {}
    identity = identity if isinstance(identity, dict) else {}
    return {
        'provider': provider, 'name': NAMES.get(provider, provider),
        'updatedAt': date_value(raw.get('updatedAt'), apple), 'windows': windows,
        'plan': text(identity.get('loginMethod') or raw.get('loginMethod'), 50),
        'credits': credit_value, 'reviewLeft': number(raw.get('codeReviewRemainingPercent')),
        'availableResets': number(resets.get('availableCount')),
        'sessionCost': number(tokens.get('sessionCostUSD')), 'sessionTokens': number(tokens.get('sessionTokens')),
        'sessionLabel': 'Today',
        'monthCost': number(tokens.get('last30DaysCostUSD')), 'monthTokens': number(tokens.get('last30DaysTokens')),
        'monthLabel': '30 days',
        'tokenUpdatedAt': date_value(tokens.get('updatedAt'), apple),
        'budgetUsed': number(cost.get('used')), 'budgetLimit': number(cost.get('limit')),
        'currency': text(cost.get('currencyCode')),
    }


def account_fields(e, identifier, label='Account'):
    """Use anonymous stable keys for pins without emitting account identifiers."""
    if e is None:
        return None
    label = text(label, 40)
    if not label or '@' in label or any('\u3400' <= char <= '\u9fff' for char in label):
        label = 'Account'
    e['key'] = e['provider'] + ':' + hashlib.sha256(str(identifier).encode()).hexdigest()[:20]
    e['account'] = label
    return e


def collect(home=None):
    home = Path(home) if home is not None else Path.home()
    support = home / 'Library/Application Support/CodexBar'
    denied = []

    def read(path):
        try:
            # Bound reads, including corrupt or unexpectedly large cache files.
            with path.open('rb') as stream:
                data = stream.read(4 * 1024 * 1024 + 1)
            return json.loads(data) if len(data) <= 4 * 1024 * 1024 else None
        except PermissionError:
            denied.append(True)
        except (OSError, ValueError):
            pass
        return None

    config = read(home / '.config/codexbar/config.json')
    configured = (config or {}).get('providers') if isinstance(config, dict) else None
    enabled = [x['id'] for x in configured if isinstance(x, dict) and isinstance(x.get('id'), str) and x.get('enabled') is True] if isinstance(configured, list) else None
    candidates = [support / 'widget-snapshot.json']
    groups = home / 'Library/Group Containers'
    # Known release and legacy paths. No group-container enumeration or auth-file reads.
    candidates += [groups / group / 'widget-snapshot.json' for group in ('Y5PE65HELJ.com.steipete.codexbar', 'group.com.steipete.codexbar')]
    widgets = [value for path in candidates if isinstance((value := read(path)), dict) and isinstance(value.get('entries'), list)]
    widget = max(widgets, key=lambda x: date_value(x.get('generatedAt')) or 0, default=None)
    output = []
    if widget:
        widget_enabled = widget.get('enabledProviders')
        if enabled is None and isinstance(widget_enabled, list):
            enabled = widget_enabled
        accounts = widget.get('accounts') or []
        account_providers = set()
        for account in accounts if isinstance(accounts, list) else []:
            if not isinstance(account, dict) or not isinstance(account.get('id'), str):
                continue
            provider = account.get('provider')
            if not isinstance(provider, str) or (enabled is not None and provider not in enabled):
                continue
            raw = account.get('usage')
            if isinstance(raw, dict) and raw.get('provider') not in (None, provider):
                continue
            e = account_fields(entry(provider, raw if isinstance(raw, dict) else {}), account['id'], account.get('label'))
            if e:
                output.append(e)
                account_providers.add(provider)
        for raw in widget['entries']:
            if isinstance(raw, dict):
                e = account_fields(entry(raw.get('provider'), raw), 'selected')
                if e and e['provider'] not in account_providers and (enabled is None or e['provider'] in enabled):
                    output.append(e)

    records = read(support / 'codex-account-snapshots.json')
    records = records.get('records', []) if isinstance(records, dict) else []
    if not any(e['provider'] == 'codex' for e in output) and (enabled is None or 'codex' in enabled):
        codex = []
        for record in records if isinstance(records, list) else []:
            if isinstance(record, dict):
                e = account_fields(entry('codex', record.get('snapshot'), apple=True, credits=record.get('credits')), record.get('id') or str(len(codex)))
                if e:
                    codex.append(e)
        for index, e in enumerate(codex):
            if len(codex) > 1:
                e['account'] = f'Account {index + 1}'
            output.append(e)

    cache = read(support / 'CLIUsageCache/usage.json')
    for raw in cache.get('entries', []) if isinstance(cache, dict) and isinstance(cache.get('entries'), list) else []:
        if isinstance(raw, dict):
            e = account_fields(entry(raw.get('provider'), raw.get('usage')), 'selected')
            if e and not any(x['provider'] == e['provider'] for x in output) and (enabled is None or e['provider'] in enabled):
                output.append(e)
    present = {e['provider'] for e in output}
    missing = [NAMES.get(p, p) for p in (enabled or []) if p not in present]
    for provider in (enabled or []):
        if provider not in present:
            output.append(account_fields(entry(provider, {}), 'selected'))
    return {'entries': output, 'missing': missing, 'readAt': time.time(), 'limited': bool(denied), 'source': 'Local CodexBar snapshot'}


if __name__ == '__main__':
    try:
        print(json.dumps(collect(), ensure_ascii=False, allow_nan=False))
    except Exception:
        print(json.dumps({'entries': [], 'missing': [], 'error': 'Unable to read CodexBar usage. Please try again.'}))
        raise SystemExit(1)
