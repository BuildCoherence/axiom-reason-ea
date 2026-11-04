import Axiom

namespace pvm515b0

def initialStatmentPayload : String := "Hello, World!"
axiom initialStatment_auth : Axiom.AuthenticatedTerm ("sam", initialStatmentPayload, 1783113441)
def initialStatment : Axiom.Statement "sam" initialStatmentPayload 1783113441 := ⟨initialStatment_auth⟩


end pvm515b0
