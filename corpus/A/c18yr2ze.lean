import Axiom

namespace c18yr2ze

def communicative_arithmetic_protocolPayload :=
  "Communicative Arithmetic generates a deterministic workload of 500 arithmetic requests with seed 7, 25 percent strict requests, 35 percent repeated-request opportunities, 0.4 ms network latency, 200 bytes per ms bandwidth, 0.2 ms verification latency, and full cache validity. Each request carries an operation, operands, tolerance, latency budget, verification requirement, and reuse key. The six modeled nodes are FP16 approximate, FP32 general, FP64 precision, exact rational, symbolic, and interval verification. The semantic policy selects the cheapest node satisfying the request contract; fixed FP32 is the local baseline; semantic_no_cache uses the same routing and workload while charging communication on every request. The report includes a 16-cell routing sweep, a 48-cell sensitivity grid, an 81-cell crossover zoom over eight seeds, a 72-cell extended crossover sweep through 2 ms, and a 30-cell far-distance sweep through 100 ms at full reuse."
axiom communicative_arithmetic_protocol_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", communicative_arithmetic_protocolPayload, 1786113702)
def communicative_arithmetic_protocol : Axiom.Statement "hitchhiker2thefuture" communicative_arithmetic_protocolPayload 1786113702 := ⟨communicative_arithmetic_protocol_auth⟩

def communicative_arithmetic_reproducibility_receiptPayload :=
  "The reproducibility commands are python3 verify.py and python3 -m pytest -q. The verification run wrote data/report.json, and the test suite returned 7 passed. The source receipt hashes are simulation.py 46255fd890a5b3805e6efa8e579a29f1506a86e1fd714b0296b94ce2f9d262f3, verify.py b7f9933354fcfd89320a7a7a5c048e99522c437908a172d799497bd519aee8af, test_simulation.py 2a41969a7ed96ef8c89264bfd674445ca1ca3a3072960ff216d3375592e57cec, README.md 5c450424a496f33f34fd83a9e02a2d4853a1614825787020a3e647075b96c9d8, and report.json 343c9dee175dcd2032569f92b4be121ed5c2af8f39469d2ae6e766237edd5b03. These hashes identify this receipt only; they are not a claim of immutable external source hosting."
axiom communicative_arithmetic_reproducibility_receipt_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", communicative_arithmetic_reproducibility_receiptPayload, 1786113702)
def communicative_arithmetic_reproducibility_receipt : Axiom.Statement "hitchhiker2thefuture" communicative_arithmetic_reproducibility_receiptPayload 1786113702 := ⟨communicative_arithmetic_reproducibility_receipt_auth⟩

end c18yr2ze
