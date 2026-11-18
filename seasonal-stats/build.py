"""Build against preserved Deadlock 6819 layouts; never writes to the game directory."""
from pathlib import Path
import copy
import hashlib
import json
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'tools'))
from kv3_material import Node, Reader, blocks, plain, serialize
from vpk_assets import index, extract

# Where the static bridge is published. Override with:
#   python build.py --bridge https://example.com/some/path/
DEFAULT_BRIDGE = 'https://romareyme.github.io/deadlock-seasonal-stats/'
BRIDGE_PATTERN = re.compile(r'^https?://[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]+/$')


def bridge_base():
    base = DEFAULT_BRIDGE
    if '--bridge' in sys.argv:
        base = sys.argv[sys.argv.index('--bridge') + 1]
    if not BRIDGE_PATTERN.match(base) or '"' in base or '<' in base or '>' in base or "'" in base or '\\' in base:
        raise SystemExit(f'bridge base must be an http(s) URL ending with "/", got: {base!r}')
    return base


def node(value):
    if isinstance(value, dict):
        return Node({key: node(item) for key, item in value.items()})
    if isinstance(value, list):
        return Node([node(item) for item in value])
    return Node(value)


def children(result, items):
    if len(items) == 1:
        result['child'] = items[0]
    elif items:
        result['vecChildren'] = items
    return result


def reference(value):
    if value.startswith('s2r://'):
        return dict(eType='REFERENCE_COMPILED', name=value[6:])
    return dict(eType='REFERENCE_PASSTHROUGH', name=value.removeprefix('file://'))


def ast(element):
    items = [ast(child) for child in element]
    tag = element.tag
    if tag == 'include':
        return dict(eType='INCLUDE', child=reference(element.attrib['src']), sourceLineColumn=[1, 1])
    if tag == 'script':
        return dict(eType='SCRIPT_BODY', name=element.text or '', sourceLineColumn=[1, 1])
    if tag in ('root', 'styles', 'scripts', 'snippets', 'snippet'):
        result = dict(eType=tag.upper())
        if tag == 'snippet':
            result['name'] = element.attrib['name']
    else:
        result = dict(eType='PANEL', name=tag)
        attrs = []
        for key, value in element.attrib.items():
            val = reference(value) if value.startswith(('s2r://', 'file://')) else dict(eType='PANEL_ATTRIBUTE_VALUE')
            if value and not value.startswith(('s2r://', 'file://')):
                val['name'] = value
            attrs.append(dict(eType='PANEL_ATTRIBUTE', name=key, child=val))
        items = attrs + items
    children(result, items)
    result['sourceLineColumn'] = [] if tag == 'root' else [1, 1]
    return result


def resource(version, parts):
    offset = 16 + 12 * len(parts)
    table, payload = bytearray(), bytearray()
    for tag, data in parts:
        padding = (-offset) % 4
        payload += b'\0' * padding
        offset += padding
        position = 16 + len(table)
        table += struct.pack('<4sII', tag, offset - position - 4, len(data))
        payload += data
        offset += len(data)
    return struct.pack('<IHHII', offset, 12, version, 8, len(parts)) + table + payload


def pack(files, target):
    groups = {}
    for path in files:
        folder, filename = path.rsplit('/', 1)
        name, extension = filename.rsplit('.', 1)
        groups.setdefault(extension, {}).setdefault(folder, []).append((name, path))
    tree, payload = bytearray(), bytearray()
    for extension, folders in sorted(groups.items()):
        tree += extension.encode() + b'\0'
        for folder, names in sorted(folders.items()):
            tree += folder.encode() + b'\0'
            for name, path in sorted(names):
                blob = files[path]
                tree += name.encode() + b'\0' + struct.pack('<IHHIIH', zlib.crc32(blob), 0, 0x7fff, len(payload), len(blob), 65535)
                payload += blob
            tree += b'\0'
        tree += b'\0'
    tree += b'\0'
    output = struct.pack('<7I', 0x55aa1234, 2, len(tree), len(payload), 0, 48, 0) + tree + payload
    output += hashlib.md5(tree).digest() + hashlib.md5(b'').digest()
    output += hashlib.md5(output).digest()
    target.write_bytes(output)
    entries, data, end = index(target)
    assert set(entries) == set(files)
    for key, blob in files.items():
        assert extract(target, entries[key], data, end) == blob


def edit_info(path, source, compiler, fingerprint, guid):
    deps = []
    for filename, exists in [(path, True), (path.rsplit('.', 1)[0] + '.v' + path.rsplit('.', 1)[1], False)]:
        deps.append(dict(m_RelativeFilename=filename, m_SearchPath='citadel',
                         m_nFileCRC=zlib.crc32(source) if exists else 0,
                         m_bOptional=not exists, m_bFileExists=exists, m_bIsGameFile=False))
    return serialize(node(dict(m_InputDependencies=deps, m_AdditionalInputDependencies=[],
        m_ArgumentDependencies=[], m_SpecialDependencies=[dict(m_String='Panorama Layout Compiler Version' if compiler == 'CompilePanorama' else 'JavaScript Compiler Version',
        m_CompilerIdentifier=compiler, m_nFingerprint=fingerprint, m_nUserData=0)],
        m_SpecialInputDependencies=[], m_AdditionalRelatedFiles=[], m_ChildResourceList=[],
        m_WeakReferenceList=[], m_SearchableUserData=dict(IsChildResource=0),
        m_SubassetReferences=None, m_SubassetDefinitions=None)), guid)


def main():
    source_dir = ROOT / 'source/panorama'
    compiled = ROOT / 'compiled'
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    for folder in ('layout', 'scripts'):
        (source_dir / folder).mkdir(parents=True, exist_ok=True)
    card_name = 'profile_card'
    context_name = 'citadel_ui_context_menu_player'
    page_name = 'citadel_db_page_profile'
    card = ET.parse(ROOT / f'decompiled/panorama/layout/{card_name}.xml')
    ET.SubElement(card.getroot().find('CitadelProfileCard'), 'Label', {
        'id': 'SeasonalStatsAccount', 'text': '{i:r:account_id}', 'hittest': 'false',
        'style': 'visibility: collapse; width: 0px; height: 0px;'
    })
    context = ET.parse(ROOT / f'decompiled/panorama/layout/{context_name}.xml')
    scripts = ET.Element('scripts')
    ET.SubElement(scripts, 'include', {'src': 's2r://panorama/scripts/seasonal_stats.vjs'})
    card.getroot().insert(1, copy.deepcopy(scripts))
    panel = context.getroot().find('CitadelContextMenuPlayer')
    stats = ET.fromstring('''<Panel id="SeasonalStats" style="flow-children: down; width: 100%; padding: 12px 14px; background-color: #171b20; border-top: 1px solid #a4d8ae22;">
        <Label text="СЕЗОННЫЙ РАНКЕД" style="font-size: 14px; color: #a4d8ae;" />
        <Label text="Seasonal Stats 0.8.0" style="font-size: 11px; color: #8e969e;" />
        <Panel id="SeasonalStatsSeasons" style="flow-children: right; width: 100%; margin-top: 6px;" />
        <Label text="Ранг и матчи: последние записанные Deadlock API" style="font-size: 11px; color: #8e969e; margin-top: 5px; width: 100%; white-space: normal;" />
        <Panel id="SeasonalStatsHeroTabs" style="flow-children: right; width: 100%; margin-top: 7px;" />
        <Label id="SeasonalStatsHeroesTitle" text="Герои · текущий сезон" style="font-size: 14px; color: #d1d0c7; margin-top: 5px; width: 100%;" />
        <Label id="SeasonalStatsHeroesState" text="Минимум 10 матчей на герое за выбранный сезон" style="font-size: 11px; color: #8e969e; margin-top: 3px; width: 100%; white-space: normal;" />
        <Panel id="SeasonalStatsHeroes" style="flow-children: right; width: 100%; margin-top: 4px;" />
        <Button id="SeasonalStatsOpen" enabled="false" onactivate="$.GetContextPanel().SeasonalStatsOpen();" style="width: 100%; background-color: #354a3d; padding: 8px 10px; margin-top: 10px;">
            <Label text="Открыть профиль Statlocker ↗" style="font-size: 17px; color: #f1e8d9; horizontal-align: center;" />
        </Button>
        <TextButton id="SeasonalStatsRefresh" text="Обновить" onactivate="$.GetContextPanel().SeasonalStatsRefresh();" style="horizontal-align: center; margin-top: 5px;" />
        <CitadelHTMLPanel id="SeasonalStatsBridge" visible="false" hittest="false" acceptsfocus="false" style="width: 260px; height: 24px; opacity: 1; margin-top: 4px;" />
    </Panel>''')
    season_fields = stats.find('Panel[@id="SeasonalStatsSeasons"]')
    hero_tabs = stats.find('Panel[@id="SeasonalStatsHeroTabs"]')
    for role, caption in [('Current', 'ТЕКУЩИЙ СЕЗОН'), ('Previous', 'ПРЕДЫДУЩИЙ СЕЗОН')]:
        identity = f'SeasonalStats{role}'
        column = ET.SubElement(season_fields, 'Panel', {'style': 'flow-children: down; width: 50%; padding-right: 8px;'})
        ET.SubElement(column, 'Label', {'text': caption, 'style': 'font-size: 11px; color: #a4d8ae;'})
        ET.SubElement(column, 'Label', {'id': identity+'Season', 'text': '…', 'style': 'font-size: 15px; color: #f2e8d4; width: 100%; text-overflow: ellipsis; white-space: nowrap;'})
        row = ET.SubElement(column, 'Panel', {'style': 'flow-children: right; width: 100%; margin-top: 3px;'})
        summary = ET.SubElement(row, 'Panel', {'style': 'flow-children: down; width: 60%; vertical-align: center;'})
        ET.SubElement(summary, 'Label', {'id': identity+'Value', 'text': '—', 'style': 'font-size: 28px; font-weight: bold; color: #f2e8d4;'})
        ET.SubElement(summary, 'Label', {'id': identity+'Detail', 'text': 'Загрузка…', 'style': 'font-size: 12px; color: #d1d0c7; width: 100%; white-space: normal;'})
        ET.SubElement(row, 'Image', {'id': identity+'RankImage', 'visible': 'false', 'hittest': 'false', 'scaling': 'stretch-to-fit-preserve-aspect', 'style': 'width: 40%; height: 68px; vertical-align: center;'})
        ET.SubElement(column, 'Label', {'id': identity+'RankName', 'text': '—', 'style': 'font-size: 12px; color: #b7c0c5; width: 100%; white-space: normal; margin-top: 2px;'})
        ET.SubElement(hero_tabs, 'TextButton', {'id': 'SeasonalStatsHeroes'+role, 'text': 'Герои: '+('текущий' if role == 'Current' else 'прошлый'), 'onactivate': f"$.GetContextPanel().SeasonalStatsHeroes('{role.lower()}');", 'style': 'width: 50%; font-size: 13px;'})
    hero_fields = stats.find('Panel[@id="SeasonalStatsHeroes"]')
    for prefix, heading, color in [('Best', 'ВЫСОКИЙ ВИНРЕЙТ · ТОП-3', '#a4d8ae'), ('Worst', 'НИЗКИЙ ВИНРЕЙТ · ТОП-3', '#dfa49d')]:
        column = ET.SubElement(hero_fields, 'Panel', {'style': 'flow-children: down; width: 50%; padding-right: 6px;'})
        ET.SubElement(column, 'Label', {'text': heading, 'style': f'font-size: 12px; color: {color}; margin-bottom: 3px;'})
        for i in range(3):
            row = ET.SubElement(column, 'Panel', {'style': 'flow-children: down; width: 100%; height: 34px;'})
            ET.SubElement(row, 'Label', {'id': f'SeasonalStats{prefix}Name{i}', 'text': '—', 'style': 'font-size: 15px; color: #f2e8d4; width: 100%; text-overflow: ellipsis; white-space: nowrap;'})
            ET.SubElement(row, 'Label', {'id': f'SeasonalStats{prefix}Value{i}', 'text': '', 'style': 'font-size: 13px; color: #b7c0c5; width: 100%;'})
    party = ET.SubElement(stats, 'Panel', {'id': 'SeasonalStatsParty',
        'style': 'flow-children: down; width: 100%; margin-top: 9px; padding-top: 7px; border-top: 1px solid #a4d8ae22;'})
    ET.SubElement(party, 'Label', {'text': 'ПАТИ', 'style': 'font-size: 14px; color: #a4d8ae;'})
    ET.SubElement(party, 'Label', {'id': 'SeasonalStatsPartyState', 'text': 'Ожидание игрока…',
        'style': 'font-size: 11px; color: #8e969e; margin-top: 2px; width: 100%; white-space: normal;'})
    for i in range(3):
        ET.SubElement(party, 'Label', {'id': f'SeasonalStatsPartyMate{i}', 'text': '',
            'style': 'font-size: 13px; color: #f2e8d4; width: 100%; margin-top: 1px; text-overflow: ellipsis; white-space: nowrap;'})
    check_row = ET.SubElement(party, 'Panel', {'style': 'flow-children: right; width: 100%; margin-top: 6px;'})
    ET.SubElement(check_row, 'TextEntry', {'id': 'SeasonalStatsPartyCheckInput', 'placeholder': 'Account ID',
        'maxchars': '10', 'style': 'width: 56%; height: 26px; font-size: 13px;'})
    ET.SubElement(check_row, 'TextButton', {'id': 'SeasonalStatsPartyCheckButton', 'text': 'Проверить',
        'onactivate': '$.GetContextPanel().SeasonalStatsPartyCheck();', 'enabled': 'false',
        'style': 'width: 42%; margin-left: 6px; font-size: 13px;'})
    ET.SubElement(party, 'Label', {'id': 'SeasonalStatsPartyCheckResult', 'text': '',
        'style': 'font-size: 12px; color: #d1d0c7; margin-top: 3px; width: 100%; white-space: normal;'})
    ET.SubElement(party, 'Label', {'text': 'Пати определяется API по списку Steam-друзей на момент матча',
        'style': 'font-size: 10px; color: #6f777d; margin-top: 3px; width: 100%; white-space: normal;'})
    ET.SubElement(party, 'CitadelHTMLPanel', {'id': 'SeasonalStatsPartyBridge', 'visible': 'false', 'hittest': 'false',
        'acceptsfocus': 'false', 'style': 'width: 260px; height: 24px; opacity: 1; margin-top: 2px;'})
    # Party data belongs above the Statlocker button, not after the footer controls.
    open_button = stats.find('Button[@id="SeasonalStatsOpen"]')
    stats.remove(party)
    stats.insert(list(stats).index(open_button), party)
    card_stats = copy.deepcopy(stats)
    card_stats.set('visible', 'false')
    card.getroot().find('CitadelProfileCard/Panel[@id="MiniProfileContainer"]').append(card_stats)
    page = ET.parse(ROOT / f'decompiled/panorama/layout/{page_name}.xml')
    page.getroot().insert(1, copy.deepcopy(scripts))
    page_root = page.getroot().find('CitadelProfilePage')
    ET.SubElement(page_root, 'Label', {
        'id': 'SeasonalStatsAccount', 'text': '{i:r:account_id}', 'hittest': 'false',
        'style': 'visibility: collapse; width: 0px; height: 0px;'
    })
    left = page_root.find('.//Panel[@class="LeftPanel"]')
    assert left is not None
    page_stats = copy.deepcopy(stats)
    page_stats.set('style', page_stats.attrib['style'] +
                   ' margin-top: 440px; z-index: 10; border-radius: 4px;')
    left.append(page_stats)
    for name, tree in [(card_name, card), (page_name, page)]:
        ET.indent(tree, space='\t')
        tree.write(source_dir / f'layout/{name}.xml', encoding='utf-8', xml_declaration=False)
    bridge = (ROOT / 'source/bridge.js').read_text(encoding='utf-8').split('if (typeof module')[0].strip()
    rank_catalog = json.loads((ROOT / 'reference/ranks.json').read_text(encoding='utf-8-sig'))
    rank_names = [''] * 12
    for rank in rank_catalog:
        if 0 <= rank['tier'] <= 11:
            rank_names[rank['tier']] = rank['name']
    assert all(rank_names)
    runtime = (ROOT / 'source/seasonal_stats_v080.js').read_text(encoding='utf-8')
    assert runtime.count('__BRIDGE_BASE__') == 1, 'bridge base placeholder must appear exactly once'
    runtime = (runtime.replace('__RANK_NAMES__', json.dumps(rank_names, ensure_ascii=False))
        .replace('__BRIDGE_BASE__', bridge_base()))
    if '--probe' in sys.argv:
        runtime = runtime.rsplit('}());', 1)[0] + (ROOT / 'source/probe.js').read_text(encoding='utf-8') + '\n}());'
    (source_dir / 'scripts/seasonal_stats.js').write_text(runtime, encoding='utf-8')
    sample = dict(blocks((ROOT / 'stock/panorama/layout/profile_card.vxml_c').read_bytes()))
    guid = Reader(sample[b'LaCo']).guid
    files = {}
    for path in sorted(source_dir.rglob('*')):
        if not path.is_file():
            continue
        if path.name == 'citadel_ui_context_menu_player.xml':
            continue
        relative = path.relative_to(ROOT / 'source').as_posix()
        data = path.read_bytes()
        if path.suffix == '.xml':
            parsed = dict(m_AST=dict(m_pRoot=ast(ET.fromstring(data))))
            laco = serialize(node(parsed), guid)
            assert plain(Reader(laco).root) == parsed
            blob = resource(3, [(b'RED2', edit_info(relative, data, 'CompilePanorama', 14, guid)),
                (b'DATA', struct.pack('<IH', zlib.crc32(data), 0)), (b'LaCo', laco)])
        else:
            assert path.suffix == '.js'
            blob = resource(4, [(b'RED2', edit_info(relative, data, 'CompileJavaScript', 4, guid)), (b'DATA', data)])
        output = str(Path(relative).with_suffix('.v' + path.suffix[1:] + '_c')).replace('\\', '/')
        files[output] = blob
        dest = compiled / output
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
    target = dist / 'pak80_dir.vpk'
    pack(files, target)
    sha = hashlib.sha256(target.read_bytes()).hexdigest()
    (dist / 'SHA256.txt').write_text(sha + '  pak80_dir.vpk\n')
    report = dict(version='0.8.0', game_build=6860, bridge=bridge_base(), vpk=target.name, sha256=sha,
                  files={key: hashlib.sha256(value).hexdigest() for key, value in files.items()},
                  archive_roundtrip=True, resource_roundtrip=True, in_game_tested=False)
    (dist / 'verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
