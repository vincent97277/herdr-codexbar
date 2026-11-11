import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../mods/codexbar/model.js', import.meta.url), 'utf8');
const m = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('refresh options match CodexBar fixed choices with a five-minute default', () => {
  assert.equal(m.preferences(null).interval, 300);
  assert.deepEqual(m.INTERVALS.map(([seconds]) => seconds), [0, 60, 120, 300, 900, 1800]);
  assert.equal(m.preferences({interval: 'adaptive'}).interval, 300);
  assert.equal(m.preferences({interval: 30}).interval, 300);
});
test('manual never schedules a poll and a chosen interval applies to the last attempt', () => {
  assert.equal(m.refreshDue(100, 0, 100000), false);
  assert.equal(m.refreshDue(100, 300, 399), false);
  assert.equal(m.refreshDue(100, 300, 400), true);
  assert.equal(m.refreshDue(100, 60, 200), true);
  assert.equal(m.nextUpdate(100, 0, 200), 'Manual refresh');
  assert.equal(m.nextUpdate(100, 300, 100), 'Next update in 5m');
});
test('reset passed waits for source data and localized descriptions do not leak', () => {
  assert.match(m.resetText({resetsAt: 99}, 100), /waiting for CodexBar/);
  assert.equal(m.resetText({resetDescription:'清晨7點'}, 100), 'Reset time unavailable');
  assert.equal(m.duration(3599), '1h 0m');
});
test('unknown quota is omitted and real zero remains visible', () => {
  const data = m.clean({ entries: [{ name: 'ChatGPT', windows: [{ label: 'Weekly', left: 0, used: 100 }, { label: 'Unknown', left: null, used: null }] }] });
  assert.equal(data.entries[0].windows.length, 1);
  assert.equal(data.entries[0].windows[0].left, 0);
  assert.deepEqual(data.missing, []);
});
test('Priority filters providers, includes their accounts, and ignores unpinned exhausted quotas', () => {
  const entries = m.clean({entries:[{key:'claude:a',provider:'claude',name:'Claude',account:'Personal',windows:[
    {id:'weekly',label:'Weekly',left:40,used:60},{id:'session',label:'Session',left:18,used:82},
  ]},{key:'codex:a',provider:'codex',name:'ChatGPT',windows:[{id:'session',label:'Session',left:0,used:100},{id:'weekly',label:'Weekly',left:71,used:29}]}]}).entries;
  const groups = m.visibleProviders(entries,m.preferences({page:'priority',pinnedProviders:['claude']}));
  assert.deepEqual(groups.map(group=>group.provider),['claude']);
  assert.equal(groups[0].accounts[0].windows.length,2);
  assert.equal(m.visibleProviders(entries,m.preferences({page:'priority'})).length,0);
});
test('display preferences survive normalization and invalid choices fall back', () => {
  assert.deepEqual(m.preferences({display:'icons',appearance:'light',pins:['claude:account/session','claude:account/weekly'],interval:900}),{display:'icons',appearance:'light',pinnedProviders:['claude'],interval:900,page:'all',fill:'remaining'});
  assert.equal(m.preferences({display:'unknown'}).display,'bars');
  assert.equal(m.preferences({display:'priority'}).display,'icons');
  assert.equal(m.preferences({display:'detailed'}).display,'bars');
});
test('explicitly clearing provider pins does not restore legacy quota pins',()=>{
  assert.deepEqual(m.preferences({pins:['claude:a/weekly'],pinnedProviders:[]}).pinnedProviders,[]);
});
test('fill direction uses the corresponding number while defaulting to remaining',()=>{
  const w={left:68,used:32};
  assert.equal(m.usageValue(w,m.preferences({})),68);
  assert.equal(m.usageValue(w,m.preferences({fill:'used'})),32);
  assert.equal(m.usageLabel(w,m.preferences({fill:'used'})),'32% used');
});
test('staleness uses upstream time, not sidebar poll time', () => {
  assert.equal(m.age(100, 7300), 'Updated 2h ago');
  assert.equal(m.age(null, 7300), 'Update time unavailable');
});
