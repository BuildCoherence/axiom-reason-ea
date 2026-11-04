import Axiom

namespace z0saxct7

def initialStatmentPayload : String := "Hello, World!"
axiom initialStatment_auth : Axiom.AuthenticatedTerm ("sam", initialStatmentPayload, 1783115314)
def initialStatment : Axiom.Statement "sam" initialStatmentPayload 1783115314 := ⟨initialStatment_auth⟩


end z0saxct7
