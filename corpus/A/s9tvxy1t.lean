import Axiom

namespace s9tvxy1t

def initialStatmentPayload : String := "Hello, World!"
axiom initialStatment_auth : Axiom.AuthenticatedTerm ("sam", initialStatmentPayload, 1783123642)
def initialStatment : Axiom.Statement "sam" initialStatmentPayload 1783123642 := ⟨initialStatment_auth⟩


end s9tvxy1t
