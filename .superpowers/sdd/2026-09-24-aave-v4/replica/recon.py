import sys, json
from rpc import *
from kec import sel
from eth_abi import encode, decode
SP = '0xdffcC3536D932eb51Df51a7F5FA407c4270d5308'
HUB = '0x66753c4e3fC84f1eD0e3C267C927284E9d90C572'
ORC = '0xe8cbd37210bF1E29436dAe183d7b9fe45E886fA8'
MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
RAY = 10**27; WAD = 10**18; YEAR = 365 * 86400; PF = 10**4
ASSET_T = '(uint120,uint120,uint8,uint120,uint120,int200,uint120,uint120,uint16,uint120,uint96,uint40,address,address,address,address,uint200)'
UAD_T = '(uint256,uint256,uint256,uint256,uint256,uint256,uint256)'


def enc(sig, types=(), args=()):
    return bytes.fromhex(sel(sig) + (encode(list(types), list(args)).hex() if types else ''))


def mc(calls, block):
    data = '0x' + sel('aggregate3((address,bool,bytes)[])') + encode(['(address,bool,bytes)[]'], [[(t, True, d) for t, d in calls]]).hex()
    res = rpc('eth_call', [{'to': MC3, 'data': data}, hex(block)])
    (out,) = decode(['(bool,bytes)[]'], bytes.fromhex(res[2:]))
    return out


def ceil_div(a, b): return -(-a // b)
def rayMulUp(a, b): return ceil_div(a * b, RAY)
def fromRayUp(a): return ceil_div(a, RAY)
def percentMulDown(v, p): return v * p // PF


def drawn_index(A, ts):
    idx, rate, last = A[9], A[10], A[11]
    if last == ts or (A[6] == 0 and A[7] == 0):
        return idx
    lin = rate * (ts - last) // YEAR + RAY
    return rayMulUp(idx, lin)


def premium_ray(psh, poff, idx):
    v = psh * idx - poff
    assert v >= 0
    return v


def agg_owed_ray(A, idx):
    return A[6] * idx + premium_ray(A[7], A[5], idx) + A[16]


def unrealized_fees(A, idx):
    prev = A[9]
    if prev == idx or A[8] == 0:
        return 0
    return percentMulDown(fromRayUp(agg_owed_ray(A, idx)) - fromRayUp(agg_owed_ray(A, prev)), A[8])


def total_added_assets(A, ts):
    idx = drawn_index(A, ts)
    return A[0] + A[4] + fromRayUp(agg_owed_ray(A, idx)) - A[1] - unrealized_fees(A, idx)


VIRT = 10**6


def to_assets_down(sh, A, ts): return sh * (total_added_assets(A, ts) + VIRT) // (A[3] + VIRT)
def to_value(amount, dec, price): return amount * price * 10**(18 - dec)


def run(user, block, nres=23, verbose=True):
    b = getblock(block); ts = int(b['timestamp'], 16)
    calls = [(SP, enc('getUserAccountData(address)', ['address'], [user])),
             (ORC, enc('getReservesPrices(uint256[])', ['uint256[]'], [list(range(nres))])),
             (SP, enc('getUserLastRiskPremium(address)', ['address'], [user]))]
    for r in range(nres):
        calls.append((SP, enc('getReserve(uint256)', ['uint256'], [r])))
        calls.append((SP, enc('getUserReserveStatus(uint256,address)', ['uint256', 'address'], [r, user])))
        calls.append((SP, enc('getUserPosition(uint256,address)', ['uint256', 'address'], [r, user])))
        calls.append((SP, enc('getUserDebt(uint256,address)', ['uint256', 'address'], [r, user])))
        calls.append((SP, enc('getUserSuppliedAssets(uint256,address)', ['uint256', 'address'], [r, user])))
        calls.append((HUB, enc('getAsset(uint256)', ['uint256'], [r])))
        calls.append((HUB, enc('getAssetDrawnIndex(uint256)', ['uint256'], [r])))
        for key in (0, 1):
            calls.append((SP, enc('getDynamicReserveConfig(uint256,uint32)', ['uint256', 'uint32'], [r, key])))
    out = mc(calls, block)
    (uad,) = decode([UAD_T], out[0][1]); (prices,) = decode(['uint256[]'], out[1][1]); (lastRP,) = decode(['uint256'], out[2][1])
    k = 3
    tot_coll = 0; wcf = 0; debt_ray = 0; coll_list = []; borrow_count = 0; active_coll = 0; ok = True; nchecks = 0
    for r in range(nres):
        (res,) = decode(['(address,address,uint16,uint8,uint24,uint8,uint32)'], out[k][1]); k += 1
        coll, borr = decode(['bool', 'bool'], out[k][1]); k += 1
        (pos,) = decode(['(uint120,uint120,int200,uint120,uint32)'], out[k][1]); k += 1
        dd, pd = decode(['uint256', 'uint256'], out[k][1]); k += 1
        (sa,) = decode(['uint256'], out[k][1]); k += 1
        (A,) = decode([ASSET_T], out[k][1]); k += 1
        (hidx,) = decode(['uint256'], out[k][1]); k += 1
        dcs = []
        for key in (0, 1):
            (dc,) = decode(['(uint16,uint32,uint16)'], out[k][1]); k += 1
            dcs.append(dc)
        dsh, psh, poff, ssh, key = pos
        aid = res[2]; dec = res[3]; cr = res[4]; price = prices[r]
        idx = drawn_index(A, ts)
        ok &= (idx == hidx); nchecks += 1
        if ssh:
            ok &= (to_assets_down(ssh, A, ts) == sa); nchecks += 1
        if dsh:
            ok &= (rayMulUp(dsh, idx) == dd) and (fromRayUp(premium_ray(psh, poff, idx)) == pd); nchecks += 1
        if coll:
            cf = dcs[key][0] if key < 2 else None
            if cf and ssh > 0:
                assets = to_assets_down(ssh, A, ts)
                val = to_value(assets, dec, price)
                tot_coll += val; wcf += cf * val; coll_list.append((cr, val)); active_coll += 1
                if verbose: print(f'  coll r{r} key{key} CF{cf} shares {ssh} assets {assets} price {price} value {val}')
            elif verbose:
                print(f'  coll r{r} key{key} CF{cf} shares {ssh} (not counted)')
        if borr:
            dr = dsh * idx + premium_ray(psh, poff, idx)
            debt_ray += to_value(dr, dec, price); borrow_count += 1
            if verbose: print(f'  debt r{r} drawnShares {dsh} premShares {psh} poff {poff} idx {idx} drawnDebt {rayMulUp(dsh, idx)} price {price}')
    hf = (wcf * (WAD // PF)) * RAY // debt_ray if debt_ray > 0 else 2**256 - 1
    avgcf = (wcf * (WAD // PF)) // tot_coll if tot_coll > 0 else 0
    coll_list.sort(key=lambda x: (x[0], -x[1]))
    totd = fromRayUp(debt_ray); left = totd; rp = 0
    for cr, val in coll_list:
        if left == 0: break
        v = min(val, left); rp += v * cr; left -= v
    if left < totd: rp = ceil_div(rp, totd - left)
    mine = (rp, avgcf, hf, tot_coll, debt_ray, active_coll, borrow_count)
    print('block', block, 'ts', ts, 'user', user)
    print(' onchain', tuple(uad))
    print(' replica', mine)
    print(' ACCOUNT DATA', 'MATCH' if tuple(uad) == mine else 'MISMATCH', '| lastRP', lastRP,
          '| HF=%.6f' % (uad[2] / 1e18) if uad[2] < 2**255 else '| HF=inf', '| per-reserve checks ok:', ok, nchecks)
    return uad


if __name__ == '__main__':
    blk = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] != 'latest' else blocknum()
    for u in sys.argv[2:]:
        run(u, blk)
    print('rpc calls', NCALLS[0])
