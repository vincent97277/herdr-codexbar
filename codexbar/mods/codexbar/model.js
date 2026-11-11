export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const INTERVALS = [[0, 'Manual'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes']];
export const DISPLAYS = [['icons', 'Icons & percentages'], ['bars', 'Progress bars']];
export const APPEARANCES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']];
export const FILL_MODES = [['remaining', 'Remaining'], ['used', 'Used']];
export const DEFAULTS = { interval: 300, display: 'bars', appearance: 'dark', page: 'all', fill: 'remaining', pinnedProviders: [] };
export const PREFS = 'codexbar.preferences.v2';
export function preferences(value) {
  const v = value && typeof value === 'object' ? value : {};
  const legacy = Array.isArray(v.pins) ? v.pins.filter(x => typeof x === 'string').map(x => x.split(':')[0]) : [];
  const pins = Array.isArray(v.pinnedProviders) ? v.pinnedProviders : legacy;
  return {
    interval: INTERVALS.some(([n]) => n === v.interval) ? v.interval : DEFAULTS.interval,
    display: DISPLAYS.some(([n]) => n === v.display) ? v.display : v.display === 'priority' ? 'icons' : DEFAULTS.display,
    appearance: APPEARANCES.some(([n]) => n === v.appearance) ? v.appearance : DEFAULTS.appearance,
    page: v.page === 'priority' ? 'priority' : 'all',
    fill: v.fill === 'used' ? 'used' : 'remaining',
    pinnedProviders: [...new Set(pins.filter(x => typeof x === 'string' && /^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(x)).slice(0, 100))],
  };
}
export function age(at, now = Date.now() / 1000) {
  if (!finite(at)) return 'Update time unavailable';
  const seconds = Math.max(0, now - at);
  if (seconds < 60) return 'Updated just now';
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `Updated ${Math.floor(seconds / 3600)}h ago`;
  return `Updated ${Math.floor(seconds / 86400)}d ago`;
}
export function duration(seconds) {
  if (!finite(seconds) || seconds <= 0) return 'Due now';
  const minutes = Math.ceil(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
export function resetShort(w, now = Date.now() / 1000) {
  if (!finite(w.resetsAt)) return '—';
  return w.resetsAt <= now ? 'Due now' : duration(w.resetsAt - now);
}
export function resetText(w, now = Date.now() / 1000) {
  if (!finite(w.resetsAt)) return 'Reset time unavailable';
  if (w.resetsAt <= now) return 'Reset due · waiting for CodexBar';
  const date = new Date(w.resetsAt * 1000);
  const when = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `Resets ${when} · ${duration(w.resetsAt - now)}`;
}
export function refreshDue(lastAttempt, interval, now) {
  return interval > 0 && now >= lastAttempt + interval;
}
export function nextUpdate(lastAttempt, interval, now = Date.now() / 1000) {
  if (!interval) return 'Manual refresh';
  const left = Math.max(0, lastAttempt + interval - now);
  if (!left) return 'Refresh due';
  return `Next update in ${left < 60 ? `${Math.ceil(left / 10) * 10}s` : `${Math.ceil(left / 60)}m`}`;
}
export const percent = v => `${Math.round(Math.max(0, Math.min(100, v)))}%`;
export const money = v => `$${v.toFixed(2)}`;
export const tokens = v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));
export const planName = v => ({ prolite: 'Pro Lite', plus: 'Plus', pro: 'Pro', max: 'Max', ultra: 'Ultra', team: 'Team', business: 'Business', enterprise: 'Enterprise', free: 'Free' }[String(v).toLowerCase()] ?? v);
export function clean(raw) {
  if (!raw || !Array.isArray(raw.entries)) throw new Error('CodexBar returned an unreadable snapshot.');
  return {
    ...raw,
    missing: Array.isArray(raw.missing) ? raw.missing.filter(x => typeof x === 'string') : [],
    entries: raw.entries.filter(e => e && typeof e.name === 'string').map((e, i) => ({
      ...e, key: typeof e.key === 'string' ? e.key : `${e.provider}:${i}`, account: typeof e.account === 'string' ? e.account : 'Account',
      windows: (Array.isArray(e.windows) ? e.windows : []).filter(w => w && finite(w.left) && finite(w.used) && typeof w.label === 'string').slice(0, 12).map((w, j) => ({
        ...w, id: typeof w.id === 'string' ? w.id : String(j), left: Math.max(0, Math.min(100, w.left)), used: Math.max(0, Math.min(100, w.used)),
      })),
    })),
  };
}
export function providers(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.provider)) groups.set(e.provider, { provider: e.provider, name: e.name, accounts: [] });
    groups.get(e.provider).accounts.push(e);
  }
  return [...groups.values()];
}
export function usageValue(window, preference) {
  return Math.max(0, Math.min(100, preference.fill === 'used' ? window.used : window.left));
}
export const usageLabel = (window, preference) => `${percent(usageValue(window, preference))} ${preference.fill === 'used' ? 'used' : 'left'}`;
export function visibleProviders(entries, preference) {
  const groups = providers(entries);
  if (preference.page !== 'priority') return groups;
  return preference.pinnedProviders.map(id => groups.find(group => group.provider === id)).filter(Boolean);
}
