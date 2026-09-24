from kec import topic
PD='(int256,int256,uint256)'
SPOKE={
 'SetSpokeImmutables':'SetSpokeImmutables(address,uint16)',
 'UpdateLiquidationConfig':'UpdateLiquidationConfig((uint128,uint64,uint16))',
 'AddReserve':'AddReserve(uint256,uint256,address)',
 'UpdateReserveConfig':'UpdateReserveConfig(uint256,(uint24,bool,bool,bool,bool))',
 'UpdateReservePriceSource':'UpdateReservePriceSource(uint256,address)',
 'AddDynamicReserveConfig':'AddDynamicReserveConfig(uint256,uint32,(uint16,uint32,uint16))',
 'UpdateDynamicReserveConfig':'UpdateDynamicReserveConfig(uint256,uint32,(uint16,uint32,uint16))',
 'UpdatePositionManager':'UpdatePositionManager(address,bool)',
 'Supply':'Supply(uint256,address,address,uint256,uint256)',
 'Withdraw':'Withdraw(uint256,address,address,uint256,uint256)',
 'Borrow':'Borrow(uint256,address,address,uint256,uint256)',
 'Repay':'Repay(uint256,address,address,uint256,uint256,%s)'%PD,
 'LiquidationCall':'LiquidationCall(uint256,uint256,address,address,bool,uint256,uint256,%s,uint256,uint256,uint256)'%PD,
 'ReportDeficit(spoke)':'ReportDeficit(uint256,address,uint256,%s)'%PD,
 'SetUsingAsCollateral':'SetUsingAsCollateral(uint256,address,address,bool)',
 'UpdateUserRiskPremium':'UpdateUserRiskPremium(address,uint256)',
 'RefreshAllUserDynamicConfig':'RefreshAllUserDynamicConfig(address)',
 'RefreshSingleUserDynamicConfig':'RefreshSingleUserDynamicConfig(address,uint256)',
 'SetUserPositionManager':'SetUserPositionManager(address,address,bool)',
 'RefreshPremiumDebt':'RefreshPremiumDebt(uint256,address,%s)'%PD,
 'Upgraded':'Upgraded(address)',
}
HUB={
 'Add':'Add(uint256,address,uint256,uint256)',
 'Remove':'Remove(uint256,address,uint256,uint256)',
 'Draw':'Draw(uint256,address,uint256,uint256)',
 'Restore':'Restore(uint256,address,uint256,%s,uint256,uint256)'%PD,
 'RefreshPremium':'RefreshPremium(uint256,address,%s)'%PD,
 'ReportDeficit(hub)':'ReportDeficit(uint256,address,uint256,%s,uint256)'%PD,
 'TransferShares':'TransferShares(uint256,address,address,uint256)',
 'AddAsset':'AddAsset(uint256,address,uint8)',
 'UpdateAsset':'UpdateAsset(uint256,uint256,uint256,uint256)',
 'UpdateAssetConfig':'UpdateAssetConfig(uint256,(address,uint16,address,address))',
 'AddSpoke':'AddSpoke(uint256,address)',
 'UpdateSpokeConfig':'UpdateSpokeConfig(uint256,address,(uint40,uint40,uint24,bool,bool))',
 'MintFeeShares':'MintFeeShares(uint256,address,uint256,uint256)',
 'Sweep':'Sweep(uint256,address,uint256)',
 'Reclaim':'Reclaim(uint256,address,uint256)',
 'EliminateDeficit':'EliminateDeficit(uint256,address,address,uint256,uint256)',
}
ALL={**{k:(v,topic(v)) for k,v in SPOKE.items()}, **{k:(v,topic(v)) for k,v in HUB.items()}}
if __name__=='__main__':
    for k,(v,t) in ALL.items(): print(f'{k:32s} {t}  {v}')
