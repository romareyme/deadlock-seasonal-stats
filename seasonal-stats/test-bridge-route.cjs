"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
// The deployed router decides which bridge script the game's HTML panel loads, so it is
// tested against the same file that gets uploaded.
const html = fs.readFileSync(path.join(__dirname, "https-bridge/dist/index.html"), "utf8");
const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
assert.equal(blocks.length, 1, "index.html holds exactly one inline router script");
const source = blocks[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
// Router callbacks run inside a fresh VM realm, so their objects need normalizing.
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function route(search, available = {}) {
    const appended = [], titles = [], calls = [], status = { textContent: "" };
    const document = {
        getElementById: () => status,
        createElement: () => ({}),
        head: { appendChild(script) { appended.push(script); } }
    };
    Object.defineProperty(document, "title", { set(value) { titles.push(value); } });
    const context = { document, location: { search }, URLSearchParams, calls };
    if (available.v3 !== false) { context.seasonStatsBridgeV3 = (config) => calls.push(["v3", config]); }
    if (available.v2 !== false) { context.seasonStatsBridgeV2 = (config) => calls.push(["v2", config]); }
    if (available.legacy !== false) { context.seasonStatsBridge = (config) => calls.push(["v0", config]); }
    vm.createContext(context);
    vm.runInContext(source, context);
    if (appended.length) { appended[0].onload(); }
    function error() {
        assert.equal(titles.length, 1, "exactly one failure message");
        const prefix = titles[0].slice(0, 7);
        return { prefix, payload: JSON.parse(titles[0].slice(7)) };
    }
    return { appended, titles, status, calls, error };
}

// 0.7.0 and 0.5.0 clients keep their old routes.
let result = route("?account=123&request=p1&protocol=2");
assert.equal(result.appended.length, 1);
assert.equal(result.appended[0].src, "bridge-v070.js?v=070");
assert.deepEqual(plain(result.calls), [["v2", { account: "123", request: "p1" }]]);
assert.equal(result.titles.length, 0);

result = route("?account=123&request=p1");
assert.equal(result.appended[0].src, "bridge.js?v=050");
assert.deepEqual(plain(result.calls), [["v0", { account: "123", request: "p1" }]]);

// 0.8.0: seasonal load without party parameters.
result = route("?account=123&request=r1x5&protocol=2&v=080");
assert.equal(result.appended[0].src, "bridge-v080.js?v=080");
assert.deepEqual(plain(result.calls), [["v3", { account: "123", request: "r1x5", mode: "", check: "" }]]);

// 0.8.0: party list.
result = route("?account=123&request=p1z5&protocol=2&v=080&mode=party");
assert.deepEqual(plain(result.calls), [["v3", { account: "123", request: "p1z5", mode: "party", check: "" }]]);

// 0.8.0: pair check.
result = route("?account=123&request=p1z5&protocol=2&v=080&mode=party&check=456");
assert.deepEqual(plain(result.calls), [["v3", { account: "123", request: "p1z5", mode: "party", check: "456" }]]);

// A 0.8.0 mod against the currently deployed 0.7.0 router: the party request is refused
// outright instead of running the whole seasonal flow and hanging.
result = route("?account=123&request=p1z5&protocol=2&mode=party");
assert.equal(result.appended.length, 0, "no script is loaded for an unanswerable party request");
assert.deepEqual(plain(result.error().payload), { kind: "error", code: "bridge", account: "123", request: "p1z5" });

// The deployed host answers a missing bridge file with index.html and HTTP 200.
result = route("?account=123&request=r1x5&protocol=2&v=080", { v3: false });
assert.equal(result.error().payload.code, "bridge", "a missing bridge-v080.js must not look like a timeout");
result = route("?account=123&request=p1z5&protocol=2", { v2: false });
assert.equal(result.error().prefix, "DLSWR2:", "0.7.0 keeps its protocol prefix");
assert.equal(result.error().payload.code, "bridge");
result = route("?account=123&request=p1&protocol=1", { legacy: false });
assert.equal(result.error().prefix, "DLSWR1:", "the 0.5.0 protocol keeps DLSWR1");

// Invalid input never reaches the network.
for (const search of ["", "?account=0&request=p1&v=080", "?account=123&request=a%20b&v=080",
    "?account=4294967296&request=p1&v=080", "?account=123&v=080"]) {
    result = route(search);
    assert.equal(result.appended.length, 0, "no script for " + search);
    assert.equal(result.titles.length, 0, "no payload for " + search);
    assert.match(result.status.textContent, /Мост загрузки/, "the human-facing page explains itself");
}
assert.equal(route("?account=123&request=p1&v=080&check=0").error().payload.code, "check");
assert.equal(route("?account=123&request=p1&v=080&check=123").error().payload.code, "check", "self-check rejected");
assert.equal(route("?account=123&request=p1&v=080&mode=full").error().payload.code, "mode");
assert.equal(route("?account=123&request=p1&v=070&mode=full").error().payload.code, "mode",
    "an unknown mode is rejected for every version");

// A network-level failure still reaches the mod.
result = route("?account=123&request=p1&protocol=2&v=080");
result.appended[0].onerror();
assert.deepEqual(plain(result.error().payload), { kind: "error", code: "network", account: "123", request: "p1" });
console.log("PASS bridge router: 0.5/0.7/0.8 routes, party refusal, missing-file detection, input validation.");
