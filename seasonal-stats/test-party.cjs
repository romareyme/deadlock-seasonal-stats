"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const logic = require("./source/bridge-v080.js")({ test: true });
const seasons = JSON.parse(fs.readFileSync(path.join(__dirname, "reference/seasons-2026-11-07.json"), "utf8"));

/* ---------- 1. bridge logic: mate normalization ---------- */
const nowSeconds = Date.UTC(2026, 10, 7, 12) / 1000;
const pair = logic.seasonPair(seasons, nowSeconds);
assert.equal(pair.current.name, "Beta Season 2", "season logic is carried over unchanged");
assert.deepEqual(logic.partyMates([], "123"), []);
const mates = logic.partyMates([
    { mate_id: 456, wins: 5, matches_played: 10, matches: [1, 2] },
    { mate_id: 789, wins: 1, matches_played: 10, matches: [3] },
    { mate_id: 321, wins: 9, matches_played: 30, matches: [] }
], "123");
assert.deepEqual(mates.map(m => [m.id, m.matches, m.wins]), [[321, 30, 9], [456, 10, 5], [789, 10, 1]], "matches, then wins, then id");
assert.deepEqual(logic.partyMates([{ mate_id: 123, wins: 4, matches_played: 5 }], "123"), [], "the player is never their own mate");
assert.deepEqual(logic.partyMates([{ mate_id: 0, wins: 4, matches_played: 5 }], "123"), [], "anonymous rows are dropped, not fatal");
for (const rows of [
    [{ mate_id: 456, wins: 6, matches_played: 5 }],
    [{ mate_id: 456, wins: 1, matches_played: 0 }],
    [{ mate_id: 456, wins: -1, matches_played: 5 }],
    [{ mate_id: 456.5, wins: 1, matches_played: 5 }],
    [{ mate_id: 456, wins: 1, matches_played: 5 }, { mate_id: 456, wins: 1, matches_played: 5 }],
    [{ mate_id: 456, wins: 1 }],
    [{ mate_id: 456, wins: 1, matches_played: 5 }, null]
]) { assert.throws(() => logic.partyMates(rows, "123"), Error, JSON.stringify(rows)); }
assert.throws(() => logic.partyMates({}, "123"));

/* ---------- 2. pair resolution across both directions ---------- */
const fwd = [{ id: 456, wins: 5, matches: 10 }];
assert.deepEqual(logic.partyPair(fwd, null, "123", "456"), { state: "same", matches: 10, wins: 5 });
assert.deepEqual(logic.partyPair(fwd, [{ id: 123, wins: 7, matches: 20 }], "123", "456"),
    { state: "same", matches: 20, wins: 7 }, "the richer of the two directions wins");
assert.deepEqual(logic.partyPair([], [{ id: 123, wins: 7, matches: 20 }], "123", "456"),
    { state: "same", matches: 20, wins: 7 }, "one-sided coverage still answers yes");
assert.deepEqual(logic.partyPair(fwd, [{ id: 123, wins: 1, matches: 3 }], "123", "456"),
    { state: "same", matches: 10, wins: 5 });
assert.deepEqual(logic.partyPair([], [], "123", "456"), { state: "not", matches: 0, wins: 0 });
assert.deepEqual(logic.partyPair([], null, "123", "456"), { state: "not", matches: 0, wins: 0 });
assert.deepEqual(logic.partyPair([{ id: 789, wins: 1, matches: 2 }], null, "123", "456"),
    { state: "not", matches: 0, wins: 0 }, "another mate does not match the target");

/* ---------- 3. payload bounds ---------- */
const many = [1, 2, 3, 4, 5].map((n) => ({ id: 400 + n, wins: 10 - n, matches: 20 - n }));
const names = { 456: "Oebro", 401: "Первый", 402: "x".repeat(80) };
const bounded = logic.partyPayload(many, null, "123", "", names);
assert.equal(bounded.total, 5);
assert.equal(bounded.mates.length, 3, "the payload never carries more than three mates");
assert.equal(bounded.check, null);
assert.deepEqual(bounded.mates.map((m) => m.id), [401, 402, 403]);
assert.equal(bounded.mates[0].name, "Первый");
assert.equal(bounded.mates[1].name.length, 40, "names are clipped");
assert.equal(bounded.mates[2].name, "", "a missing profile yields no name");
const withCheck = logic.partyPayload(fwd, null, "123", "456", names);
assert.deepEqual(withCheck.check, { id: 456, name: "Oebro", state: "same", matches: 10, wins: 5 });
const missed = logic.partyPayload(fwd, null, "123", "999", names);
assert.deepEqual(missed.check, { id: 999, name: "", state: "not", matches: 0, wins: 0 });

/* ---------- 4. browser protocol: party mode ---------- */
async function wireParty({ check = "", fail = "" } = {}) {
    const calls = [], messages = [];
    const document = {};
    Object.defineProperty(document, "title", { set(value) { messages.push(JSON.parse(value.slice(7))); } });
    const mateRows = [
        { mate_id: 302991072, wins: 63, matches_played: 121, matches: [1] },
        { mate_id: 46300492, wins: 45, matches_played: 83, matches: [2] },
        { mate_id: 263710796, wins: 33, matches_played: 65, matches: [3] },
        { mate_id: 1063573680, wins: 19, matches_played: 39, matches: [4] }
    ];
    const reverseRows = check === "302991072" ? [{ mate_id: 123, wins: 70, matches_played: 130, matches: [5] }] : [];
    class XHR {
        open(method, url) { this.url = url; }
        send() {
            calls.push(this.url);
            queueMicrotask(() => {
                this.status = 200;
                if (fail && this.url.includes(fail)) { this.status = 503; this.responseText = "{}"; this.onload(); return; }
                if (this.url.includes("mate-stats")) {
                    this.responseText = JSON.stringify(this.url.includes("/players/123/") ? mateRows : reverseRows);
                } else if (this.url.includes("players/steam")) {
                    this.responseText = JSON.stringify([
                        { account_id: 302991072, personaname: "Oebro" },
                        { account_id: 46300492, personaname: "Second" },
                        { account_id: 263710796, personaname: "Third" }
                    ]);
                } else { this.responseText = "[]"; }
                this.onload();
            });
        }
    }
    const context = { document, location: { protocol: "https:", hash: "" }, XMLHttpRequest: XHR,
        Date: { now: () => nowSeconds * 1000 }, Promise, Math, JSON, encodeURIComponent, isFinite };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "source/bridge-v080.js"), "utf8"), context);
    vm.runInContext(`seasonStatsBridgeV3({account:"123",request:"p1",mode:"party",check:"${check}"})`, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { calls, messages, final: messages.at(-1) };
}
(async () => {
    const plain = await wireParty();
    assert.deepEqual(plain.messages[0], { kind: "loading", stage: "party", account: "123", request: "p1" },
        "party mode announces itself before any slow request");
    assert.equal(plain.final.kind, "party");
    assert.equal(plain.final.total, 4);
    assert.deepEqual(plain.final.mates.map((m) => m.id), [302991072, 46300492, 263710796]);
    assert.equal(plain.final.mates[0].name, "Oebro");
    assert.equal(plain.final.check, null);
    assert.equal(plain.calls.length, 2, "mate list plus names");
    assert.ok(plain.calls[0].endsWith("/v1/players/123/mate-stats?same_party=true"));
    assert.match(plain.calls[1], /players\/steam\?account_ids=302991072,46300492,263710796$/);
    assert.ok(!plain.calls.some((url) => url.includes("ranked-seasons")), "party mode never loads seasons");

    const checked = await wireParty({ check: "302991072" });
    assert.equal(checked.final.kind, "party");
    assert.deepEqual(checked.final.check, { id: 302991072, name: "Oebro", state: "same", matches: 130, wins: 70 });
    assert.equal(checked.calls.length, 3);
    assert.ok(checked.calls.some((url) => url.endsWith("/v1/players/302991072/mate-stats?same_party=true")), "the target is checked too");
    assert.match(checked.calls.at(-1), /account_ids=302991072,46300492,263710796,302991072$/);

    const unknown = await wireParty({ check: "777" });
    assert.deepEqual(unknown.final.check, { id: 777, name: "", state: "not", matches: 0, wins: 0 });

    const noNames = await wireParty({ fail: "players/steam" });
    assert.equal(noNames.final.kind, "party", "a missing Steam profile does not hide the party list");
    assert.equal(noNames.final.mates[0].name, "");

    const broken = await wireParty({ fail: "mate-stats" });
    assert.equal(broken.final.kind, "error");
    assert.match(broken.final.code, /HTTP 503/);

    const zero = await wireParty({ check: "0" });
    assert.deepEqual(zero.final, { kind: "error", code: "check", account: "123", request: "p1" });
    assert.equal(zero.calls.length, 0, "an invalid target never reaches the network");
    const self = await wireParty({ check: "123" });
    assert.equal(self.final.code, "self");
    console.log("PASS bridge 0.8.0: mate normalization, two-way pair resolution, bounded payloads, party wire protocol.");

    /* ---------- 5. panel behaviour ---------- */
    const elements = {};
    function panel(id) {
        return elements[id] = { id, text: "", enabled: true, visible: false, IsValid() { return true; },
            FindChildTraverse(child) { return elements[child]; } };
    }
    const root = panel("root"), profilePage = process.argv.includes("--profile");
    root.paneltype = profilePage ? "CitadelProfilePage" : "CitadelProfileCard";
    root.GetParent = () => ({ paneltype: "CitadelContextMenuPlayer", GetParent: () => null });
    const identityName = panel(profilePage ? "SelfName" : "UserName");
    for (const id of ["SeasonalStatsAccount", "SeasonalStatsBridge", "SeasonalStatsOpen", "SeasonalStatsHeroesTitle",
        "SeasonalStatsHeroesState", "SeasonalStatsHeroesCurrent", "SeasonalStatsHeroesPrevious", "SeasonalStatsPartyState",
        "SeasonalStatsPartyMate0", "SeasonalStatsPartyMate1", "SeasonalStatsPartyMate2", "SeasonalStatsPartyCheckInput",
        "SeasonalStatsPartyCheckButton", "SeasonalStatsPartyCheckResult", "SeasonalStatsPartyBridge"]) { panel(id); }
    for (const slot of ["Current", "Previous"]) {
        for (const suffix of ["Season", "Value", "Detail", "RankName", "RankImage"]) { elements["SeasonalStats" + slot + suffix] = panel("SeasonalStats" + slot + suffix); }
        elements["SeasonalStats" + slot + "RankImage"].SetImage = () => {};
    }
    for (const side of ["Best", "Worst"]) { for (let i = 0; i < 3; i++) { panel("SeasonalStats" + side + "Name" + i); panel("SeasonalStats" + side + "Value" + i); } }
    const profileUrls = [], partyUrls = [], scheduled = [], titles = new Map(), urls = [];
    let now = nowSeconds * 1000;
    elements.SeasonalStatsBridge.SetURL = (url) => { if (url.startsWith("https:")) { profileUrls.push(url); } };
    elements.SeasonalStatsPartyBridge.SetURL = (url) => { if (url.startsWith("https:")) { partyUrls.push(url); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "source/panorama/scripts/seasonal_stats.js"), "utf8"), {
        $: {
            GetContextPanel: () => root,
            Schedule: (delay, cb) => scheduled.push({ delay, cb }),
            RegisterEventHandler: (event, target, cb) => { if (event === "HTMLTitle") { titles.set(target, cb); } else { urls.push([target, cb]); } },
            DispatchEvent: () => {}
        },
        Date: { now: () => now }, Math, JSON, encodeURIComponent, decodeURIComponent, isFinite
    });
    function run(delay) {
        const pending = scheduled.filter((item) => item.delay === delay);
        scheduled.splice(0, scheduled.length, ...scheduled.filter((item) => item.delay !== delay));
        pending.forEach((item) => item.cb());
        return pending.length;
    }
    function tick() { assert.ok(run(.25), "tick is always scheduled"); }
    function select(id) { identityName.accountid = Number(id); elements.SeasonalStatsAccount.text = String(id); tick(); tick(); }
    const request = (url) => new URL(url).searchParams.get("request");
    function emitTitle(target, payload) { titles.get(target)(target, "DLSWR2:" + JSON.stringify(payload)); }
    function partyResponse(values = {}) {
        const url = new URL(partyUrls.at(-1));
        return Object.assign({ kind: "party", account: url.searchParams.get("account"), request: url.searchParams.get("request"),
            total: 4, mates: [
                { id: 302991072, name: "Oebro", wins: 63, matches: 121 },
                { id: 46300492, name: "", wins: 45, matches: 83 },
                { id: 263710796, name: "Third", wins: 33, matches: 65 }
            ], check: null }, values);
    }
    function profileResponse() {
        const url = new URL(profileUrls.at(-1));
        return { kind: "update", done: true, account: url.searchParams.get("account"), request: url.searchParams.get("request"),
            current: { name: "Beta Season 2", key: "a:1", start: pair.current.start, end: pair.current.end,
                stats: { state: "ok", wins: 6, matches: 10, hero_min_matches: 10, best: [{ id: 1, name: "Infernus", wins: 6, matches: 10 }], worst: [] },
                rank: { state: "known", badge: 81 } },
            previous: null };
    }

    select(456);
    run(.15);
    assert.equal(profileUrls.length, 1);
    assert.equal(partyUrls.length, 1, "the party bridge is driven independently of the seasonal one");
    const partyURL = new URL(partyUrls[0]);
    assert.equal(partyURL.searchParams.get("mode"), "party");
    assert.equal(partyURL.searchParams.get("v"), "080");
    assert.equal(partyURL.searchParams.get("protocol"), "2");
    assert.equal(partyURL.searchParams.get("check"), null, "no target is sent for the plain list");
    assert.equal(new URL(profileUrls[0]).searchParams.get("mode"), null, "the seasonal request is unchanged");
    assert.equal(elements.SeasonalStatsPartyState.text, "Загрузка пати…");
    assert.equal(elements.SeasonalStatsPartyCheckButton.enabled, true);

    emitTitle(elements.SeasonalStatsPartyBridge, partyResponse());
    assert.equal(elements.SeasonalStatsPartyState.text, "4 напарника по пати");
    assert.equal(elements.SeasonalStatsPartyMate0.text, "Oebro · 121 матч · 52,1%");
    assert.equal(elements.SeasonalStatsPartyMate1.text, "#46300492 · 83 матча · 54,2%", "a name-less mate keeps the id");
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "");

    const stale = partyResponse({ request: "pX" });
    emitTitle(elements.SeasonalStatsPartyBridge, stale);
    assert.equal(elements.SeasonalStatsPartyMate0.text, "Oebro · 121 матч · 52,1%", "a foreign request id changes nothing");

    emitTitle(elements.SeasonalStatsBridge, profileResponse());
    assert.equal(elements.SeasonalStatsCurrentValue.text, "60,0%", "the seasonal panel is unaffected by party data");

    elements.SeasonalStatsPartyCheckInput.text = "302991072";
    root.SeasonalStatsPartyCheck();
    run(.15);
    assert.equal(partyUrls.length, 2);
    assert.equal(new URL(partyUrls.at(-1)).searchParams.get("check"), "302991072");
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "Проверка…");
    assert.equal(elements.SeasonalStatsPartyMate0.text, "Oebro · 121 матч · 52,1%", "the list stays while checking");
    emitTitle(elements.SeasonalStatsPartyBridge, partyResponse({
        check: { id: 302991072, name: "Oebro", state: "same", matches: 130, wins: 70 } }));
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "В пати с Oebro: 130 матчей · 53,8%");
    assert.equal(elements.SeasonalStatsPartyState.text, "4 напарника по пати");

    const listBefore = elements.SeasonalStatsPartyMate0.text;
    elements.SeasonalStatsPartyCheckInput.text = "777";
    root.SeasonalStatsPartyCheck();
    run(.15);
    emitTitle(elements.SeasonalStatsPartyBridge, partyResponse({ check: { id: 777, name: "", state: "not", matches: 0, wins: 0 } }));
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "С #777 совместных пати-матчей нет");
    assert.equal(elements.SeasonalStatsPartyMate0.text, listBefore);

    elements.SeasonalStatsPartyCheckInput.text = "302991072";
    root.SeasonalStatsPartyCheck();
    run(.15);
    const before = partyUrls.length;
    emitTitle(elements.SeasonalStatsPartyBridge, { kind: "update", account: "456", request: request(partyUrls.at(-1)), done: true });
    assert.equal(elements.SeasonalStatsPartyState.text, "Мост не обновлён: нужен v0.8.0",
        "a 0.7.0 bridge is reported instead of hanging");
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "Пати недоступно без обновления моста");
    assert.equal(elements.SeasonalStatsPartyMate0.text, listBefore, "an outdated bridge does not erase the list");
    assert.equal(partyUrls.length, before);

    elements.SeasonalStatsPartyCheckInput.text = "abc";
    root.SeasonalStatsPartyCheck();
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "Введите Account ID: до 10 цифр");
    elements.SeasonalStatsPartyCheckInput.text = "456";
    root.SeasonalStatsPartyCheck();
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "Это тот же игрок");
    assert.equal(partyUrls.length, before, "rejected input never starts a request");

    select(789);
    assert.equal(elements.SeasonalStatsPartyMate0.text, "", "another player clears the mate list");
    assert.equal(elements.SeasonalStatsPartyCheckResult.text, "");
    run(.15);
    assert.equal(partyUrls.length, before + 1);
    run(25);
    assert.equal(elements.SeasonalStatsPartyState.text, "Пати: время ожидания истекло");

    select(456);
    const cached = partyUrls.length;
    assert.equal(elements.SeasonalStatsPartyMate0.text, "Oebro · 121 матч · 52,1%", "the mate list is cached for five minutes");
    assert.equal(elements.SeasonalStatsPartyCheckButton.enabled, true);
    assert.equal(partyUrls.length, cached, "a cached player needs no new party request");
    now += 300001;
    tick();
    run(.15);
    assert.equal(partyUrls.length, cached + 1, "the cache expires after five minutes");
    assert.equal(elements.SeasonalStatsPartyState.text, "Загрузка пати…");

    elements.SeasonalStatsAccount.text = "";
    identityName.accountid = 0;
    tick();
    assert.equal(elements.SeasonalStatsPartyCheckButton.enabled, false, "no player means no check button");
    assert.equal(elements.SeasonalStatsPartyMate0.text, "");
    console.log("PASS party panel (" + root.paneltype + "): list, pair check, stale and outdated responses, cache, identity switch.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
