from pathlib import Path
import struct, json, sys, zlib

GAME = Path(r'C:\Steam\steamapps\common\Deadlock\game\citadel')

def index(path):
    data = path.read_bytes()
    magic, version, tree_len = struct.unpack_from('<III', data)
    assert magic == 0x55aa1234
    pos = 28 if version == 2 else 12
    end = pos + tree_len
    def string():
        nonlocal pos
        stop = data.index(b'\0', pos)
        value = data[pos:stop].decode()
        pos = stop + 1
        return value
    result = {}
    while (ext := string()):
        while (folder := string()):
            while (name := string()):
                crc, pre, archive, offset, size, term = struct.unpack_from('<IHHIIH', data, pos)
                assert term == 65535
                pos += 18
                preload = data[pos:pos+pre]
                pos += pre
                full = ('' if folder == ' ' else folder + '/') + name + '.' + ext
                result[full] = (crc, archive, offset, size, preload)
    assert pos == end
    return result, data, end

def extract(path, entry, data, end):
    crc, archive, offset, size, preload = entry
    if archive == 0x7fff:
        blob = preload + data[end+offset:end+offset+size]
    else:
        source = path.with_name(path.name.replace('_dir.vpk', f'_{archive:03}.vpk'))
        with source.open('rb') as f:
            f.seek(offset)
            blob = preload + f.read(size)
    assert zlib.crc32(blob) == crc
    return blob

if __name__ == '__main__':
    path = GAME / 'pak01_dir.vpk'
    entries, data, end = index(path)
    selected = [key for key in entries if ('artist' in key.lower() or 'violet' in key.lower()) and key.endswith(('.vmat_c', '.vtex_c', '.vmdl_c', '.vdata_c'))]
    print('\n'.join(selected))
    out = Path(__file__).parent / 'original'
    for key in selected:
        if key.endswith(('.vmat_c', '.vmdl_c')):
            dest = out / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(extract(path, entries[key], data, end))
