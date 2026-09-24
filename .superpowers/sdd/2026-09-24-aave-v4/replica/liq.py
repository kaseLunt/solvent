import sys, json
from recon import *
from eth_abi import decode as adecode

MAXU = 2**256 - 1
HF_T = WAD
DUST = 1000 * 10**26


def to_shares_down(a, TA, TS): return a * (TS + VIRT) // (TA + VIRT)
def to_assets_up(s, TA, TS): return ceil_div(s * (TA + VIRT), TS + VIRT)
def to_assets_down2(s, TA, TS): return s * (TA + VIRT) // (TS + VIRT)
def percentMulUp(v, p): return ceil_div(v * p, PF)
def roundRayUp(a): return fromRayUp(a) * RAY


def liq_bonus(hfmax, lbf, hf, maxlb):
    if hf <= hfmax: return maxlb
    minlb = (maxlb - PF) * lbf // PF + PF
    return minlb + (maxlb - minlb) * (HF_T - hf) // (HF_T - hfmax)


def main(txhash):
    tx = rpc('eth_getTransactionByHash', [txhash])
    rc = rpc('eth_getTransactionReceipt', [txhash])
    B = int(tx['blockNumber'], 16)
    ts = int(getblock(B)['timestamp'], 16)
    args = adecode(['uint256', 'uint256', 'address', 'uint256', 'bool'], bytes.fromhex(tx['input'][10:]))
    cr, dr, user, debtToCover, recvShares = args
    print('tx', txhash, 'block', B, 'txIndex', int(tx['transactionIndex'], 16), 'args', args)
    pre = B - 1
    calls = [(SP, enc('getLiquidationConfig()')), (ORC, enc('getReservesPrices(uint256[])', ['uint256[]'], [list(range(23))]))]
    for r in range(23):
        calls += [(SP, enc('getReserve(uint256)', ['uint256'], [r])),
                  (SP, enc('getUserReserveStatus(uint256,address)', ['uint256', 'address'], [r, user])),
                  (SP, enc('getUserPosition(uint256,address)', ['uint256', 'address'], [r, user])),
                  (HUB, enc('getAsset(uint256)', ['uint256'], [r]))]
        for key in (0, 1):
            calls.append((SP, enc('getDynamicReserveConfig(uint256,uint32)', ['uint256', 'uint32'], [r, key])))
    out = mc(calls, pre)
    (lc,) = adecode(['(uint128,uint64,uint16)'], out[0][1]); (prices,) = adecode(['uint256[]'], out[1][1])
    k = 2; R = {}
    for r in range(23):
        (res,) = adecode(['(address,address,uint16,uint8,uint24,uint8,uint32)'], out[k][1]); k += 1
        coll, borr = adecode(['bool', 'bool'], out[k][1]); k += 1
        (pos,) = adecode(['(uint120,uint120,int200,uint120,uint32)'], out[k][1]); k += 1
        (A,) = adecode([ASSET_T], out[k][1]); k += 1
        dcs = []
        for key in (0, 1):
            (dc,) = adecode(['(uint16,uint32,uint16)'], out[k][1]); k += 1
            dcs.append(dc)
        R[r] = dict(res=res, coll=coll, borr=borr, pos=pos, A=A, dc=dcs[pos[4]] if pos[4] < 2 else None, price=prices[r])
    # account data at ts(B) from pre-state
    tot = 0; wcf = 0; debt_ray = 0; acc = 0; bc = 0
    for r, x in R.items():
        dsh, psh, poff, ssh, key = x['pos']; A = x['A']; dec = x['res'][3]
        if x['coll'] and x['dc'][0] > 0 and ssh > 0:
            v = to_value(to_assets_down(ssh, A, ts), dec, x['price']); tot += v; wcf += x['dc'][0] * v; acc += 1
        if x['borr']:
            idx = drawn_index(A, ts); debt_ray += to_value(dsh * idx + premium_ray(psh, poff, idx), dec, x['price']); bc += 1
    hf = (wcf * (WAD // PF)) * RAY // debt_ray
    print(' pre HF %.9f' % (hf / 1e18), 'activeColl', acc, 'borrowCount', bc, 'liqConfig', lc)
    C = R[cr]; D = R[dr]
    thf, hfmax, lbf = lc
    cf, maxlb, lfee = C['dc']
    lb = liq_bonus(hfmax, lbf, hf, maxlb)
    cdec = C['res'][3]; ddec = D['res'][3]; cunit = 10**cdec; dunit = 10**ddec
    cprice = C['price']; dprice = D['price']
    cA = C['A']; dA = D['A']
    cTA = total_added_assets(cA, ts); cTS = cA[3]
    didx = drawn_index(dA, ts)
    dsh, psh, poff = D['pos'][0], D['pos'][1], D['pos'][2]
    prem = premium_ray(psh, poff, didx)
    ssh = C['pos'][3]
    # _calculateDebtToTargetHealthFactor
    pen = percentMulUp(lb * (WAD // PF), cf)
    debtRayToTarget = ceil_div(debt_ray * dunit * (thf - hf), (thf - pen) * dprice * WAD)
    # _calculateDebtToLiquidate
    premL = min(roundRayUp(debtRayToTarget), prem)
    if debtToCover < fromRayUp(premL): premL = debtToCover * RAY
    drawnL = 0
    if premL == prem and premL < debtRayToTarget:
        toTarget = ceil_div(debtRayToTarget - premL, didx)
        toCover = (debtToCover - fromRayUp(premL)) * RAY // didx
        drawnL = min(toTarget, toCover, dsh)
    rem = (dsh - drawnL) * didx + prem - premL
    if drawnL < dsh and to_value(rem, ddec, dprice) < DUST * RAY:
        drawnL = dsh; premL = prem
    def coll_to_liq(dL, pL):
        dray = dL * didx + pL
        c = dray * (dprice * cunit * lb) // (dunit * cprice * PF * RAY)
        return to_shares_down(c, cTA, cTS)
    cL = coll_to_liq(drawnL, premL)
    dust = False
    if cL < ssh:
        remc = to_assets_down2(ssh - cL, cTA, cTS)
        dust = to_value(remc, cdec, cprice) < DUST
    if cL > ssh or (dust and drawnL < dsh):
        cL = ssh
        dray = ceil_div(to_assets_up(cL, cTA, cTS) * (cprice * dunit * PF * RAY), dprice * cunit * lb)
        if dray <= prem:
            premL = min(roundRayUp(dray), prem); drawnL = 0
        else:
            premL = prem; drawnL = ceil_div(dray - premL, didx)
            if drawnL > dsh:
                drawnL = dsh; cL = min(coll_to_liq(drawnL, premL), ssh)
    need = rayMulUp(drawnL, didx) + fromRayUp(premL)
    assert debtToCover >= need, 'would revert MustNotLeaveDust'
    toLiq = cL - ceil_div(cL * (lfee * (lb - PF)), lb * PF)
    print(' LB', lb, 'penaltyWad', pen, 'debtRayToTarget', debtRayToTarget)
    print(' replica: drawnSharesLiquidated', drawnL, 'collateralSharesLiquidated', cL, 'collateralSharesToLiquidator', toLiq, 'debtAmountRestored', need)
    # event
    topic0 = '0x2a1f12d996f530f89d8038aa293f9fde81cac44b6dfd6225e3358d09b78a4a37'
    for lg in rc['logs']:
        if lg['topics'][0] == topic0:
            ev = adecode(['address', 'bool', 'uint256', 'uint256', '(int256,int256,uint256)', 'uint256', 'uint256', 'uint256'], bytes.fromhex(lg['data'][2:]))
            print(' event:   drawnSharesLiquidated', ev[3], 'collateralSharesLiquidated', ev[6], 'collateralSharesToLiquidator', ev[7], 'debtAmountRestored', ev[2], 'collateralAmountRemoved', ev[5])
            print(' MATCH' if (ev[3], ev[6], ev[7], ev[2]) == (drawnL, cL, toLiq, need) else ' MISMATCH')


if __name__ == '__main__':
    for h in sys.argv[1:]:
        main(h)
    print('rpc calls', NCALLS[0])
