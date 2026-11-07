"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const bridge = require("./source/bridge.js");
const logic = bridge({test: true});
const seasons = JSON.parse(fs.readFileSync(path.join(__dirname, "reference/seasons.json"), "utf8"));
const season = logic.activeSeason(seasons, 1792830000);
assert.equal(season.start, 1785430800);
assert.equal(season.end, 1793916000);
assert.equal(logic.activeSeason(seasons, season.start).start, season.start);
assert.notEqual(logic.activeSeason(seasons, season.end).start, season.start);
assert.throws(() => logic.activeSeason(seasons, season.start - 1));
assert.throws(() => logic.activeSeason(seasons.concat(seasons), season.start));
assert.deepEqual(logic.aggregate([], "123"), {wins: 0, matches: 0, hero_min_matches: 10, best: [], worst: []});
assert.deepEqual(logic.aggregate([
    {account_id: 123, hero_id: 1, wins: 4, matches_played: 5},
    {account_id: 123, hero_id: 2, wins: 1, matches_played: 5}
], "123"), {wins: 5, matches: 10, hero_min_matches: 10, best: [], worst: []});
const ranked = logic.aggregate([
    {account_id:123, hero_id:1, wins:9, matches_played:9}, // Ineligible 100%.
    {account_id:123, hero_id:2, wins:8, matches_played:10},
    {account_id:123, hero_id:3, wins:16, matches_played:20}, // Same rate, larger sample first.
    {account_id:123, hero_id:4, wins:4, matches_played:10},
    {account_id:123, hero_id:6, wins:0, matches_played:10}, // Eligible 0%.
    {account_id:123, hero_id:7, wins:5, matches_played:10},
    {account_id:123, hero_id:9999, wins:2, matches_played:10}
], "123");
assert.equal(ranked.wins, 44);
assert.equal(ranked.matches, 79, "minimum applies to hero lists only, not total win rate");
assert.deepEqual(ranked.best.map(row => row.id), [3,2,7]);
assert.deepEqual(ranked.worst.map(row => row.id), [6,9999,4]);
assert.equal(ranked.worst[1].name, "Герой #9999");
const oneHero = logic.aggregate([{account_id:123,hero_id:1,wins:6,matches_played:10}], "123");
assert.deepEqual(oneHero.best, oneHero.worst, "the same hero can legitimately occur in both small lists");
assert.equal(oneHero.best.length, 1);
for (const rows of [
    [{account_id: 999, hero_id: 1, wins: 4, matches_played: 5}],
    [{account_id: 123, hero_id: 1, wins: 6, matches_played: 5}],
    [{account_id: 123, hero_id: 1, wins: -1, matches_played: 5}],
    [{account_id: 123, hero_id: 1, wins: 1, matches_played: 1}, {account_id: 123, hero_id: 1, wins: 1, matches_played: 1}]
]) { assert.throws(() => logic.aggregate(rows, "123")); }

let now = 1792830000000;
const elements = {};
function panel(id) {
    return elements[id] = {id, text: "", enabled: true, IsValid() {return true;},
        FindChildTraverse(child) {return elements[child];}};
}
const root = panel("root");
const isProfilePage = process.argv.includes("--profile");
root.paneltype = isProfilePage ? "CitadelProfilePage" : "CitadelProfileCard";
root.GetParent = () => ({paneltype: "CitadelContextMenuPlayer", GetParent: () => null});
for (const id of ["ProfileCard", "UserName", "SeasonalStatsAccount", "SeasonalStatsValue", "SeasonalStatsDetail", "SeasonalStatsSeason", "SeasonalStatsOpen", "SeasonalStatsBridge", "SeasonalStatsHeroesState", "SeasonalStatsRankImage"]) {panel(id);}
for (const prefix of ["Best", "Worst"]) {
    for (let i=0;i<3;i++) {panel("SeasonalStats"+prefix+"Name"+i);panel("SeasonalStats"+prefix+"Value"+i);}
}
const identityName = isProfilePage ? panel("SelfName") : elements.UserName;
const scheduled = [], events = [], urls = [];
const medalURLs = [];
elements.SeasonalStatsRankImage.SetImage = url => medalURLs.push(url);
let onTitle, onURL;
elements.SeasonalStatsBridge.SetURL = url => urls.push(url);
const production = fs.readFileSync(path.join(__dirname, "source/seasonal_stats.js"), "utf8");
vm.runInNewContext(production, {$: {
    GetContextPanel: () => root,
    RegisterEventHandler: (name, target, cb) => {
        if (name === "HTMLTitle") {onTitle = cb;}
        if (name === "HTMLURLChanged") {onURL = cb;}
    },
    Schedule: (delay, cb) => scheduled.push({delay, cb}),
    DispatchEvent: (...args) => events.push(args)
}, Date: {now: () => now}, Math, JSON, encodeURIComponent, decodeURIComponent, isFinite});
function tick() {
    const index = scheduled.findIndex(item => item.delay === .25);
    assert.ok(index >= 0);
    scheduled.splice(index, 1)[0].cb();
}
function select(account) {
    identityName.accountid = Number(account);
    elements.SeasonalStatsAccount.text = String(account);
    tick(); tick();
}
function config() {
    const pending = scheduled.findIndex(item => item.delay === .15);
    if (pending >= 0) {scheduled.splice(pending, 1)[0].cb();}
    const url = new URL(urls.filter(url => url.startsWith("https:")).at(-1));
    return {account: url.searchParams.get("account"), request: url.searchParams.get("request")};
}
function response(selected, values = {}) {
    return "DLSWR1:" + JSON.stringify({...selected, kind: "ok", season: "Beta Season 1", start: season.start, end: season.end, wins: 5, matches: 10,
        hero_min_matches: 10, best:[{id:1,name:"Infernus",wins:5,matches:10}], worst:[{id:1,name:"Infernus",wins:5,matches:10}], ...values});
}
select(123);
const first = config();
assert.equal(first.account, "123");
assert.equal(new URL(medalURLs.at(-1)).pathname, "/v1/players/123/rank/image");
const firstMedalURL = medalURLs.at(-1);
const medalLoadCount = medalURLs.length;
tick();
assert.equal(medalURLs.length, medalLoadCount, "polling must not issue repeated image requests");
assert.equal(elements.SeasonalStatsBridge.visible, true, "browser must render while loading");
onTitle(response(first, {kind: "loading", stage: "seasons"}));
assert.match(elements.SeasonalStatsDetail.text, /Определение/);
onTitle(elements.SeasonalStatsBridge, response(first));
assert.equal(elements.SeasonalStatsValue.text, "50,0%");
assert.equal(elements.SeasonalStatsBestName0.text, "Infernus");
assert.equal(elements.SeasonalStatsWorstValue0.text, "50,0% · 5/10");
assert.equal(elements.SeasonalStatsBestName1.text, "—");
assert.equal(elements.SeasonalStatsBridge.visible, false, "browser is hidden after completion");
root.SeasonalStatsOpen();
assert.deepEqual(events.at(-1), ["ExternalBrowserGoToURL", "https://statlocker.gg/profile/123"]);
select(456);
const second = config();
assert.equal(new URL(medalURLs.at(-1)).pathname, "/v1/players/456/rank/image");
assert.equal(medalURLs.at(-2), "", "old player's medal cleared before loading a different account");
assert.equal(elements.SeasonalStatsBestName0.text, "—", "previous player's heroes cleared immediately");
assert.notEqual(second.request, first.request);
onTitle(elements.SeasonalStatsBridge, response(first, {wins: 10}));
assert.equal(elements.SeasonalStatsValue.text, "…", "stale player response rejected");
onURL(elements.SeasonalStatsBridge, urls.filter(url => url.startsWith("https:")).at(-1) + "#" + encodeURIComponent(response(second, {wins: 0, matches: 0, best:[],worst:[]})));
assert.equal(elements.SeasonalStatsValue.text, "—");
assert.match(elements.SeasonalStatsDetail.text, /Нет записанных/);
assert.match(elements.SeasonalStatsHeroesState.text, /Нет героев с 10/);
identityName.accountid = 0; // Old bound label still contains the last human account.
tick();
assert.equal(elements.SeasonalStatsOpen.enabled, false);
assert.equal(medalURLs.at(-1), "");
assert.equal(elements.SeasonalStatsRankImage.visible, false, "bot cannot retain previous player's medal");
const previousEvents = events.length;
root.SeasonalStatsOpen();
assert.equal(events.length, previousEvents, "bot never opens previous player's link");
select(789);
const third = config();
onTitle(response(third, {wins: 11, matches: 10}));
assert.equal(elements.SeasonalStatsValue.text, "—");
assert.match(elements.SeasonalStatsDetail.text, /Не удалось/);
now += 11000;
const beforeRefreshMedalURL = medalURLs.at(-1);
root.SeasonalStatsRefresh();
assert.notEqual(medalURLs.at(-1), beforeRefreshMedalURL, "manual refresh also refreshes the medal");
assert.notEqual(medalURLs.at(-1), firstMedalURL);
assert.notEqual(config().request, third.request);
const fourth = config();
onTitle(response(fourth, {kind: "error", code: "HTTP 503"}));
assert.match(elements.SeasonalStatsDetail.text, /HTTP 503/);
assert.equal(elements.SeasonalStatsBestName0.text, "—");
console.log("PASS (" + root.paneltype + "): season boundaries, strict ranked aggregates, zero matches, identity switch, stale response, bot identity, profile URL, error state, manual refresh.");
