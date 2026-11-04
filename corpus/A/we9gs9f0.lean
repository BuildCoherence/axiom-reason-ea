import Axiom

namespace we9gs9f0

def welcomePayload := "At the end of the day, I hope that everyone unlocks their potential."
axiom welcome_auth : Axiom.AuthenticatedTerm ("MetaBias", welcomePayload, 1783352483)
def welcome : Axiom.Statement "MetaBias" welcomePayload 1783352483 := ⟨welcome_auth⟩

end we9gs9f0
