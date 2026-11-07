(function () {
    "use strict";
    var root = $.GetContextPanel();
    var profilePage = root.paneltype === "CitadelProfilePage";
    var profileCard = root.paneltype === "CitadelProfileCard";
    var active = "", request = "", generation = 0, lastRefresh = 0;
    var bridgeStage = "", bridgeURL = "";
    var cache = {}, cacheOrder = [], lastCandidate = "", candidateTicks = 0;
    var rankAccount = "";
    var bridgeBase = "https://deadlock-seasonal-bridge-rm24.quickaphid19.chatgpt.site/";
    function valid(panel) { return panel && panel.IsValid && panel.IsValid(); }
    function find(id) { return root.FindChildTraverse(id); }
    function account(value) {
        value = String(value === undefined || value === null ? "" : value);
        if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 4294967295) { return ""; }
        return value;
    }
    function identity() {
        var card = profilePage || profileCard ? root : find("ProfileCard"), label, name, bound = "", nativeID = "", raw;
        if (!valid(card)) { return ""; }
        label = card.FindChildTraverse("SeasonalStatsAccount");
        name = card.FindChildTraverse(profilePage ? "SelfName" : "UserName");
        if (valid(label)) { bound = account(label.text); }
        try {
            if (valid(name)) {
                raw = name.accountid;
                nativeID = account(raw);
                // A native zero belongs to a bot or an unresolved user, never a previous binding.
                if (raw !== undefined && raw !== null && !nativeID) { return ""; }
            }
        } catch (ignore) {}
        // Reject disagreement during native panel reuse. Never resolve by display name.
        if (nativeID && bound && nativeID !== bound) { return ""; }
        return nativeID || bound;
    }
    function text(id, value) { var panel = find(id); if (valid(panel)) { panel.text = value; } }
    function setRank(selected, refresh) {
        var image = find("SeasonalStatsRankImage");
        if (!valid(image) || (!refresh && rankAccount === selected)) { return; }
        rankAccount = selected;
        // Clear the previous identity before starting an asynchronous image load.
        image.visible = false;
        try {
            image.SetImage("");
            if (selected) {
                image.SetImage("https://api.deadlock-api.com/v1/players/" + selected +
                    "/rank/image?format=png&v=060&refresh=" + Date.now());
                image.visible = true;
            }
        } catch (ignore) { image.visible = false; }
    }
    function status(value, detail) {
        text("SeasonalStatsValue", value);
        text("SeasonalStatsDetail", detail);
    }
    function clearHeroes(message) {
        text("SeasonalStatsHeroesState", message);
        for (var i = 0; i < 3; i++) {
            text("SeasonalStatsBestName" + i, "—"); text("SeasonalStatsBestValue" + i, "");
            text("SeasonalStatsWorstName" + i, "—"); text("SeasonalStatsWorstValue" + i, "");
        }
    }
    function showHeroes(result) {
        function validList(list) {
            if (!Array.isArray(list) || list.length > 3) { return false; }
            var seen = {};
            for (var i = 0; i < list.length; i++) {
                var row = list[i];
                if (!row || !integer(row.id) || seen[row.id] || typeof row.name !== "string" ||
                        !row.name.length || row.name.length > 40 || !integer(row.wins) ||
                        !integer(row.matches) || row.matches < 10 || row.wins > row.matches ||
                        row.matches > result.matches || row.wins > result.wins) { return false; }
                seen[row.id] = true;
            }
            return true;
        }
        if (result.hero_min_matches !== 10 || !validList(result.best) || !validList(result.worst)) {
            clearHeroes("Списки героев недоступны"); return;
        }
        clearHeroes(result.best.length ? "Минимум 10 матчей на герое · текущий сезон" : "Нет героев с 10 матчами за сезон");
        function fill(prefix, rows) {
            for (var i = 0; i < rows.length; i++) {
                text(prefix + "Name" + i, rows[i].name);
                text(prefix + "Value" + i, (100 * rows[i].wins / rows[i].matches).toFixed(1).replace(".", ",") +
                    "% · " + rows[i].wins + "/" + rows[i].matches);
            }
        }
        fill("SeasonalStatsBest", result.best);
        fill("SeasonalStatsWorst", result.worst);
    }
    function integer(value) { return typeof value === "number" && isFinite(value) && value >= 0 && value % 1 === 0; }
    function stopBridge() {
        var panel = find("SeasonalStatsBridge");
        try {
            if (valid(panel)) { panel.SetURL("about:blank"); panel.visible = false; }
        } catch (ignore) {}
    }
    function show(result) {
        text("SeasonalStatsSeason", result.season);
        status(result.matches ? (100 * result.wins / result.matches).toFixed(1).replace(".", ",") + "%" : "—",
            result.matches ? result.wins + " побед / " + result.matches + " матчей" : "Нет записанных рейтинговых матчей");
        showHeroes(result);
    }
    function accept(title) {
        if (typeof title !== "string" || title.length > 2048 || title.indexOf("DLSWR1:") !== 0) { return; }
        var result;
        try { result = JSON.parse(title.slice(7)); } catch (ignore) { return; }
        if (result.account !== active || result.request !== request || identity() !== active) { return; }
        if (result.kind === "loading") {
            bridgeStage = result.stage === "stats" ? "stats" : "seasons";
            text("SeasonalStatsDetail", bridgeStage === "stats" ? "Загрузка рейтинговых матчей…" : "Определение текущего сезона…");
            return;
        }
        if (result.kind === "ok" && integer(result.wins) && integer(result.matches) && result.wins <= result.matches &&
                integer(result.start) && integer(result.end) && result.start <= Date.now() / 1000 &&
                Date.now() / 1000 < result.end && typeof result.season === "string") {
            result.season = result.season.slice(0, 80);
            result.expires = Math.min(Date.now() + 300000, result.end * 1000);
            if (!cache[active]) { cacheOrder.push(active); }
            cache[active] = result;
            if (cacheOrder.length > 24) { delete cache[cacheOrder.shift()]; }
            show(result);
        } else {
            var code = typeof result.code === "string" ? result.code : "";
            if (!/^(HTTP [0-9]{3}|network|timeout|schema)$/.test(code)) { code = ""; }
            status("—", result.kind === "season" ? "Текущий сезон не найден" :
                "Не удалось загрузить статистику" + (code ? " · " + code : ""));
            clearHeroes("Списки героев недоступны");
        }
        request = "";
        stopBridge();
    }
    var bridge = null;
    function resolveBridge() {
        if (valid(bridge)) { return bridge; }
        bridge = find("SeasonalStatsBridge");
        if (valid(bridge)) {
            $.RegisterEventHandler("HTMLTitle", bridge, function () {
                var value = arguments.length > 1 ? arguments[1] : arguments[0];
                accept(value);
            });
            $.RegisterEventHandler("HTMLURLChanged", bridge, function () {
                var value = arguments.length > 1 ? arguments[1] : arguments[0];
                if (typeof value !== "string" || value.indexOf(bridgeBase + "?") !== 0) { return; }
                var hash = value.indexOf("#");
                if (hash < 0) { return; }
                try { accept(decodeURIComponent(value.slice(hash + 1))); } catch (ignore) {}
            });
        }
        return bridge;
    }
    function load() {
        var token = ++generation;
        lastRefresh = Date.now();
        setRank(active, true);
        text("SeasonalStatsSeason", "Текущий сезон");
        status("…", "Загрузка статистики…");
        clearHeroes("Загрузка героев…");
        request = "r" + token + "x" + Math.floor(Math.random() * 2147483647);
        bridgeStage = "";
        bridge = resolveBridge();
        if (!valid(bridge)) { request = ""; status("—", "HTML-панель недоступна"); return; }
        // Deadlock replaces data: pages with about:blank. Load an ordinary HTTPS
        // document; only the public Account ID and a per-request nonce are sent.
        bridgeURL = bridgeBase + "?account=" + active + "&request=" + request + "&v=060";
        bridge.visible = true;
        $.Schedule(0.15, function () {
            if (!valid(root) || generation !== token || !request) { return; }
            try { bridge.SetURL(bridgeURL); }
            catch (ignore) { request = ""; stopBridge(); status("—", "Не удалось запустить загрузку"); }
        });
        $.Schedule(28, function () {
            if (valid(root) && generation === token && request) {
                request = ""; stopBridge(); status("—", !bridgeStage ?
                    "Встроенная страница не ответила · HTML" :
                    bridgeStage === "seasons" ? "Нет ответа сервиса сезонов" : "Нет ответа сервиса матчей");
            }
        });
    }
    root.SeasonalStatsOpen = function () {
        var selected = identity();
        if (selected && selected === active) {
            $.DispatchEvent("ExternalBrowserGoToURL", "https://statlocker.gg/profile/" + selected);
        }
    };
    root.SeasonalStatsRefresh = function () {
        if (active && active === identity() && Date.now() - lastRefresh >= 10000) { load(); }
    };
    function tick() {
        if (!valid(root)) { return; }
        var selected = identity(), link = find("SeasonalStatsOpen");
        if (selected !== lastCandidate) { lastCandidate = selected; candidateTicks = 0; }
        candidateTicks += 1;
        if (selected !== active) {
            active = ""; request = ""; generation += 1; stopBridge();
            setRank("", false);
            text("SeasonalStatsSeason", "Текущий сезон");
            status("—", "Ожидание Account ID игрока…");
            clearHeroes("Ожидание игрока…");
            if (selected && candidateTicks >= 2) {
                active = selected;
                if (cache[active] && cache[active].expires > Date.now()) { show(cache[active]); }
                else { load(); }
            }
        } else if (active && cache[active] && cache[active].expires <= Date.now() && !request) { load(); }
        if (valid(link)) { link.enabled = !!active && selected === active; }
        if (active && selected === active) { setRank(active, false); }
        $.Schedule(0.25, tick);
    }
    function start() {
        if (!valid(root)) { return; }
        if (profileCard) {
            var parent = root, context = false, depth = 0;
            while (parent && depth++ < 16) {
                if (parent.paneltype === "CitadelContextMenuPlayer") { context = true; break; }
                parent = parent.GetParent && parent.GetParent();
            }
            var stats = find("SeasonalStats");
            if (valid(stats)) { stats.visible = context; }
            if (!context) { return; }
        }
        tick();
    }
    $.Schedule(0.25, start);
}());
