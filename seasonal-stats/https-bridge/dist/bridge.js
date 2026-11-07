/* Runs inside the game's Chromium HTML panel, not the Panorama JS context. */
function seasonStatsBridge(config) {
    "use strict";
    var api = "https://api.deadlock-api.com";
    // Hero names from the public assets catalog, refreshed 2026-10-24.
    var heroNames = {"1":"Infernus","2":"Seven","3":"Vindicta","4":"Lady Geist","6":"Abrams","7":"Wraith","8":"McGinnis","10":"Paradox","11":"Dynamo","12":"Kelvin","13":"Haze","14":"Holliday","15":"Bebop","16":"Calico","17":"Grey Talon","18":"Mo & Krill","19":"Shiv","20":"Ivy","21":"Kali","25":"Warden","27":"Yamato","31":"Lash","35":"Viscous","38":"Gunslinger","39":"The Boss","48":"Wrecker","49":"Rutger","50":"Pocket","51":"Thumper","52":"Mirage","53":"Fathom","54":"Cadence","56":"Bomber","57":"Shield Guy","58":"Vyper","59":"Vandal","60":"Sinclair","61":"Trapper","62":"Raven","63":"Mina","64":"Drifter","65":"Venator","66":"Victor","67":"Paige","68":"Boho","69":"The Doorman","70":"Skyrunner","71":"Swan","72":"Billy","73":"Druid","74":"Graf","75":"Fortuna","76":"Graves","77":"Apollo","78":"Deadman Danny","79":"Rem","80":"Silver","81":"Celeste","82":"Opera","83":"hero_testhero","84":"Rat King","85":"Solomon","86":"Violet","87":"Nurse Harrow","88":"Baba"};
    function integer(value) {
        return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= 0;
    }
    function activeSeason(seasons, now) {
        if (!Array.isArray(seasons)) { throw new Error("schema"); }
        var found = [];
        seasons.forEach(function (season) {
            if (season.ranked_type !== "normal" || !Array.isArray(season.intervals)) { return; }
            season.intervals.forEach(function (interval) {
                if (integer(interval.start_timestamp) && integer(interval.end_timestamp) &&
                        interval.start_timestamp <= now && now < interval.end_timestamp) {
                    found.push({ name: String(season.name).slice(0, 80),
                        start: interval.start_timestamp, end: interval.end_timestamp });
                }
            });
        });
        if (found.length !== 1) { throw new Error("season"); }
        return found[0];
    }
    function aggregate(rows, account) {
        if (!Array.isArray(rows)) { throw new Error("schema"); }
        var wins = 0, matches = 0, seen = {}, heroes = [];
        rows.forEach(function (row) {
            if (!integer(row.account_id) || String(row.account_id) !== account ||
                    !integer(row.hero_id) || seen[row.hero_id] || !integer(row.wins) ||
                    !integer(row.matches_played) || row.wins > row.matches_played) {
                throw new Error("schema");
            }
            seen[row.hero_id] = true;
            wins += row.wins;
            matches += row.matches_played;
            if (row.matches_played >= 10) {
                heroes.push({ id: row.hero_id, name: heroNames[row.hero_id] || "Герой #" + row.hero_id,
                    wins: row.wins, matches: row.matches_played });
            }
        });
        function compare(direction) {
            return function (a, b) {
                return direction * (a.wins * b.matches - b.wins * a.matches) ||
                    b.matches - a.matches || a.id - b.id;
            };
        }
        return { wins: wins, matches: matches, hero_min_matches: 10,
            best: heroes.slice().sort(compare(-1)).slice(0, 3),
            worst: heroes.slice().sort(compare(1)).slice(0, 3) };
    }
    // Export the exact production functions for offline boundary tests.
    if (config.test) { return { activeSeason: activeSeason, aggregate: aggregate }; }
    function emit(payload) {
        payload.account = config.account;
        payload.request = config.request;
        var message = "DLSWR1:" + JSON.stringify(payload);
        document.title = message;
        // Chromium restricts fragment navigation on a data: document. A terminal
        // about:blank navigation carries the result through HTMLURLChanged instead.
        if (payload.kind !== "loading") {
            try {
                if (location.protocol === "data:") { location.replace("about:blank#" + encodeURIComponent(message)); }
                else { location.hash = encodeURIComponent(message); }
            } catch (ignore) {}
        }
    }
    function get(path) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", api + path, true);
            xhr.timeout = 12000;
            xhr.onload = function () {
                if (xhr.status !== 200) { reject(new Error("HTTP " + xhr.status)); return; }
                try { resolve(JSON.parse(xhr.responseText)); } catch (error) { reject(error); }
            };
            xhr.onerror = function () { reject(new Error("network")); };
            xhr.ontimeout = function () { reject(new Error("timeout")); };
            xhr.send();
        });
    }
    emit({ kind: "loading", stage: "seasons" });
    get("/v1/assets/ranked-seasons").then(function (seasons) {
        var season = activeSeason(seasons, Math.floor(Date.now() / 1000));
        emit({ kind: "loading", stage: "stats" });
        return get("/v1/players/hero-stats?account_ids=" + config.account +
            "&game_mode=normal&match_mode=ranked&min_unix_timestamp=" + season.start +
            "&max_unix_timestamp=" + (season.end - 1)).then(function (rows) {
                var stats = aggregate(rows, config.account);
                emit({ kind: "ok", season: season.name, start: season.start, end: season.end,
                    wins: stats.wins, matches: stats.matches, hero_min_matches: stats.hero_min_matches,
                    best: stats.best, worst: stats.worst });
            });
    }).catch(function (error) {
        emit({ kind: error.message === "season" ? "season" : "error", code: String(error.message).slice(0, 40) });
    });
}
if (typeof module !== "undefined") { module.exports = seasonStatsBridge; }
