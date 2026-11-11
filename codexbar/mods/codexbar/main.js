import { View, div, svg } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { exec, appHome, theme, settings, run, props, layout, nextCommand, shared, setShared, openOverlay, closeOverlay } from 'herdr';
import { PREFS, INTERVALS, DISPLAYS, APPEARANCES, FILL_MODES, preferences, age, resetShort, nextUpdate, refreshDue, finite, money, tokens, planName, clean, usageValue, usageLabel, visibleProviders } from './model.js';

const PANEL = 'codexbar-sidebar';
const icon = (name, color, size = 14) => svg(`mods/codexbar/${name}.svg`).size(size).flex_none().text_color(color);
const stop = (_e, cx) => cx.stop_propagation();
const prefs = () => preferences(shared(PREFS));
const save = patch => setShared(PREFS, { ...prefs(), ...patch });
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const result = find(child, id); if (result) return result; }
  return null;
}
function colors(p) {
  const dark = p.appearance === 'dark' || (p.appearance === 'system' && settings().dark);
  return dark
    ? { bg: '#1e1e1e', card: '#252525', raised: '#303030', track: '#383838', border: '#353535', text: '#e6e6e6', muted: '#979797', dim: '#747474', blue: '#0a84ff', orange: '#ff9f0a', red: '#ff453a', selected: '#555555', selectedText: '#ffffff' }
    : { bg: '#f5f5f7', card: '#ffffff', raised: '#ebebee', track: '#e1e1e6', border: '#dedee3', text: '#202024', muted: '#717179', dim: '#85858e', blue: '#007aff', orange: '#b86000', red: '#d92d32', selected: '#0067d9', selectedText: '#ffffff' };
}
const ink = (left, c) => left <= 0 ? c.red : left <= 20 ? c.orange : c.blue;
const stale = e => !finite(e.updatedAt) || Date.now() / 1000 - e.updatedAt > 900;
function mark(provider, c, size = 18) {
  if (['codex', 'openai', 'claude', 'cursor', 'gemini', 'copilot'].includes(provider)) return icon(`provider-${provider}`, c.muted, size);
  return icon('mark', c.muted, size);
}
function action(id, glyph, c, click, size = 28) {
  return h_flex().id(id).size(size).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
    .hover(s => s.bg(c.raised)).on_mouse_down('left', stop).on_click(click).child(icon(glyph, c.muted, 14));
}
function track(w, p, c) {
  const amount = usageValue(w, p);
  return h_flex().h(6).flex_1().min_w(24).rounded(3).overflow_hidden().bg(c.track)
    .when(amount > 0, el => el.child(div().h_full().flex_basis(0).flex_grow(amount).bg(ink(w.left, c))))
    .when(amount < 100, el => el.child(div().h_full().flex_basis(0).flex_grow(100 - amount).bg(c.track)));
}
function ring(e, w, p, c) {
  const amount = Math.round(usageValue(w, p));
  // Static SVG geometry, one common 44px coordinate system. No native arc offsets.
  return h_flex().relative().size(44).flex_none().items_center().justify_center().overflow_hidden()
    .child(div().absolute().left(1.5).top(1.5).size(41).rounded_full().border(3).border_color(c.track))
    .when(amount > 0, el => el.child(icon(`rings/${amount}`, ink(w.left, c), 44).absolute().left(0).top(0)))
    .child(mark(e.provider, c, 19));
}

export default class Codexbar extends View {
  init(_p, cx) {
    this.role = props()?.role ?? 'panel';
    if (this.role === 'toggle') return;
    this.handle = cx.focus_handle();
    if (this.role === 'settings') { this.handle.focus(); return; }
    this.data = null; this.error = null; this.busy = false; this.lastAttempt = 0; this.lastFooter = '';
    this.refresh(cx);
    cx.timer.every(5000, cx => {
      if (find(layout(), PANEL)?.hidden) return;
      const p = prefs(), now = Date.now() / 1000;
      if (!this.busy && refreshDue(this.lastAttempt, p.interval, now)) this.refresh(cx);
      const footer = nextUpdate(this.lastAttempt, p.interval, now);
      if (footer !== this.lastFooter) { this.lastFooter = footer; cx.notify(); }
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === 'focus') this.handle.focus();
        if (command === 'refresh') this.refresh(cx);
        if (['icons', 'bars'].includes(command)) save({ display: command });
        if (command === 'priority') save({ page: 'priority' });
        if (command === 'all') save({ page: 'all' });
        if (['cards', 'detailed'].includes(command)) save({ display: 'bars' });
        if (['remaining', 'used'].includes(command)) save({ fill: command });
        if (command === 'settings') this.settings();
        if (command === 'close-settings' && this.settingsOverlay) {
          closeOverlay(this.settingsOverlay); this.settingsOverlay = null;
        }
      }
    });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true; this.lastAttempt = Date.now() / 1000; cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await exec('/usr/bin/python3', [`${appHome()}/mods/codexbar/read_usage.py`], { timeout: 10000 });
        if (result.code !== 0) throw new Error('Unable to read CodexBar. Try refreshing again.');
        const data = clean(JSON.parse(result.stdout));
        if (data.error) throw new Error(data.error);
        this.data = data; this.error = null;
      } catch (error) { this.error = String(error.message ?? error); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  open(cx) {
    cx.spawn(async cx => {
      try {
        const result = await exec('/usr/bin/open', ['-a', 'CodexBar']);
        if (result.code !== 0) throw new Error('CodexBar could not be opened. Check that it is installed.');
      } catch (error) { this.error = String(error.message ?? error); cx.notify(); }
    });
  }

  settings() {
    this.settingsOverlay = openOverlay({ mod: 'codexbar', kind: 'popup', frame: 'none', width: 320, height: 610, props: { role: 'settings' } });
  }

  pin(provider, cx) {
    const p = prefs();
    save({ pinnedProviders: p.pinnedProviders.includes(provider) ? p.pinnedProviders.filter(x => x !== provider) : [...p.pinnedProviders, provider] });
    cx.notify();
  }

  pinButton(provider, p, c) {
    const pinned = p.pinnedProviders.includes(provider);
    return action(`pin-provider-${provider}`, pinned ? 'star-filled' : 'star', { ...c, muted: pinned ? c.blue : c.dim }, (_event, cx) => {
      cx.stop_propagation(); this.pin(provider, cx);
    }).bg(pinned ? c.raised : c.bg);
  }

  metric(label, value, c) {
    return h_flex().gap(8).items_center().text_size(11.5)
      .child(div().flex_1().min_w(0).truncate().text_color(c.muted).child(label))
      .child(div().flex_none().whitespace_nowrap().text_color(c.text).child(value));
  }

  metrics(e, c) {
    const rows = [];
    if (finite(e.sessionCost) || finite(e.sessionTokens)) rows.push(this.metric('Today', [finite(e.sessionCost) ? money(e.sessionCost) : null, finite(e.sessionTokens) ? `${tokens(e.sessionTokens)} tokens` : null].filter(Boolean).join(' · '), c));
    if (finite(e.availableResets)) rows.push(this.metric('Available resets', String(e.availableResets), c));
    if (finite(e.credits)) rows.push(this.metric('Credits left', String(Math.round(e.credits * 100) / 100), c));
    if (finite(e.reviewLeft)) rows.push(this.metric('Code review left', `${Math.round(e.reviewLeft)}%`, c));
    if (finite(e.budgetLimit) && e.budgetLimit > 0 && finite(e.budgetUsed)) rows.push(this.metric('Extra usage', `${e.budgetUsed.toFixed(2)} / ${e.budgetLimit.toFixed(2)} ${e.currency}`, c));
    return rows;
  }

  quota(e, w, p, c) {
    const id = `${e.key}/${w.id}`;
    if (p.display === 'icons') return h_flex().id(`quota-${id}`).min_h(62).gap(10).items_center()
      .child(ring(e, w, p, c))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().child(w.label))
      .child(v_flex().w(92).flex_none().items_end().gap(4)
        .child(div().flex_none().whitespace_nowrap().text_size(14).font_medium().text_color(ink(w.left, c)).child(usageLabel(w, p)))
        .child(div().flex_none().whitespace_nowrap().text_size(10.5).text_color(c.dim).child(resetShort(w))));
    return h_flex().id(`quota-${id}`).gap(6).items_center().min_h(28)
      .child(div().w(57).flex_none().truncate().text_size(12).child(w.label))
      .child(track(w, p, c))
      .child(div().w(62).flex_none().whitespace_nowrap().text_right().text_size(11).text_color(w.left <= 20 ? ink(w.left, c) : c.muted).child(usageLabel(w, p)))
      .child(div().w(45).flex_none().whitespace_nowrap().text_right().text_size(10).text_color(c.dim).child(resetShort(w)));
  }

  provider(group, p, c) {
    return v_flex().id(`provider-${group.provider}`).gap(7).mb(14)
      .child(h_flex().px(11).gap(8).items_center()
        .child(mark(group.provider, c, 18))
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(group.name))
        .child(this.pinButton(group.provider, p, c)))
      .child(v_flex().rounded(13).overflow_hidden().bg(c.card)
        .children(group.accounts.map((e, index) => v_flex().px(11).py(10).gap(7)
          .when(index > 0, el => el.border_t(1).border_color(c.border))
          .child(h_flex().items_center().gap(8)
            .child(div().flex_1().min_w(0).truncate().text_size(11).font_medium().text_color(c.muted).child(e.account))
            .when(stale(e), el => el.child(div().text_size(9.5).text_color(c.orange).child(finite(e.updatedAt) ? 'Stale' : 'Unavailable')))
            .when(Boolean(e.plan), el => el.child(div().px(5).py(1).rounded(4).bg(c.raised).text_size(10).text_color(c.muted).child(planName(e.plan)))))
          .children(e.windows.map(w => this.quota(e, w, p, c)))
          .when(!e.windows.length, el => el.child(div().text_size(12).text_color(c.dim).child('Usage unavailable')))
          .children(this.metrics(e, c))
          .child(div().text_size(9.5).text_color(c.dim).child(age(e.updatedAt))))));
  }

  renderSettings(p, c) {
    const section = (title, options, current, property) => v_flex().flex_none().gap(5)
      .child(div().text_size(10.5).font_semibold().text_color(c.muted).child(title))
      .child(h_flex().flex_wrap().gap(5).children(options.map(([value, label]) =>
        h_flex().id(`setting-${property}-${value}`).min_h(28).px(8).gap(5).items_center().rounded(5).border_1().border_color(current === value ? c.selected : c.border).bg(current === value ? c.selected : c.raised)
          .text_size(11).text_color(current === value ? c.selectedText : c.text).when(current === value, el => el.font_semibold().child(icon('check', c.selectedText, 11)))
          .cursor_pointer().hover(s => s.opacity(0.9)).on_mouse_down('left', stop).on_click(() => save({ [property]: value })).child(label))));
    const close = () => closeOverlay(props().overlay);
    // The scrollbar convenience wrapper does not inherit the root's size_full.
    // Scroll the root itself so the popup keeps its allocated width and height.
    return v_flex().id('codexbar-settings').track_focus(this.handle).size_full().min_h(0).overflow_y_scroll().p(16).gap(12).rounded(12).border_1().border_color(c.border).bg(c.card).text_color(c.text)
      .on_key_down((e, cx) => { if (e.key === 'escape') { close(); cx.stop_propagation(); } })
      .child(h_flex().flex_none().items_center().child(div().flex_1().text_size(14).font_semibold().child('Sidebar settings')).child(action('settings-close', 'close', c, close)))
      .child(section('REFRESH INTERVAL', INTERVALS, p.interval, 'interval'))
      .child(div().flex_none().text_size(10.5).text_color(c.dim).child('Reads the latest local snapshot. CodexBar controls provider updates.'))
      .child(section('DISPLAY STYLE', DISPLAYS, p.display, 'display'))
      .child(section('FILL BY', FILL_MODES, p.fill, 'fill'))
      .child(section('APPEARANCE', APPEARANCES, p.appearance, 'appearance'))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(c.muted).child(`${p.pinnedProviders.length} pinned providers`))
        .child(h_flex().id('clear-pins').h(25).px(8).items_center().rounded(5).bg(c.raised).text_size(11).cursor_pointer().on_click(() => save({ pinnedProviders: [] })).child('Clear pins')))
      .child(div().flex_1())
      .child(div().flex_none().text_size(10.5).text_color(c.dim).child('Pin a provider in All Usage to show it in Priority.'));
  }

  render(cx) {
    const t = theme();
    if (this.role === 'toggle') {
      const node = find(layout(), PANEL), shown = node && !node.hidden;
      return h_flex().size_full().pr(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(h_flex().id('codexbar-toggle').h(26).px(8).gap(6).items_center().rounded(6).bg(shown ? t.selected : t.chrome)
          .text_color(shown ? t.foreground : t.muted).text_size(12).cursor_pointer().hover(s => s.bg(t.hover))
          .on_mouse_down('left', stop).on_click(() => run('layout.toggle', { id: PANEL })).child(icon('mark', t.accent)).child('codexbar'));
    }
    const p = prefs(), c = colors(p);
    if (this.role === 'settings') return this.renderSettings(p, c);
    const entries = this.data?.entries ?? [], groups = visibleProviders(entries, p);
    return v_flex().id('codexbar').track_focus(this.handle).size_full().min_h(0).bg(c.bg).text_color(c.text)
      .child(h_flex().h(43).flex_none().px(13).gap(7).items_center()
        .child(icon('mark', c.blue, 16)).child(div().flex_1().text_size(13).font_semibold().child('codexbar'))
        .child(this.busy ? h_flex().size(28).items_center().justify_center().child(icon('refresh', c.dim, 13).spin(1000)) : action('refresh', 'refresh', c, (_e, cx) => this.refresh(cx)))
        .child(action('settings', 'settings', c, () => this.settings()))
        .child(action('hide', 'close', c, () => run('layout.hide', { id: PANEL }))))
      .child(h_flex().mx(12).mb(11).p(3).gap(3).flex_none().rounded(16).bg(c.raised)
        .children([['priority', 'Priority'], ['all', 'All Usage']].map(([page, label]) => h_flex().id(`page-${page}`).flex_1().h(28).items_center().justify_center().rounded(13)
          .bg(p.page === page ? c.selected : c.raised).text_size(12).text_color(p.page === page ? c.selectedText : c.muted)
          .when(p.page === page, el => el.font_medium()).cursor_pointer().on_mouse_down('left', stop)
          .on_click((_event, cx) => { save({ page }); cx.notify(); }).child(label))))
      .child(div().id('codexbar-scroll').flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().px(8).pb(12)
          .when(Boolean(this.error), el => el.child(div().mx(4).mb(10).p(10).rounded(8).bg(c.card).text_size(11).text_color(c.orange).child(this.error)))
          .children(groups.map(group => this.provider(group, p, c)))
          .when(p.page === 'priority' && !groups.length, el => el.child(v_flex().px(18).py(30).gap(12).items_center()
            .child(icon('star', c.dim, 26)).child(div().text_size(13).font_medium().child(p.pinnedProviders.length ? 'Pinned providers unavailable' : 'No pinned providers'))
            .child(div().text_size(11.5).text_color(c.muted).child(p.pinnedProviders.length ? 'Enable these providers in CodexBar, or clear saved pins in Sidebar settings.' : 'Open All Usage and star a provider to show all of its accounts here.'))))
          .when(p.page === 'all' && !entries.length, el => el.child(v_flex().px(18).py(30).gap(12).items_center()
            .child(icon('mark', c.dim, 30)).child(div().text_size(13).font_medium().child(this.busy ? 'Reading usage…' : 'No usage available'))
            .child(div().text_size(11.5).text_color(c.muted).child('Open CodexBar, enable a provider, and let it update. Then refresh this sidebar.'))))))
      .child(h_flex().h(37).flex_none().px(13).gap(6).items_center().border_t(1).border_color(c.border)
        .child(div().flex_1().text_size(10.5).text_color(c.dim).child(this.busy ? 'Reading local snapshot…' : nextUpdate(this.lastAttempt, p.interval)))
        .child(h_flex().id('open-codexbar').h(25).px(7).gap(5).items_center().rounded(5).text_size(10.5).text_color(c.muted).cursor_pointer().hover(s => s.bg(c.card))
          .on_mouse_down('left', stop).on_click((_e, cx) => this.open(cx)).child('Open CodexBar').child(icon('external', c.dim, 11))));
  }
}
