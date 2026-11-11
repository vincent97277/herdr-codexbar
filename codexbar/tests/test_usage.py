import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'mods/codexbar/read_usage.py'
spec = importlib.util.spec_from_file_location('read_usage', MODULE)
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class UsageTests(unittest.TestCase):
    def test_apple_epoch_and_remaining_quota(self):
        row = usage.entry('codex', {'updatedAt': 800000000, 'secondary': {'usedPercent': 31, 'windowMinutes': 10080, 'resetsAt': 800100000}}, apple=True)
        self.assertEqual(row['windows'][0]['left'], 69)
        self.assertEqual(row['windows'][0]['label'], 'Weekly')
        self.assertEqual(row['updatedAt'], 1778307200)
        self.assertEqual(row['windows'][0]['resetsAt'], 1778407200)

    def test_absent_window_does_not_become_zero_usage(self):
        row = usage.entry('codex', {'primary': None, 'secondary': {'usedPercent': 0}})
        self.assertEqual(len(row['windows']), 1)
        self.assertEqual(row['windows'][0]['left'], 100)

    def test_widget_percent_is_remaining_and_iso_dates_are_supported(self):
        row = usage.entry('claude', {'updatedAt': '2026-11-11T06:00:00Z', 'usageRows': [{'title': 'Session', 'percentLeft': 12, 'window': {'resetsAt': '2026-11-11T07:00:00Z'}}]})
        self.assertEqual(row['windows'][0]['used'], 88)
        self.assertEqual(row['windows'][0]['left'], 12)
        self.assertEqual(row['windows'][0]['resetsAt'] - row['updatedAt'], 3600)

    def test_credentials_and_identifiers_are_not_emitted(self):
        row = usage.entry('codex', {'accountEmail': 'private@example.com', 'token': 'secret', 'identity': {'accountEmail': 'private@example.com', 'loginMethod': 'pro'}, 'secondary': {'usedPercent': 31}})
        encoded = json.dumps(row)
        self.assertNotIn('private@example.com', encoded)
        self.assertNotIn('secret', encoded)
        self.assertEqual(row['plan'], 'pro')

    def test_unavailable_credit_balance_is_not_shown_as_zero(self):
        row = usage.entry('codex', {}, credits={'remaining': 0, 'creditsAvailable': False, 'balanceReadSucceeded': True})
        self.assertIsNone(row['credits'])

    def test_invalid_numbers_do_not_make_fake_percentages(self):
        for value in [True, '31', float('nan'), float('inf')]:
            self.assertIsNone(usage.window({'usedPercent': value}, 'primary'))

    def test_disabled_provider_is_excluded_and_account_cache_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / '.config/codexbar/config.json'
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'providers': [{'id': 'codex', 'enabled': True}, {'id': 'claude', 'enabled': False}]}))
            support = home / 'Library/Application Support/CodexBar'
            support.mkdir(parents=True)
            (support / 'codex-account-snapshots.json').write_text(json.dumps({'records': [{'snapshot': {'secondary': {'usedPercent': 31}, 'updatedAt': 800000000}}]}))
            (support / 'CLIUsageCache').mkdir()
            (support / 'CLIUsageCache/usage.json').write_text(json.dumps({'entries': [{'provider': 'claude', 'usage': {'primary': {'usedPercent': 20}}}]}))
            result = usage.collect(home)
            self.assertEqual([e['provider'] for e in result['entries']], ['codex'])
            self.assertEqual(result['entries'][0]['windows'][0]['left'], 69)
            self.assertEqual(result['missing'], [])

    def test_empty_home_is_valid_empty_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(usage.collect(tmp)['entries'], [])

    def test_accounts_are_not_replaced_with_another_accounts_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            support = home / 'Library/Application Support/CodexBar'
            support.mkdir(parents=True)
            document = {
                'generatedAt': '2026-11-11T06:00:00Z', 'enabledProviders': ['claude'],
                'entries': [{'provider': 'claude', 'primary': {'usedPercent': 10}}],
                'accounts': [
                    {'id': 'personal', 'provider': 'claude', 'label': 'Personal', 'usage': {'provider': 'claude', 'primary': {'usedPercent': 36}}},
                    {'id': 'work', 'provider': 'claude', 'label': 'Work', 'usage': None},
                ],
            }
            (support / 'widget-snapshot.json').write_text(json.dumps(document))
            entries = usage.collect(home)['entries']
            self.assertEqual(len(entries), 2)
            self.assertEqual(entries[0]['account'], 'Personal')
            self.assertEqual(entries[0]['windows'][0]['left'], 64)
            self.assertEqual(entries[1]['account'], 'Work')
            self.assertEqual(entries[1]['windows'], [])
            self.assertNotEqual(entries[0]['key'], entries[1]['key'])
            self.assertEqual(usage.collect(home)['entries'][0]['key'], entries[0]['key'])

    def test_source_language_does_not_leak_into_quota_labels(self):
        row = usage.entry('codex', {'usageRows': [{'id': 'weekly', 'title': '每週額度', 'percentLeft': 69, 'window': {'windowMinutes': 10080, 'resetDescription': '清晨7點'}}]})
        self.assertEqual(row['windows'][0]['label'], 'Weekly')
        self.assertNotIn('清晨', json.dumps(row, ensure_ascii=False))
        account = usage.account_fields(row, 'private-id', 'someone@example.com')
        self.assertEqual(account['account'], 'Account')
        self.assertNotIn('private-id', json.dumps(account))

    def test_enabled_providers_without_a_snapshot_still_appear_in_all_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / '.config/codexbar/config.json'
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'providers': [{'id': 'codex', 'enabled': True}, {'id': 'claude', 'enabled': True}, {'id': 'cursor', 'enabled': False}]}))
            result = usage.collect(home)
            self.assertEqual([e['provider'] for e in result['entries']], ['codex', 'claude'])
            self.assertTrue(all(e['windows'] == [] for e in result['entries']))
            self.assertEqual(result['missing'], ['ChatGPT', 'Claude'])


if __name__ == '__main__':
    unittest.main()
