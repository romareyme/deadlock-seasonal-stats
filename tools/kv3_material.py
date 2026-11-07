import struct
from pathlib import Path

def lz4(data,history=b''):
    out=bytearray(history); start=len(out); p=0
    while p<len(data):
        token=data[p]; p+=1
        n=token>>4
        if n==15:
            while True:
                x=data[p];p+=1;n+=x
                if x!=255:break
        out+=data[p:p+n];p+=n
        if p==len(data):break
        distance=struct.unpack_from('<H',data,p)[0];p+=2
        n=(token&15)+4
        if (token&15)==15:
            while True:
                x=data[p];p+=1;n+=x
                if x!=255:break
        assert 0<distance<=len(out)
        for _ in range(n):out.append(out[-distance])
    return out[start:]

def blocks(data):
    start=8+struct.unpack_from('<I',data,8)[0]
    result=[]
    for i in range(struct.unpack_from('<I',data,12)[0]):
        pos=start+i*12
        name,off,size=struct.unpack_from('<4sII',data,pos)
        result.append((name,data[pos+4+off:pos+4+off+size]))
    return result

class Node:
    def __init__(self,value,flag=0,wire_type=None):self.value=value;self.flag=flag;self.wire_type=wire_type

class Reader:
    def __init__(self,b):
        assert struct.unpack_from('<I',b)[0]==0x4b563305
        self.guid=b[4:20]
        h=struct.unpack_from('<25I',b,20)
        method=h[0];assert method in (0,1)
        c1,c4,c8,ct=h[2:6];c2=h[11]
        u1,z1,u2,z2=h[13:17];b1,b2,b4,b8=h[17:21];objects=h[22]
        count_blobs=h[9]
        raw1=lz4(b[120:120+z1]) if method else bytearray(b[120:120+u1])
        off=120+(z1 if method else u1)
        raw2=lz4(b[off:off+z2]) if method else bytearray(b[off:off+u2])
        assert len(raw1)==u1 and len(raw2)==u2
        def lanes(raw,off,counts):
            result={}
            for width,count in zip((1,2,4,8),counts):
                if count:
                    off=(off+width-1)//width*width
                    result[width]=[raw,off,off+count*width]
                    off+=count*width
                else:result[width]=[raw,0,0]
            return result,off
        self.aux,_=lanes(raw1,0,(c1,c2,c4,c8))
        ns=self.read(self.aux,4,'i');strings=raw1[:c1].split(b'\0');self.strings=[x.decode() for x in strings[:ns]]
        self.main,end=lanes(raw2,objects*4,(b1,b2,b4,b8))
        self.objects=iter(struct.unpack_from('<'+'I'*objects,raw2))
        self.types=iter(raw2[end:end+ct])
        trailer=end+ct
        self.blobs=iter([])
        if count_blobs:
            lengths=struct.unpack_from('<'+'I'*count_blobs,raw2,trailer);trailer+=count_blobs*4
            blobpos=off+(z2 if method else u2)
            if method:
                sizes=struct.unpack_from('<'+'H'*(h[12]//2),raw2,trailer+4)
                decoded=bytearray()
                for compressed_size in sizes:
                    decoded+=lz4(b[blobpos:blobpos+compressed_size],decoded[-65536:]);blobpos+=compressed_size
            else:decoded=b[blobpos:blobpos+h[10]];blobpos+=h[10]
            assert len(decoded)==sum(lengths)==h[10]
            assert b[blobpos:blobpos+4]==b'\x00\xdd\xee\xff'
            blobs=[];bp=0
            for length in lengths:blobs.append(bytes(decoded[bp:bp+length]));bp+=length
            self.blobs=iter(blobs)
        assert raw2[trailer:trailer+4]==b'\x00\xdd\xee\xff'
        self.root=self.value(*self.type(),self.main)
        remaining=list(self.types)
        assert not remaining, (plain(self.root),remaining)
        assert next(self.objects,None) is None
        for buf in (self.main,):
            assert all(pos==end for _,pos,end in buf.values())
    def read(self,buf,w,fmt):
        data,pos,end=buf[w];assert pos+w<=end
        buf[w][1]+=w
        return struct.unpack_from('<'+fmt,data,pos)[0]
    def type(self):
        t=next(self.types);flag=next(self.types) if t&128 else 0
        if t&64:next(self.types)
        return t&63,flag
    def string(self):
        idx=self.read(self.main,4,'i')
        return self.strings[idx] if 0<=idx<len(self.strings) else ''
    def value(self,t,flag,buf):
        constants={1:None,13:True,14:False,15:0,16:1,17:0.0,18:1.0,26:0,27:1}
        scalar={2:(1,'B'),3:(8,'q'),4:(8,'Q'),5:(8,'d'),11:(4,'i'),12:(4,'I'),19:(4,'f'),20:(2,'h'),21:(2,'H'),22:(1,'b'),23:(1,'B')}
        if t in constants:v=constants[t]
        elif t in scalar:v=self.read(buf,*scalar[t]);v=bool(v) if t==2 else v
        elif t==6:v=self.string()
        elif t==7:v=next(self.blobs)
        elif t==9:
            v={}
            for _ in range(next(self.objects)):
                typ,fl=self.type();name=self.string();v[name]=self.value(typ,fl,self.main)
        elif t==8:v=[self.value(*self.type(),self.main) for _ in range(self.read(self.main,4,'i'))]
        elif t in (10,24,25):
            n=self.read(self.main,4,'i') if t==10 else self.read(self.main,1,'B')
            typ,fl=self.type();v=[self.value(typ,fl,self.aux if t==25 else self.main) for _ in range(n)]
        else:raise ValueError(('type',t))
        return Node(v,flag,t)

def plain(node):
    v=node.value
    if isinstance(v,dict):return {k:plain(x) for k,x in v.items()}
    if isinstance(v,list):return [plain(x) for x in v]
    return v

def serialize(root,guid):
    strings=[]; ids={}; one=bytearray();two=bytearray();four=bytearray();eight=bytearray();types=bytearray();objects=[];arrays=0;nodes=0;elements=0;blobs=[]
    def sid(s):
        if s not in ids:ids[s]=len(strings);strings.append(s)
        return ids[s]
    def put4(n):four.extend(struct.pack('<i',n))
    def write(n):
        nonlocal arrays,nodes,elements
        nodes+=1;v=n.value
        if v is None:t=1
        elif isinstance(v,bool):t=13 if v else 14
        elif isinstance(v,int):t=3
        elif isinstance(v,float):t=5
        elif isinstance(v,str):t=6
        elif isinstance(v,bytes):t=7
        elif isinstance(v,list):t=8
        elif isinstance(v,dict):t=9
        else:raise TypeError(type(v))
        primitive={2:(one,'B'),3:(eight,'q'),4:(eight,'Q'),5:(eight,'d'),11:(four,'i'),12:(four,'I'),19:(four,'f'),20:(two,'h'),21:(two,'H'),22:(one,'b'),23:(one,'B')}
        if n.wire_type in primitive:t=n.wire_type
        types.append(t | (128 if n.flag else 0))
        if n.flag:types.append(n.flag)
        if t in primitive:
            lane,fmt=primitive[t];lane.extend(struct.pack('<'+fmt,v))
        elif t==6:put4(sid(v))
        elif t==7:blobs.append(v)
        elif t==8:
            arrays+=1;elements+=len(v);put4(len(v))
            for x in v:write(x)
        elif t==9:
            objects.append(len(v))
            for k,x in v.items():put4(sid(k));write(x)
    write(root)
    stringbytes=b''.join(s.encode()+b'\0' for s in strings)
    buf1=bytearray(stringbytes)
    while len(buf1)%4:buf1.append(0)
    buf1+=struct.pack('<I',len(strings))
    buf2=bytearray(struct.pack('<'+'I'*len(objects),*objects))+one
    if two:
        while len(buf2)%2:buf2.append(0)
        buf2+=two
    if four:
        while len(buf2)%4:buf2.append(0)
        buf2+=four
    if eight:
        while len(buf2)%8:buf2.append(0)
        buf2+=eight
    buf2+=types
    if blobs:buf2+=struct.pack('<'+'I'*len(blobs),*[len(v) for v in blobs])
    buf2+=b'\x00\xdd\xee\xff'
    blobdata=b''.join(blobs)
    h=[0,0,len(stringbytes),1,0,len(types),len(objects)|(arrays<<16),len(buf1)+len(buf2),0,len(blobs),len(blobdata),0,0,len(buf1),0,len(buf2),0,len(one),len(two)//2,len(four)//4,len(eight)//8,nodes,len(objects),arrays,elements]
    encoded=struct.pack('<I',0x4b563305)+guid+struct.pack('<25I',*h)+buf1+buf2
    if blobs:encoded+=blobdata+b'\x00\xdd\xee\xff'
    assert plain(Reader(encoded).root)==plain(root)
    return encoded

def replace_data(original,newdata):
    items=blocks(original)
    header=bytearray(original[:16]);header.extend(b'\0'*(12*len(items)))
    for i,(name,blob) in enumerate(items):
        if name==b'DATA':blob=newdata
        while len(header)%16:header.append(0)
        pos=16+i*12
        struct.pack_into('<4sII',header,pos,name,len(header)-(pos+4),len(blob))
        header+=blob
    struct.pack_into('<I',header,0,len(header))
    return bytes(header)

if __name__=='__main__':
    import json
    for name in ['artist_upperbody','artist_lowerbody','artist_apron']:
        b=Path('work/original/models/heroes_wip/artist/materials',name+'.vmat_c').read_bytes()
        r=Reader(dict(blocks(b))[b'DATA'])
        Path('work',name+'.json').write_text(json.dumps(plain(r.root),indent=2))
        obj=plain(r.root)
        print(name,obj['m_shaderName'])
        for k in ['m_intParams','m_floatParams','m_vectorParams','m_dynamicParams']:print(k,obj.get(k))
