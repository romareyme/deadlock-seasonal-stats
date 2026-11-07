"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const logic = require("./source/bridge-v070.js")({test:true});
const seasons = JSON.parse(fs.readFileSync(path.join(__dirname,"reference/seasons-2026-11-07.json"),"utf8"));
const nowSeconds = Date.UTC(2026,10,7,12)/1000;
const pair = logic.seasonPair(seasons,nowSeconds), current = pair.current, previous = pair.previous;
assert.equal(current.name,"Beta Season 2"); assert.equal(previous.name,"Beta Season 1");
assert.equal(previous.end,current.start);
assert.equal(logic.seasonPair(seasons,current.start).current.key,current.key);
assert.equal(logic.seasonPair(seasons,current.start-1).current.key,previous.key);
assert.equal(logic.seasonPair(seasons,previous.start).previous,null);
assert.throws(()=>logic.seasonPair(seasons.concat(seasons),nowSeconds));
function match(id,time,badge,extra={}) {return {account_id:123,match_id:id,start_time:time,game_mode:1,match_mode:4,ranked_display_badge:badge,ranked_calibration_match:0,...extra};}
const history=[match(20,current.start,81),match(10,current.start-1,76),match(99,current.start+10,116,{match_mode:2}),match(50,current.end,116)];
assert.equal(logic.seasonRank(history,"123",current).badge,81);
assert.equal(logic.seasonRank(history,"123",previous).badge,76);
assert.equal(logic.seasonRank(history.slice().reverse(),"123",current).badge,81);
assert.equal(logic.seasonRank([history[1]],"123",current).state,"unavailable","old rank is never transferred to new season");
assert.equal(logic.seasonRank(history.concat(match(21,current.start+1,0,{ranked_calibration_match:1})),"123",current).state,"calibrating");
assert.equal(logic.seasonRank([match(1,current.start,null)],"123",current).state,"unavailable");
assert.throws(()=>logic.seasonRank([match(1,current.start,81,{account_id:456})],"123",current));
assert.equal(logic.seasonRank([match(1,current.start,117)],"123",current).state,"unavailable");
function stats(id,wins,matches) {return {account_id:123,hero_id:id,wins,matches_played:matches};}
const total=logic.aggregate([stats(1,9,9),stats(2,8,10),stats(3,16,20),stats(4,0,10)],"123");
assert.equal(total.wins,33);assert.equal(total.matches,49);
assert.deepEqual(total.best.map(x=>x.id),[3,2,4]);assert.deepEqual(total.worst.map(x=>x.id),[4,3,2]);

const elements={};
function panel(id) {return elements[id]={id,text:"",enabled:true,visible:false,IsValid(){return true;},FindChildTraverse(id){return elements[id];}};}
const root=panel("root"), profile=process.argv.includes("--profile");
root.paneltype=profile?"CitadelProfilePage":"CitadelProfileCard";
root.GetParent=()=>({paneltype:"CitadelContextMenuPlayer",GetParent:()=>null});
const name=panel(profile?"SelfName":"UserName");
for(const id of ["SeasonalStatsAccount","SeasonalStatsBridge","SeasonalStatsOpen","SeasonalStatsHeroesTitle","SeasonalStatsHeroesState","SeasonalStatsHeroesCurrent","SeasonalStatsHeroesPrevious"]) panel(id);
const images={Current:[],Previous:[]};
for(const slot of ["Current","Previous"]) {
    for(const suffix of ["Season","Value","Detail","RankName","RankImage"]) panel("SeasonalStats"+slot+suffix);
    elements["SeasonalStats"+slot+"RankImage"].SetImage=url=>images[slot].push(url);
}
for(const side of ["Best","Worst"]) for(let i=0;i<3;i++) {panel("SeasonalStats"+side+"Name"+i);panel("SeasonalStats"+side+"Value"+i);}
let now=nowSeconds*1000,onTitle,onURL;
const scheduled=[],urls=[],events=[];
elements.SeasonalStatsBridge.SetURL=url=>urls.push(url);
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"source/panorama/scripts/seasonal_stats.js"),"utf8"),{$:{
    GetContextPanel:()=>root, Schedule:(delay,cb)=>scheduled.push({delay,cb}),
    RegisterEventHandler:(event,target,cb)=>{if(event==="HTMLTitle")onTitle=cb;if(event==="HTMLURLChanged")onURL=cb;},
    DispatchEvent:(...args)=>events.push(args)
},Date:{now:()=>now},Math,JSON,encodeURIComponent,decodeURIComponent,isFinite});
function tick(){const i=scheduled.findIndex(x=>x.delay===.25);assert.ok(i>=0);scheduled.splice(i,1)[0].cb();}
function select(id){name.accountid=id;elements.SeasonalStatsAccount.text=String(id);tick();tick();}
function config(){const i=scheduled.findIndex(x=>x.delay===.15);if(i>=0)scheduled.splice(i,1)[0].cb();const url=new URL(urls.filter(x=>x.startsWith("https:")).at(-1));assert.equal(url.searchParams.get("protocol"),"2");return {account:url.searchParams.get("account"),request:url.searchParams.get("request")};}
function hero(name,wins,matches){return {state:"ok",wins,matches,hero_min_matches:10,best:[{id:1,name,wins,matches}],worst:[{id:1,name,wins,matches}]};}
function response(c,changes={}){return {kind:"update",done:true,...c,current:{...current,stats:hero("Infernus",6,10),rank:{state:"known",badge:81}},previous:{...previous,stats:hero("Viscous",10,20),rank:{state:"known",badge:76}},...changes};}
function title(data){return "DLSWR2:"+JSON.stringify(data);}
select(123);const first=config();onTitle(elements.SeasonalStatsBridge,title(response(first)));
assert.equal(elements.SeasonalStatsCurrentValue.text,"60,0%");assert.equal(elements.SeasonalStatsPreviousValue.text,"50,0%");
assert.match(images.Current.at(-1),/\/ranks\/8\/1\/image/);assert.match(images.Previous.at(-1),/\/ranks\/7\/6\/image/);
assert.equal(elements.SeasonalStatsBestName0.text,"Infernus");root.SeasonalStatsHeroes("previous");assert.equal(elements.SeasonalStatsBestName0.text,"Viscous");
assert.match(elements.SeasonalStatsHeroesTitle.text,/Beta Season 1/);
root.SeasonalStatsOpen();assert.deepEqual(events.at(-1),["ExternalBrowserGoToURL","https://statlocker.gg/profile/123"]);
select(456);const second=config();assert.equal(images.Current.at(-1),"");assert.equal(images.Previous.at(-1),"");
onTitle(title(response(first)));assert.equal(elements.SeasonalStatsCurrentValue.text,"—","old identity response rejected");
const calibration=response(second);calibration.current.rank={state:"calibrating"};calibration.current.stats={state:"ok",wins:0,matches:0,hero_min_matches:10,best:[],worst:[]};
onURL(elements.SeasonalStatsBridge,urls.filter(x=>x.startsWith("https:")).at(-1)+"#"+encodeURIComponent(title(calibration)));
assert.equal(elements.SeasonalStatsCurrentRankName.text,"Калибровка");assert.equal(elements.SeasonalStatsCurrentRankImage.visible,false);
assert.equal(elements.SeasonalStatsPreviousValue.text,"50,0%");assert.equal(elements.SeasonalStatsCurrentValue.text,"—");
const requests=urls.filter(x=>x.startsWith("https:")).length;select(123);assert.equal(urls.filter(x=>x.startsWith("https:")).length,requests,"switching back uses cache");
assert.equal(elements.SeasonalStatsCurrentValue.text,"60,0%");
name.accountid=0;tick();assert.equal(elements.SeasonalStatsOpen.enabled,false);assert.equal(images.Current.at(-1),"");assert.equal(images.Previous.at(-1),"");
select(789);const third=config();const overlap=response(third);overlap.previous.end=current.start+1;onTitle(title(overlap));assert.equal(elements.SeasonalStatsCurrentValue.text,"—","overlapping season payload rejected");
const partial=response(third,{done:false});partial.current.rank={state:"loading"};onTitle(title(partial));assert.equal(elements.SeasonalStatsCurrentValue.text,"60,0%");
assert.equal(elements.SeasonalStatsBridge.visible,true,"partial result must not close history request");
const lastTimeout=scheduled.findLastIndex(x=>x.delay===35);scheduled.splice(lastTimeout,1)[0].cb();assert.match(elements.SeasonalStatsCurrentRankName.text,/timeout/);assert.equal(elements.SeasonalStatsPreviousValue.text,"50,0%");
now+=11000;root.SeasonalStatsRefresh();assert.notEqual(config().request,third.request);
const fourth=config();onTitle(title(response(fourth,{previous:null})));assert.match(elements.SeasonalStatsPreviousSeason.text,/нет/);
now=current.end*1000;tick();assert.notEqual(config().request,fourth.request,"cache expires at the exact new season boundary");
console.log("PASS "+root.paneltype+": two seasons, exclusive boundaries, per-season badges, calibration, hero tabs, partial failures, identity isolation, caching and rollover.");

async function wireTest(failHistory=false){
    const calls=[],messages=[];
    const document={};Object.defineProperty(document,"title",{set(value){messages.push(JSON.parse(value.slice(7)));}});
    class XHR {open(method,url){this.url=url;}send(){calls.push(this.url);queueMicrotask(()=>{this.status=200;let data;
        if(this.url.includes("ranked-seasons"))data=seasons;
        else if(this.url.includes("match-history")){if(failHistory)this.status=503;data=history;}
        else data=[stats(1,6,10)];this.responseText=JSON.stringify(data);this.onload();});}}
    const context={document,location:{protocol:"https:",hash:""},XMLHttpRequest:XHR,Date:{now:()=>nowSeconds*1000},Promise,Math,JSON,encodeURIComponent,isFinite};
    vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,"source/bridge-v070.js"),"utf8"),context);
    vm.runInContext('seasonStatsBridgeV2({account:"123",request:"test"})',context);
    await new Promise(resolve=>setTimeout(resolve,10));
    const final=messages.at(-1);assert.equal(final.done,true);assert.equal(final.current.stats.state,"ok");assert.equal(final.previous.stats.state,"ok");
    assert.equal(final.current.rank.state,failHistory?"error":"known");assert.equal(final.previous.rank.state,failHistory?"error":"known");
    if(!failHistory){assert.equal(final.current.rank.badge,81);assert.equal(final.previous.rank.badge,76);}
    assert.ok(calls.some(url=>url.includes("min_unix_timestamp="+previous.start)&&url.includes("max_unix_timestamp="+(previous.end-1))));
    assert.ok(calls.some(url=>url.includes("min_unix_timestamp="+current.start)&&url.includes("max_unix_timestamp="+(current.end-1))));
    assert.equal(calls.length,4);assert.ok(title(final).length<8192);
}
(async()=>{await wireTest();await wireTest(true);console.log("PASS browser protocol: exact date filters and independent failure of rank history.");})().catch(e=>{console.error(e);process.exitCode=1;});
