(function () {
    "use strict";
    var root = $.GetContextPanel(), profilePage = root.paneltype === "CitadelProfilePage";
    var profileCard = root.paneltype === "CitadelProfileCard";
    var active = "", request = "", generation = 0, lastRefresh = 0;
    var lastCandidate = "", candidateTicks = 0, model = null, heroSlot = "current";
    var cache = {}, cacheOrder = [], medalKeys = { current: "", previous: "" }, bridge = null;
    var bridgeBase = "https://deadlock-seasonal-bridge-rm24.yokodav27.chatgpt.site/";
    var rankNames = __RANK_NAMES__;
    function valid(panel) { return panel && panel.IsValid && panel.IsValid(); }
    function find(id) { return root.FindChildTraverse(id); }
    function text(id, value) { var panel = find(id); if (valid(panel)) { panel.text = value; } }
    function integer(value) { return typeof value === "number" && isFinite(value) && value >= 0 && value % 1 === 0; }
    function account(value) {
        value = String(value === undefined || value === null ? "" : value);
        return /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 4294967295 ? value : "";
    }
    function identity() {
        var label = find("SeasonalStatsAccount"), name = find(profilePage ? "SelfName" : "UserName");
        var bound = valid(label) ? account(label.text) : "", nativeID = "", raw;
        try {
            if (valid(name)) {
                raw = name.accountid; nativeID = account(raw);
                if (raw !== undefined && raw !== null && !nativeID) { return ""; }
            }
        } catch (ignore) {}
        if (nativeID && bound && nativeID !== bound) { return ""; }
        return nativeID || bound;
    }
    function prefix(slot) { return "SeasonalStats" + (slot === "current" ? "Current" : "Previous"); }
    function medal(slot, data, season) {
        var image = find(prefix(slot) + "RankImage"), key = "", tier, sub;
        if (!valid(image)) { return; }
        if (data && data.state === "known" && integer(data.badge)) {
            tier = Math.floor(data.badge / 10); sub = data.badge % 10;
            if (tier >= 1 && tier <= 11 && sub >= 1 && sub <= 6) { key = active + ":" + season.key + ":" + data.badge; }
        }
        if (medalKeys[slot] === key) { return; }
        medalKeys[slot] = key; image.visible = false;
        try {
            image.SetImage("");
            if (key) {
                // Render the exact season badge, never the account's all-time/latest image.
                image.SetImage("https://api.deadlock-api.com/v1/assets/ranks/" + tier + "/" + sub + "/image?format=png");
                image.visible = true;
            }
        } catch (ignore) { image.visible = false; }
    }
    function code(value) { return typeof value === "string" && /^(HTTP [0-9]{3}|network|timeout|schema)$/.test(value) ? " · " + value : ""; }
    function clearHeroes(message) {
        text("SeasonalStatsHeroesState", message);
        for (var i = 0; i < 3; i++) {
            text("SeasonalStatsBestName" + i, "—"); text("SeasonalStatsBestValue" + i, "");
            text("SeasonalStatsWorstName" + i, "—"); text("SeasonalStatsWorstValue" + i, "");
        }
    }
    function clearUI(message) {
        model = null;
        ["current", "previous"].forEach(function (slot) {
            text(prefix(slot) + "Season", slot === "current" ? "Текущий сезон" : "Предыдущий сезон");
            text(prefix(slot) + "Value", "—"); text(prefix(slot) + "Detail", message);
            text(prefix(slot) + "RankName", "—"); medal(slot, null, null);
        });
        clearHeroes(message);
    }
    function validStats(stats) {
        return stats && (stats.state === "loading" || stats.state === "error" ||
            (stats.state === "ok" && integer(stats.wins) && integer(stats.matches) && stats.wins <= stats.matches));
    }
    function validSeason(season) {
        return season && typeof season.name === "string" && season.name.length <= 80 &&
            typeof season.key === "string" && season.key.length <= 100 && integer(season.start) &&
            integer(season.end) && season.start < season.end && validStats(season.stats) && season.rank &&
            /^(loading|error|known|calibrating|unranked|unavailable)$/.test(season.rank.state);
    }
    function renderSlot(slot, season) {
        var id = prefix(slot);
        if (!season) {
            text(id + "Season", "Предыдущего сезона нет"); text(id + "Value", "—");
            text(id + "Detail", "Нет завершённого сезона"); text(id + "RankName", "—"); medal(slot, null, null); return;
        }
        text(id + "Season", season.name);
        var stats = season.stats, rank = season.rank, rankText;
        text(id + "Value", stats.state === "loading" ? "…" : stats.state === "ok" && stats.matches ?
            (100 * stats.wins / stats.matches).toFixed(1).replace(".", ",") + "%" : "—");
        text(id + "Detail", stats.state === "ok" ? (stats.matches ? stats.wins + " побед / " + stats.matches + " матчей" :
            "Нет записанных матчей") : stats.state === "loading" ? "Загрузка матчей…" : "Ошибка статистики" + code(stats.code));
        rankText = rank.state === "loading" ? "Загрузка ранга…" : rank.state === "calibrating" ? "Калибровка" :
            rank.state === "unranked" ? "Без ранга" : rank.state === "error" ? "Ошибка ранга" + code(rank.code) : "Нет данных о ранге";
        if (rank.state === "known" && integer(rank.badge)) {
            var tier = Math.floor(rank.badge / 10), sub = rank.badge % 10;
            if (tier >= 1 && tier <= 11 && sub >= 1 && sub <= 6) { rankText = rankNames[tier] + " " + ["", "I", "II", "III", "IV", "V", "VI"][sub]; }
        }
        text(id + "RankName", rankText); medal(slot, rank, season);
    }
    function renderHeroes() {
        var season = model && model[heroSlot], stats = season && season.stats;
        text("SeasonalStatsHeroesTitle", "Герои · " + (season ? season.name : "выбранный сезон"));
        ["current", "previous"].forEach(function (slot) {
            var button = find("SeasonalStatsHeroes" + (slot === "current" ? "Current" : "Previous"));
            if (valid(button)) { button.enabled = !!(model && model[slot]) && slot !== heroSlot; }
        });
        if (!stats || stats.state !== "ok") { clearHeroes(stats && stats.state === "loading" ? "Загрузка героев…" : "Списки героев недоступны"); return; }
        function validList(list) {
            if (!Array.isArray(list) || list.length > 3) { return false; }
            var seen = {};
            for (var i = 0; i < list.length; i++) {
                var row = list[i];
                if (!row || !integer(row.id) || seen[row.id] || typeof row.name !== "string" || !row.name.length || row.name.length > 40 ||
                        !integer(row.wins) || !integer(row.matches) || row.matches < 10 || row.wins > row.matches ||
                        row.wins > stats.wins || row.matches > stats.matches) { return false; }
                seen[row.id] = true;
            }
            return true;
        }
        if (stats.hero_min_matches !== 10 || !validList(stats.best) || !validList(stats.worst)) { clearHeroes("Списки героев недоступны"); return; }
        clearHeroes(stats.best.length ? "Минимум 10 матчей на герое за выбранный сезон" : "Нет героев с 10 матчами за выбранный сезон");
        function fill(prefix, rows) {
            for (var i = 0; i < rows.length; i++) {
                text(prefix + "Name" + i, rows[i].name);
                text(prefix + "Value" + i, (100 * rows[i].wins / rows[i].matches).toFixed(1).replace(".", ",") + "% · " + rows[i].wins + "/" + rows[i].matches);
            }
        }
        fill("SeasonalStatsBest", stats.best); fill("SeasonalStatsWorst", stats.worst);
    }
    function render() { renderSlot("current", model.current); renderSlot("previous", model.previous); renderHeroes(); }
    function stopBridge() {
        var panel = find("SeasonalStatsBridge");
        try { if (valid(panel)) { panel.SetURL("about:blank"); panel.visible = false; } } catch (ignore) {}
    }
    function accept(message) {
        if (typeof message !== "string" || message.length > 8192 || message.indexOf("DLSWR2:") !== 0) { return; }
        var result;
        try { result = JSON.parse(message.slice(7)); } catch (ignore) { return; }
        if (!request || result.account !== active || result.request !== request || identity() !== active) { return; }
        if (result.kind === "loading") { return; }
        if (result.kind === "update") {
            var now = Date.now() / 1000;
            if (!validSeason(result.current) || result.current.start > now || now >= result.current.end ||
                    (result.previous !== null && (!validSeason(result.previous) || result.previous.end > result.current.start)) ||
                    typeof result.done !== "boolean") { return; }
            model = result; render();
            if (!result.done) { return; }
            result.expires = Math.min(Date.now() + 300000, result.current.end * 1000);
            if (!cache[active]) { cacheOrder.push(active); }
            cache[active] = result;
            if (cacheOrder.length > 24) { delete cache[cacheOrder.shift()]; }
        } else { clearUI(result.kind === "season" ? "Не найден текущий сезон" : "Не удалось загрузить данные" + code(result.code)); }
        request = ""; stopBridge();
    }
    function resolveBridge() {
        if (valid(bridge)) { return bridge; }
        bridge = find("SeasonalStatsBridge");
        if (valid(bridge)) {
            $.RegisterEventHandler("HTMLTitle", bridge, function () { accept(arguments.length > 1 ? arguments[1] : arguments[0]); });
            $.RegisterEventHandler("HTMLURLChanged", bridge, function () {
                var value = arguments.length > 1 ? arguments[1] : arguments[0];
                if (typeof value !== "string" || value.indexOf(bridgeBase + "?") !== 0 || value.indexOf("#") < 0) { return; }
                try { accept(decodeURIComponent(value.slice(value.indexOf("#") + 1))); } catch (ignore) {}
            });
        }
        return bridge;
    }
    function load() {
        var token = ++generation; lastRefresh = Date.now(); clearUI("Загрузка данных…");
        request = "r" + token + "x" + Math.floor(Math.random() * 2147483647);
        bridge = resolveBridge();
        if (!valid(bridge)) { request = ""; clearUI("HTML-панель недоступна"); return; }
        var url = bridgeBase + "?account=" + active + "&request=" + request + "&protocol=2&v=070";
        bridge.visible = true;
        $.Schedule(0.15, function () {
            if (!valid(root) || generation !== token || !request) { return; }
            try { bridge.SetURL(url); } catch (ignore) { request = ""; stopBridge(); clearUI("Не удалось запустить загрузку"); }
        });
        $.Schedule(35, function () {
            if (!valid(root) || generation !== token || !request) { return; }
            request = ""; stopBridge();
            if (!model) { clearUI("Время ожидания истекло · Обновить"); return; }
            ["current", "previous"].forEach(function (slot) {
                if (!model[slot]) { return; }
                if (model[slot].stats.state === "loading") { model[slot].stats = { state: "error", code: "timeout" }; }
                if (model[slot].rank.state === "loading") { model[slot].rank = { state: "error", code: "timeout" }; }
            });
            render();
        });
    }
    root.SeasonalStatsOpen = function () { if (active && identity() === active) { $.DispatchEvent("ExternalBrowserGoToURL", "https://statlocker.gg/profile/" + active); } };
    root.SeasonalStatsRefresh = function () { if (active && identity() === active && Date.now() - lastRefresh >= 10000) { load(); } };
    root.SeasonalStatsHeroes = function (slot) { if (model && (slot === "current" || slot === "previous") && model[slot]) { heroSlot = slot; renderHeroes(); } };
    function tick() {
        if (!valid(root)) { return; }
        var selected = identity(), link = find("SeasonalStatsOpen");
        if (selected !== lastCandidate) { lastCandidate = selected; candidateTicks = 0; }
        candidateTicks += 1;
        if (selected !== active) {
            active = ""; request = ""; generation += 1; stopBridge(); clearUI("Ожидание игрока…");
            if (selected && candidateTicks >= 2) {
                active = selected; heroSlot = "current";
                if (cache[active] && cache[active].expires > Date.now()) { model = cache[active]; render(); } else { load(); }
            }
        } else if (active && cache[active] && cache[active].expires <= Date.now() && !request) { load(); }
        if (valid(link)) { link.enabled = !!active && selected === active; }
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
            var stats = find("SeasonalStats"); if (valid(stats)) { stats.visible = context; }
            if (!context) { return; }
        }
        tick();
    }
    $.Schedule(0.25, start);
}());
