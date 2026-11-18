(function () {
    "use strict";
    var root = $.GetContextPanel(), profilePage = root.paneltype === "CitadelProfilePage";
    var profileCard = root.paneltype === "CitadelProfileCard";
    var active = "", request = "", generation = 0, lastRefresh = 0;
    var lastCandidate = "", candidateTicks = 0, model = null, heroSlot = "current";
    var cache = {}, cacheOrder = [], medalKeys = { current: "", previous: "" }, bridge = null;
    var partyRequest = "", partyTarget = "", partyGeneration = 0, partyModel = null, partyBridge = null;
    var partyCache = {}, partyOrder = [];
    var bridgeBase = "__BRIDGE_BASE__";
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
    function plural(value, one, few, many) {
        var tail = value % 100, last = value % 10;
        if (tail >= 11 && tail <= 14) { return many; }
        if (last === 1) { return one; }
        return last >= 2 && last <= 4 ? few : many;
    }
    function percent(wins, matches) { return (100 * wins / matches).toFixed(1).replace(".", ",") + "%"; }
    function label(id, name) { return name ? name.slice(0, 40) : "#" + id; }
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
            percent(stats.wins, stats.matches) : "—");
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
                text(prefix + "Value" + i, percent(rows[i].wins, rows[i].matches) + " · " + rows[i].wins + "/" + rows[i].matches);
            }
        }
        fill("SeasonalStatsBest", stats.best); fill("SeasonalStatsWorst", stats.worst);
    }
    function render() { renderSlot("current", model.current); renderSlot("previous", model.previous); renderHeroes(); }
    function clearParty(message, target) {
        partyModel = null;
        text("SeasonalStatsPartyState", message);
        for (var i = 0; i < 3; i++) { text("SeasonalStatsPartyMate" + i, ""); }
        text("SeasonalStatsPartyCheckResult", target || "");
    }
    function renderCheck(check) {
        if (!check) { text("SeasonalStatsPartyCheckResult", ""); return; }
        var who = label(check.id, check.name);
        text("SeasonalStatsPartyCheckResult", check.state === "same" ?
            "В пати с " + who + ": " + check.matches + " " + plural(check.matches, "матч", "матча", "матчей") +
                " · " + percent(check.wins, check.matches) :
            check.state === "not" ? "С " + who + " совместных пати-матчей нет" : "Не удалось проверить пати");
    }
    function renderParty() {
        var data = partyModel;
        if (!data || data.state !== "ok") { return; }
        text("SeasonalStatsPartyState", data.total ?
            data.total + " " + plural(data.total, "напарник", "напарника", "напарников") + " по пати" :
            "Совместных игр в пати не найдено");
        for (var i = 0; i < 3; i++) {
            var mate = data.mates[i];
            text("SeasonalStatsPartyMate" + i, mate ? label(mate.id, mate.name) + " · " +
                mate.matches + " " + plural(mate.matches, "матч", "матча", "матчей") + " · " +
                percent(mate.wins, mate.matches) : "");
        }
        renderCheck(data.check);
    }
    // A failed pair check keeps the already rendered mate list; only the verdict changes.
    function partyFail(status, verdict) {
        if (partyModel && partyModel.state === "ok") {
            renderParty(); text("SeasonalStatsPartyState", status);
            text("SeasonalStatsPartyCheckResult", verdict);
            return;
        }
        clearParty(status, verdict);
    }
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
        var url = bridgeBase + "?account=" + active + "&request=" + request + "&protocol=2&v=080";
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
    function validParty(result) {
        if (!integer(result.total) || result.total > 1000000) { return false; }
        if (!Array.isArray(result.mates) || result.mates.length > 3 || result.mates.length > result.total) { return false; }
        var seen = {};
        for (var i = 0; i < result.mates.length; i++) {
            var mate = result.mates[i];
            if (!mate || !account(mate.id) || seen[mate.id] || !integer(mate.wins) || !integer(mate.matches) ||
                    mate.matches < 1 || mate.wins > mate.matches || typeof mate.name !== "string" || mate.name.length > 40) { return false; }
            seen[mate.id] = true;
        }
        if (result.check === null) { return !partyTarget; }
        var check = result.check;
        if (!check || !account(check.id) || !/^(same|not|error)$/.test(check.state) || !integer(check.matches) ||
                !integer(check.wins) || typeof check.name !== "string" || check.name.length > 40) { return false; }
        if (check.state === "same" ? check.matches < 1 || check.wins > check.matches :
                check.matches !== 0 || check.wins !== 0) { return false; }
        return String(check.id) === partyTarget;
    }
    function partyAccept(message) {
        if (typeof message !== "string" || message.length > 8192 || message.indexOf("DLSWR2:") !== 0) { return; }
        var result;
        try { result = JSON.parse(message.slice(7)); } catch (ignore) { return; }
        if (!partyRequest || result.account !== active || result.request !== partyRequest || identity() !== active) { return; }
        if (result.kind === "loading") { text("SeasonalStatsPartyState", "Загрузка пати…"); return; }
        partyRequest = ""; stopPartyBridge();
        if (result.kind !== "party") {
            // A 0.7.0 bridge ignores `mode=party` and answers with its seasonal payload.
            partyFail("Мост не обновлён: нужен v0.8.0", partyTarget ? "Пати недоступно без обновления моста" : "");
            return;
        }
        if (!validParty(result)) { partyFail("Некорректные данные пати", partyTarget ? "Некорректный ответ моста" : ""); return; }
        partyModel = { state: "ok", total: result.total, mates: result.mates, check: result.check };
        if (!partyTarget) {
            if (!partyCache[active]) { partyOrder.push(active); }
            partyModel.expires = Math.min(Date.now() + 300000, model && model.current && model.current.end ?
                model.current.end * 1000 : Date.now() + 300000);
            partyCache[active] = partyModel;
            if (partyOrder.length > 24) { delete partyCache[partyOrder.shift()]; }
        }
        renderParty();
    }
    function stopPartyBridge() {
        try { if (valid(partyBridge)) { partyBridge.SetURL("about:blank"); partyBridge.visible = false; } } catch (ignore) {}
    }
    function resolvePartyBridge() {
        if (valid(partyBridge)) { return partyBridge; }
        partyBridge = find("SeasonalStatsPartyBridge");
        if (valid(partyBridge)) {
            $.RegisterEventHandler("HTMLTitle", partyBridge, function () { partyAccept(arguments.length > 1 ? arguments[1] : arguments[0]); });
            $.RegisterEventHandler("HTMLURLChanged", partyBridge, function () {
                var value = arguments.length > 1 ? arguments[1] : arguments[0];
                if (typeof value !== "string" || value.indexOf(bridgeBase + "?") !== 0 || value.indexOf("#") < 0) { return; }
                try { partyAccept(decodeURIComponent(value.slice(value.indexOf("#") + 1))); } catch (ignore) {}
            });
        }
        return partyBridge;
    }
    function partyLoad(checkTarget) {
        if (!active) { return; }
        partyTarget = checkTarget ? account(checkTarget) : "";
        if (partyTarget && partyTarget === active) { text("SeasonalStatsPartyCheckResult", "Это тот же игрок"); return; }
        if (!partyTarget && partyCache[active] && partyCache[active].expires > Date.now()) {
            partyModel = partyCache[active]; renderParty(); return;
        }
        var token = ++partyGeneration;
        partyRequest = "p" + token + "z" + Math.floor(Math.random() * 2147483647);
        if (partyTarget) { text("SeasonalStatsPartyState", "Проверка пати…"); text("SeasonalStatsPartyCheckResult", "Проверка…"); }
        else { clearParty("Загрузка пати…", ""); }
        partyBridge = resolvePartyBridge();
        if (!valid(partyBridge)) { partyRequest = ""; partyFail("HTML-панель пати недоступна", partyTarget ? "Пати недоступно" : ""); return; }
        var url = bridgeBase + "?account=" + active + "&request=" + partyRequest + "&protocol=2&v=080&mode=party" +
            (partyTarget ? "&check=" + partyTarget : "");
        partyBridge.visible = true;
        $.Schedule(0.15, function () {
            if (!valid(root) || partyGeneration !== token || !partyRequest) { return; }
            try { partyBridge.SetURL(url); } catch (ignore) {
                partyRequest = ""; stopPartyBridge();
                partyFail("Не удалось запустить загрузку пати", partyTarget ? "Пати недоступно" : "");
            }
        });
        $.Schedule(25, function () {
            if (!valid(root) || partyGeneration !== token || !partyRequest) { return; }
            partyRequest = ""; stopPartyBridge();
            partyFail("Пати: время ожидания истекло", partyTarget ? "Не удалось проверить пати" : "");
        });
    }
    root.SeasonalStatsOpen = function () { if (active && identity() === active) { $.DispatchEvent("ExternalBrowserGoToURL", "https://statlocker.gg/profile/" + active); } };
    root.SeasonalStatsRefresh = function () {
        if (active && identity() === active && Date.now() - lastRefresh >= 10000) { load(); partyLoad(""); }
    };
    root.SeasonalStatsHeroes = function (slot) { if (model && (slot === "current" || slot === "previous") && model[slot]) { heroSlot = slot; renderHeroes(); } };
    root.SeasonalStatsPartyCheck = function () {
        var input = find("SeasonalStatsPartyCheckInput");
        var value = valid(input) && typeof input.text === "string" ? input.text.trim() : "";
        if (!active || identity() !== active) { text("SeasonalStatsPartyCheckResult", "Игрок не выбран"); return; }
        if (!account(value)) { text("SeasonalStatsPartyCheckResult", "Введите Account ID: до 10 цифр"); return; }
        if (value === active) { text("SeasonalStatsPartyCheckResult", "Это тот же игрок"); return; }
        partyLoad(value);
    };
    function tick() {
        if (!valid(root)) { return; }
        var selected = identity(), link = find("SeasonalStatsOpen"), check = find("SeasonalStatsPartyCheckButton");
        if (selected !== lastCandidate) { lastCandidate = selected; candidateTicks = 0; }
        candidateTicks += 1;
        if (selected !== active) {
            active = ""; request = ""; generation += 1; stopBridge(); clearUI("Ожидание игрока…");
            partyGeneration += 1; partyRequest = ""; partyTarget = ""; stopPartyBridge(); clearParty("Ожидание игрока…", "");
            if (selected && candidateTicks >= 2) {
                active = selected; heroSlot = "current";
                if (cache[active] && cache[active].expires > Date.now()) { model = cache[active]; render(); } else { load(); }
                partyLoad("");
            }
        } else if (active && cache[active] && cache[active].expires <= Date.now() && !request) { load(); }
        if (active && partyCache[active] && partyCache[active].expires <= Date.now() && !partyRequest) {
            // Drop the stale entry first so a failed refresh cannot retry on every tick.
            delete partyCache[active]; partyLoad("");
        }
        if (valid(link)) { link.enabled = !!active && selected === active; }
        if (valid(check)) { check.enabled = !!active && selected === active; }
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
