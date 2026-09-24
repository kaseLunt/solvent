import json, requests, sys, re
from urllib.parse import urlparse
from kec import sel, topic, keccak256
from eth_abi import encode, decode
ENV='C:/Users/kasel/source/repos/etherfi/Solvent/.env'
def _url(var):
    for line in open(ENV, encoding='utf-8'):
        line=line.strip()
        if line.startswith(var+'='):
            return line.split('=',1)[1].strip().strip('"').strip("'")
    raise SystemExit('missing '+var)
URLS={'op':_url('SOLVENT_RPC_OP')}
try: URLS['eth']=_url('SOLVENT_RPC_ETH')
except SystemExit: pass
def provider(chain='op'):
    h=urlparse(URLS[chain]).hostname or ''
    parts=h.split('.')
    return parts[-2] if len(parts)>=2 else '?'
NCALLS=[0]
def rpc(method, params, chain='op'):
    NCALLS[0]+=1
    r=requests.post(URLS[chain], json={'jsonrpc':'2.0','id':1,'method':method,'params':params}, timeout=60)
    j=r.json()
    if 'error' in j: raise RuntimeError(json.dumps(j['error'])[:500])
    return j['result']
def call(to, sig, types=(), args=(), outtypes=None, block='latest', chain='op'):
    data='0x'+sel(sig)+(encode(list(types), list(args)).hex() if types else '')
    res=rpc('eth_call',[{'to':to,'data':data}, block if isinstance(block,str) else hex(block)], chain)
    b=bytes.fromhex(res[2:])
    if outtypes is None: return b
    return decode(outtypes, b)
def blocknum(chain='op'): return int(rpc('eth_blockNumber',[],chain),16)
def getblock(n, chain='op'): return rpc('eth_getBlockByNumber',[hex(n) if isinstance(n,int) else n, False],chain)
def logs(address, topics, frm, to, chain='op'):
    return rpc('eth_getLogs',[{'address':address,'topics':topics,'fromBlock':hex(frm),'toBlock':hex(to)}],chain)
