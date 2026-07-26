//go:build ignore

// Forensic probe: does this repo's go-ethereum (v1.13.0) compute the canonical
// hash for a 2026 OP-mainnet header? Compares ethclient's recomputed h.Hash()
// against the provider-reported hash field for the stall block 150,105,227.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

func main() {
	const url = "https://mainnet.optimism.io"
	const target = 150_105_227

	rc, err := rpc.Dial(url)
	if err != nil {
		panic(err)
	}
	var raw json.RawMessage
	if err := rc.CallContext(context.Background(), &raw, "eth_getBlockByNumber", fmt.Sprintf("0x%x", target), false); err != nil {
		panic(err)
	}
	var reported struct {
		Hash string `json:"hash"`
	}
	if err := json.Unmarshal(raw, &reported); err != nil {
		panic(err)
	}

	ec := ethclient.NewClient(rc)
	h, err := ec.HeaderByNumber(context.Background(), new(big.Int).SetUint64(target))
	if err != nil {
		fmt.Printf("HeaderByNumber ERROR: %v\n", err)
		fmt.Printf("provider-reported hash: %s\n", reported.Hash)
		return
	}
	computed := h.Hash().Hex()
	fmt.Printf("provider-reported hash: %s\n", reported.Hash)
	fmt.Printf("geth-computed    hash: %s\n", computed)
	fmt.Printf("MATCH: %v\n", computed == reported.Hash)
}
