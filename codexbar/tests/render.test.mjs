import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

class Element {
  constructor(){this.nodes=[];this.styles={};const proxy=new Proxy(this,{get:(t,k)=>k in t?t[k]:(...a)=>{t.styles[k]=a;return proxy;}});return proxy;}
  child(v){this.nodes.push(v);return this;}
  children(v){this.nodes.push(...v);return this;}
  when(v,f){return v?f(this):this;}
}
const element=()=>new Element();
const clickContext={stop_propagation(){},notify(){}};
function text(node){return typeof node==='string'?node:(node?.nodes??[]).map(text).join(' ');}
function find(node,id){if(node?.styles?.id?.[0]===id)return node;for(const child of node?.nodes??[]){const hit=find(child,id);if(hit)return hit;}return null;}
function assets(node){return [...(node?.styles?.asset??[]),...(node?.nodes??[]).flatMap(assets)];}
async function scene(){
  let saved={},props={};const overlays=[],closed=[];
  const context=vm.createContext({Date,JSON,Math,Number,String,Error});
  const modules={
    'gpui-kit':{View:class{},div:element,svg:asset=>{const el=element();el.styles.asset=[asset];return el;}},
    'gpui-base':{h_flex:element,v_flex:element},
    'herdr':{exec:async()=>({code:0,stdout:'{"entries":[]}'}),appHome:()=>'/tmp',theme:()=>new Proxy({},{get:()=> '#888888'}),settings:()=>({dark:true}),run:()=>{},props:()=>props,layout:()=>({id:'root',children:[{id:'codexbar-sidebar',hidden:false}]}),nextCommand:()=>new Promise(()=>{}),shared:()=>saved,setShared:(_key,value)=>{saved=value;},openOverlay:spec=>{overlays.push(spec);return 'settings-overlay';},closeOverlay:id=>closed.push(id)},
  };
  const model=new vm.SourceTextModule(await readFile(new URL('../mods/codexbar/model.js',import.meta.url),'utf8'),{context});await model.link(()=>{throw Error('unexpected import');});await model.evaluate();
  const source=new vm.SourceTextModule(await readFile(new URL('../mods/codexbar/main.js',import.meta.url),'utf8'),{context});
  await source.link(async name=>{if(name==='./model.js')return model;const values=modules[name];return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});await source.evaluate();
  const panel=new source.namespace.default();Object.assign(panel,{role:'panel',handle:{},data:null,error:null,busy:false,lastAttempt:Date.now()/1000});
  return {panel,create:()=>new source.namespace.default(),overlays,closed,model:model.namespace,save:v=>{saved=v;},saved:()=>saved,props:v=>{props=v;}};
}
function fixture(m){const now=Date.now()/1000;return m.clean({entries:[
  {key:'claude:personal',provider:'claude',name:'Claude',account:'Personal',plan:'ultra',updatedAt:now,windows:[{id:'session',label:'Session',left:64,used:36,resetsAt:now+6540},{id:'weekly',label:'Weekly',left:40,used:60,resetsAt:now+180000}]},
  {key:'claude:work',provider:'claude',name:'Claude',account:'Work',plan:'max',updatedAt:now,windows:[{id:'session',label:'Session',left:18,used:82,resetsAt:now+4380}]},
  {key:'codex:personal',provider:'codex',name:'ChatGPT',account:'Personal',plan:'plus',updatedAt:now,windows:[{id:'session',label:'Session',left:0,used:100,resetsAt:now+7560},{id:'weekly',label:'Weekly',left:71,used:29,resetsAt:now+360000}],sessionTokens:2400000},
]});}

test('provider pin applies to all accounts and Priority excludes every unpinned provider',async()=>{
  const s=await scene();s.panel.data=fixture(s.model);
  for(const display of ['bars','icons']){
    s.save({display,page:'all'});
    const all=s.panel.render({});
    assert.match(text(all),/ChatGPT/);
    find(all,'pin-provider-claude').styles.on_click[0]({},clickContext);
    assert.match(text(s.panel.render({})),/ChatGPT/,'pinning must not remove providers from All Usage');
    find(s.panel.render({}),'page-priority').styles.on_click[0]({},clickContext);
    const output=text(s.panel.render({}));
    assert.match(output,/Claude/);assert.match(output,/Personal/);assert.match(output,/Work/);
    assert.doesNotMatch(output,/ChatGPT/);
  }
});
test('empty Priority never falls back to unpinned providers',async()=>{
  const s=await scene();s.panel.data=fixture(s.model);s.save({page:'priority'});
  const output=text(s.panel.render({}));assert.match(output,/No pinned providers/);assert.doesNotMatch(output,/Claude|ChatGPT/);
});
test('provider pin survives source account IDs, row reordering, and style changes',async()=>{
  const s=await scene();s.panel.data=fixture(s.model);
  find(s.panel.render({}),'pin-provider-claude').styles.on_click[0]({},clickContext);
  find(s.panel.render({}),'page-priority').styles.on_click[0]({},clickContext);
  const saved=s.saved();s.save({...saved,display:'icons'});
  s.panel.data.entries.reverse();s.panel.data.entries.forEach(e=>{e.key='new-source:'+e.key;});
  const tree=s.panel.render({});assert.match(text(tree),/Claude/);assert.doesNotMatch(text(tree),/ChatGPT/);
  find(tree,'pin-provider-claude').styles.on_click[0]({},clickContext);
  assert.match(text(s.panel.render({})),/No pinned providers/);
});
test('fill settings default to remaining and affect numbers and SVG fill together',async()=>{
  const s=await scene();assert.equal(s.model.preferences({}).fill,'remaining');s.panel.data=fixture(s.model);
  s.save({display:'icons'});
  let tree=s.panel.render({});assert.match(text(tree),/64% left/);assert.ok(assets(tree).includes('mods/codexbar/rings/64.svg'));
  s.panel.role='settings';const menu=s.panel.render({});assert.ok(find(menu,'setting-fill-remaining'));
  find(menu,'setting-fill-used').styles.on_click[0]();s.panel.role='panel';
  tree=s.panel.render({});assert.match(text(tree),/36% used/);assert.ok(assets(tree).includes('mods/codexbar/rings/36.svg'));
  assert.ok(assets(tree).includes('mods/codexbar/rings/100.svg'));
});
test('both styles and pages keep English labels and single-line percentages',async()=>{
  const s=await scene();s.panel.data=fixture(s.model);
  for(const display of ['bars','icons'])for(const page of ['all','priority'])for(const fill of ['remaining','used']){
    s.save({display,page,fill,pinnedProviders:['claude']});const tree=s.panel.render({});
    assert.doesNotMatch(text(tree),/[\u3400-\u9fff]/);
    const quota=find(tree,'quota-claude:personal/session');assert.ok(quota);
    const walk=node=>{if(typeof node==='string')return;for(const child of node?.nodes??[]){if(typeof child==='string'&&/\d+% (used|left)/.test(child))assert.ok(node.styles.whitespace_nowrap);walk(child);}};
    walk(quota);
  }
});
test('provider glyphs use transparent bundled assets instead of tinting background tiles',async()=>{
  const s=await scene();s.panel.data=fixture(s.model);
  const paths=assets(s.panel.render({}));
  assert.ok(paths.includes('mods/codexbar/provider-codex.svg'));assert.ok(paths.includes('mods/codexbar/provider-claude.svg'));
  assert.ok(!paths.includes('icons/codex.svg'));
});
test('light selected settings are distinct and contain a checkmark',async()=>{
  const s=await scene();s.save({appearance:'light',interval:300});s.panel.role='settings';
  const tree=s.panel.render({}),selected=find(tree,'setting-interval-300');
  assert.notEqual(selected.styles.bg[0],tree.styles.bg[0]);
  assert.ok(assets(selected).includes('mods/codexbar/check.svg'));
});
test('settings button opens a focused, sized scroll area and closes its own overlay',async()=>{
  const s=await scene();s.save({appearance:'light',pinnedProviders:['codex']});
  find(s.panel.render({}),'settings').styles.on_click[0]({},clickContext);
  assert.equal(s.overlays.length,1);
  const spec=s.overlays[0];assert.equal(spec.mod,'codexbar');
  assert.equal(spec.props.role,'settings');assert.ok(spec.width>0&&spec.height>0);
  s.props({...spec.props,overlay:'settings-overlay'});
  const overlay=s.create();let focused=false;
  overlay.init(undefined,{focus_handle:()=>({focus(){focused=true;}}),spawn(){throw Error('settings must not start usage reads');}});
  assert.ok(focused);
  const tree=overlay.render({});assert.equal(tree.styles.id[0],'codexbar-settings');
  assert.ok(tree.styles.size_full,'the overlay must fill the host allocation');
  assert.equal(tree.styles.overflow_y_scrollbar,undefined,'the scrollbar wrapper loses root sizing in GPUI');
  assert.ok(tree.styles.overflow_y_scroll,'scroll the sized root directly');
  find(tree,'settings-close').styles.on_click[0]({},clickContext);
  assert.deepEqual(s.closed,['settings-overlay']);
  assert.deepEqual(s.saved().pinnedProviders,['codex']);
});
test('display choices stay in settings while All Usage and Priority stay in navigation',async()=>{
  const s=await scene();const tree=s.panel.render({});assert.ok(find(tree,'page-all'));assert.ok(find(tree,'page-priority'));
  assert.equal(find(tree,'setting-display-icons'),null);
  s.panel.role='settings';const menu=s.panel.render({});assert.ok(find(menu,'setting-display-icons'));assert.ok(find(menu,'setting-display-bars'));
  assert.equal(s.model.DISPLAYS.length,2);
});
test('settings preserve fixed intervals and manual scheduling',async()=>{
  const s=await scene();s.panel.role='settings';const tree=s.panel.render({});
  for(const label of ['Manual','1 minute','2 minutes','5 minutes','15 minutes','30 minutes'])assert.ok(text(tree).includes(label));
  assert.doesNotMatch(text(tree),/Adaptive/);find(tree,'setting-interval-0').styles.on_click[0]();
  s.panel.role='panel';assert.match(text(s.panel.render({})),/Manual refresh/);
});
test('loading, empty and error states do not fabricate a full quota',async()=>{
  const s=await scene();s.panel.busy=true;assert.match(text(s.panel.render({})),/Reading usage/);
  s.panel.busy=false;assert.match(text(s.panel.render({})),/No usage available/);
  s.panel.error='Unable to read CodexBar';assert.match(text(s.panel.render({})),/Unable to read CodexBar/);
  assert.doesNotMatch(text(s.panel.render({})),/100%/);
});
