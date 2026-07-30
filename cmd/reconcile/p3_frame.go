// Task 6 - the FROZEN realized-liquidation backtest frame.
//
// These 31 cases are the frame committed to recon/p3-probes.md ("Task 6 frozen
// backtest frame", 2026-07-29) BEFORE this wave was written. They are the
// gate's committed input: risk-quant R2's floor is "the frame itself, frozen"
// - re-drawing "5 uniform-random per bucket" each run makes a failure
// unreproducible, so the draw is not re-run here at all. The seed string
// (`solvent-p3-task6-backtest-v1`), the population predicate, the bucket rule
// and the three force-include rules are recorded in the probe file with the
// exact reproducer SQL; this file carries only the RESULT, and
// TestBacktestFrameDigestMatchesTheCommittedProbeRecord re-derives the probe
// record's sha256 over these rows so a silent edit here cannot survive.
//
// PIN LAW (chain-truth R1, second read family): BlockHash is the hash stored
// in raw_logs WITH the Liquidated event - never a fresh number-to-hash
// resolution. Our stored hash was witnessed under coherent-window custody at
// ingest, so pinning to it guarantees the state read sits on the same fork the
// derivation consumed; if the hash were orphaned the pinned call fails LOUD
// (block-not-found) instead of silently serving another fork. A case whose pin
// is unserveable is a preflightExit - NEVER a shrunk N, never a substitute.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// backtestCase is one frozen frame member. Every field is a committed input;
// none is resolved at run time.
type backtestCase struct {
	Bucket             string
	Block              uint64
	LogIndex           uint32
	TxHash             string
	BlockHash          string
	Account            string
	CollateralElements int
	Selection          string
}

// backtestFrameDigest is the probe record's sha256 over the newline-terminated
// lines "0x<tx_hash>:<log_index>" in (block_number, log_index) order - the
// value recorded at freeze time, computed twice out of band (Postgres sha256()
// and a local hash) and identical. backtestFrameDigestOK recomputes it from
// backtestFrame at RUN time, so the committed frame cannot drift from the
// committed record without the run saying so.
const backtestFrameDigest = "0x740ac24077271059e1bd32511fec5f7ab5b23c2c4c182300512dcefa20f0fbf3"

// backtestFrameSize is the frozen N. It is a CONSTANT because the frame is
// frozen: len(backtestFrame) is asserted against it, so deleting a hard case
// is a test failure rather than a quietly smaller run.
const backtestFrameSize = 31

// backtestFrameSeed is recorded for reproducibility (risk-quant R2's freeze
// rule: seeds printed in the report). It is never consumed as a seed here -
// the draw already happened.
const backtestFrameSeed = "solvent-p3-task6-backtest-v1"

// backtestFrame is the frame, in (block, log_index) order.
var backtestFrame = []backtestCase{
	{Bucket: "B0", Block: 150057202, LogIndex: 187,
		TxHash:             "0x846bd1cb53cdc3a8d1e3910631c48d8f93e74423d29d02395e46a87406d04a17",
		BlockHash:          "0x9e536de1af09f42ee10c674b850dbe452db3d8222bd61b9792b1288c8af4f8e5",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B0", Block: 150201196, LogIndex: 279,
		TxHash:             "0x6b1845354cfaf1126de0233c9bb3e21d596155b5a14eb47259db3b3322d1fdd7",
		BlockHash:          "0x6de525185a5752a60cbb4dc67d9e0d65dee39c13da8f5279548d830d7d405cdd",
		Account:            "0xbd62208344625689615b7e39204a594af6ae0a13",
		CollateralElements: 14, Selection: "seeded-draw"},
	{Bucket: "B0", Block: 150201256, LogIndex: 237,
		TxHash:             "0xbe6429c436a0dd499a09f178982e863c8c4fbc4ee04d26dc4e917ae9108093d9",
		BlockHash:          "0x97a999763406ecf627b44f0c94483ed6c52f2cfc9b6afe1f71250171b6223551",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "force-include:max-fanout"},
	{Bucket: "B0", Block: 150446029, LogIndex: 221,
		TxHash:             "0x033c9e23ee14899e1fb3b9ba7ac95164f77d48dc1edc82144b48a0b7b4bd7de4",
		BlockHash:          "0xc011f3163209e33d8b90f4dcb7333aedfa653fc341fe265c522ce26ccc9aecf3",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B0", Block: 150467629, LogIndex: 78,
		TxHash:             "0xb15cfd33dd529e6cc02b34a8a252dc2e957728ff27181da868b3345243758a91",
		BlockHash:          "0xedb61cb1a86961cde954da74dcf3c700bc4f9289f7c69ea558c391dca802bdf2",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B1", Block: 150856433, LogIndex: 44,
		TxHash:             "0x7fde432a6379e003d8cb36623ebc0effeacfb8a21d573cc5f2e8498498d8998b",
		BlockHash:          "0x58142bd2bbd27f77d7d974de9acdc726d25a80871640c5ceb0219aa90b829b79",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B1", Block: 150863633, LogIndex: 7,
		TxHash:             "0x545e98387ae1e05397a4fa1c1bc166ea3f57dbeb10ed6cc8f2253da478197ff0",
		BlockHash:          "0x8cb85029e12e700374f0ce34b6ceec2a98af7428d7d274e59ded5195caeb335b",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B1", Block: 150928436, LogIndex: 93,
		TxHash:             "0x5c1ff34d265b35a53df37302bb93c544288a34037ab2cf25cbc2b4a0a48d4dac",
		BlockHash:          "0xf40425f73709f7b7b3ff35b56c2588118f881903a2c8aef818a332ad25ffe619",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "force-include:max-fanout"},
	{Bucket: "B1", Block: 150957238, LogIndex: 72,
		TxHash:             "0x5322d267c0d20fa5c71e4a7961e04fb132f07cc86f32d19eb3fd65ed75ac922e",
		BlockHash:          "0xff5ae00e2b2b9cccb12348b57c63d5b3ab61549401d3a2cdd43e98d57269592d",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B1", Block: 150964436, LogIndex: 105,
		TxHash:             "0xbc925716e374a5c0cf024b2920937fafd49a1c8bcb52d316d89cf2c2bcbde67e",
		BlockHash:          "0x76e914975efe63f84ec3942ec42afb8b90039324f0787c934bfece17e1ce8b79",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B2", Block: 151050834, LogIndex: 144,
		TxHash:             "0x14f99e7d134b7b45adae06efec4d644071f7ad273ea1eb9d5e3e7afb2b0076df",
		BlockHash:          "0xafd4966481569c40812ecee3a0e3928986c3353a0e089404ca4ae10cb6f90cdd",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B2", Block: 151101237, LogIndex: 97,
		TxHash:             "0xe41ae8c17a2eec7aebc39434ad82f0c6c400e045c2ce09ccbc5b6ee39fd2a820",
		BlockHash:          "0x58e82018e6f06124234961739dc1daec61f0bdcb7476cfaebccf22917213698b",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "force-include:max-fanout"},
	{Bucket: "B2", Block: 151324448, LogIndex: 114,
		TxHash:             "0x9ce2a4f071e190f39fec9514de5a85edb0cf4713905c6bcce7bc221d508a6780",
		BlockHash:          "0xdc2c63408de5a5fa7d54c02082a75a87263c3b85683df0510af5c529fb60d908",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B2", Block: 151382043, LogIndex: 5,
		TxHash:             "0x1f82886a652a2c6556eea929623de345f3347430b4ac1cbee9ff005e9acbf4b7",
		BlockHash:          "0xb644ab740fa518e4735252bd4e1e44117af689343de88aef3a877ee36ca21f34",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B2", Block: 151396444, LogIndex: 106,
		TxHash:             "0xec85464bc77501852e1715c508bddf8ce568a179d1b4e55204fd9886e6ba74e2",
		BlockHash:          "0x10bffce9093f3899768a8654d7c7e0f42fb7b0fb1510f9a800b12bf1bb5cfda8",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B3", Block: 151511643, LogIndex: 83,
		TxHash:             "0x0fb4a5b0bf355f6ddfc15eb7ebd63d68320d6c6a67bda26e5b11876eca81068d",
		BlockHash:          "0x6edd17394b6927f2c5729744146d92c99af9c2776b4aa58bea6c86f0f7991124",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B3", Block: 151533245, LogIndex: 98,
		TxHash:             "0xec29f4a2e11dc6181d40f35ef46d99ebe9af08bf2cba4b34c469c3f0ee45dd65",
		BlockHash:          "0x98d931483f6ba25210b568a4c3a2b95ce4d348dad495c8731e40361df7911292",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B3", Block: 151554841, LogIndex: 12,
		TxHash:             "0x60376916ffc5d4c98b467c8931f27a12cf7e8b8139402b420be4f74c803828cf",
		BlockHash:          "0x35a132a3639599c519e8f41da85deceeb8182c1ce17f51625f1e4e5ddaa9288b",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B3", Block: 151857246, LogIndex: 74,
		TxHash:             "0xc25718a732d8942d35abaec6486f1e6bd59fa9beb61d1e26449fc08a15b0b481",
		BlockHash:          "0x4de70166fcbf3d7ed73d2dcb214b2af673d29971c4f6072e60328b147766d75d",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "force-include:max-fanout"},
	{Bucket: "B3", Block: 151958045, LogIndex: 102,
		TxHash:             "0xcd10a0d8c914631471113a02f018248417014f569a8549cd0c81a348623dbec7",
		BlockHash:          "0xa9932be6d6ae532378f3cbdfa0f5f5fd111e9f92ef72c997df73052db8fc3607",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 15, Selection: "seeded-draw"},
	{Bucket: "B4", Block: 152007376, LogIndex: 157,
		TxHash:             "0x84249d4722ea66b898bb62300faa91fddd53cde0425c5375b2018b3290d72a9c",
		BlockHash:          "0x60a1dc499938a1c70dc6377408b31bc0f8e6490ebeb4a18b1eb37b214687caf7",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 17, Selection: "force-include:two-pass"},
	{Bucket: "B4", Block: 152007376, LogIndex: 160,
		TxHash:             "0x84249d4722ea66b898bb62300faa91fddd53cde0425c5375b2018b3290d72a9c",
		BlockHash:          "0x60a1dc499938a1c70dc6377408b31bc0f8e6490ebeb4a18b1eb37b214687caf7",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 17, Selection: "force-include:two-pass"},
	{Bucket: "B4", Block: 152158566, LogIndex: 111,
		TxHash:             "0x770e93363516e8f55caa5d63257a6c8306fef4648c960d9f3591e60caf607089",
		BlockHash:          "0x359f777b5bcc855acd5538b41d87245ffd3d493b3e25ccd30a5ab43694b07c2f",
		Account:            "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
		CollateralElements: 17, Selection: "force-include:max-fanout"},
	{Bucket: "B4", Block: 152423457, LogIndex: 50,
		TxHash:             "0x6c4b67f112be015a8347ee2332e8bc5c268da58898cafd46959447b20968e1e4",
		BlockHash:          "0xd87dbeb88d02ce826dbcb6f59e303144ebb941407e126ed9530105f652b2c56f",
		Account:            "0x80dbee8c92d4b9d36811d4e32598ceb47e690da9",
		CollateralElements: 1, Selection: "seeded-draw"},
	{Bucket: "B4", Block: 152469659, LogIndex: 74,
		TxHash:             "0x3077cabd88c03759d3740db89310714ce3713c73d1f4ae278dde14f16b7bc763",
		BlockHash:          "0x7350f1ce93de5fdd9e0ba21b294ec908cf07bebace17072650abc28bdb297860",
		Account:            "0x145ce848119d589c35a353f736161ae9a6c537bc",
		CollateralElements: 1, Selection: "seeded-draw"},
	{Bucket: "B5", Block: 152521428, LogIndex: 41,
		TxHash:             "0x44e1e9cffe66eea4a83a02e176efabe589796544d2f7f78e2d5dccc2643ea0c5",
		BlockHash:          "0x74584c150b8a6f9264f107e8662e2543d022c5c2a9ec565cc036888dff1466ba",
		Account:            "0xea3e4cb31c9453642cfae5077bd272dc503c58f8",
		CollateralElements: 10, Selection: "force-include:max-fanout"},
	{Bucket: "B5", Block: 152543289, LogIndex: 194,
		TxHash:             "0x88c4ba9477a33191aad403e9c59b3fe3bb1fa1dc8f65a4797517bca07227f2b0",
		BlockHash:          "0x2ebbdf5274e3bad24fa91d2e5c1992b2b87b4b878dda2666e795b4c04e7e1495",
		Account:            "0xfd1ab83c52f577a2f607414aa06ff0396f7406b9",
		CollateralElements: 1, Selection: "seeded-draw"},
	{Bucket: "B5", Block: 152543672, LogIndex: 304,
		TxHash:             "0x85923ca6e330cb5dc48752e9db9cdc0708247581805bb304dc5dcfb1d7d8a011",
		BlockHash:          "0xfba10d555f75ea52bb60245aa987dc11edb7ea111ee7d59d719a05ed72a1204c",
		Account:            "0x06eea344bb8dd2c38fdb8d1c6acbe2fe2821513d",
		CollateralElements: 6, Selection: "seeded-draw"},
	{Bucket: "B5", Block: 152543767, LogIndex: 645,
		TxHash:             "0x5cb8161e8c63e37ea8c76ac81c0be502c045c7ca4ae9014d37b65dd6816ffc35",
		BlockHash:          "0x2456c721d901a8472083cbd9d2b96ea0e81e1380b995e867c589d30d39e597db",
		Account:            "0xf1b8c6f4868f9a6cd19a4a1050a0b1fc441450ca",
		CollateralElements: 1, Selection: "seeded-draw"},
	{Bucket: "B5", Block: 152560935, LogIndex: 104,
		TxHash:             "0x25577e0b14eeb4067f3fe1acf8a8a4241ce3c9823805e236891fe5ff27175994",
		BlockHash:          "0x33063adc6f5a0881bb6454dd2dead0235746e7d5676edae62dd43434a281a6b6",
		Account:            "0x4e98223542c7957f38a71de1e44676d3f41a60f1",
		CollateralElements: 6, Selection: "seeded-draw"},
	{Bucket: "B6", Block: 153399414, LogIndex: 120,
		TxHash:             "0x5cd245365f421c75196b7b64ae0347f27b69cf92f8a1ca08036565de3e741640",
		BlockHash:          "0xd0df4d3002e7c83ddf835e51087776e9bc2faa1858a9777210e2d1bea2c2e1aa",
		Account:            "0xe4747ad00964096f74d554324add3d87aaaffce2",
		CollateralElements: 13, Selection: "force-include:singleton"},
}

// backtestFrameBody renders the digest preimage: one "0x<tx>:<logIndex>" line
// per case, newline-terminated, in slice order (which IS (block, log_index)
// order - asserted by the frame test).
func backtestFrameBody() string {
	var b strings.Builder
	for _, c := range backtestFrame {
		fmt.Fprintf(&b, "%s:%d\n", strings.ToLower(c.TxHash), c.LogIndex)
	}
	return b.String()
}

// backtestFrameDigestOK recomputes the frame digest and compares it with the
// committed constant. It runs in Phase 0 (before any snapshot or RPC): a frame
// that does not hash to the record is a PRECONDITION failure, because every
// backtest verdict recorded against a different frame is a claim about a
// different sample.
func backtestFrameDigestOK() (got string, ok bool) {
	sum := sha256.Sum256([]byte(backtestFrameBody()))
	got = "0x" + hex.EncodeToString(sum[:])
	return got, got == backtestFrameDigest
}

// backtestFrameKeys renders the frame's "<tx hex, no 0x>:<log index>" keys in
// frame order — the committed input Stage A folds the derived side against.
func backtestFrameKeys() []string {
	out := make([]string, 0, len(backtestFrame))
	for _, c := range backtestFrame {
		out = append(out, strings.TrimPrefix(strings.ToLower(c.TxHash), "0x")+fmt.Sprintf(":%d", c.LogIndex))
	}
	return out
}
