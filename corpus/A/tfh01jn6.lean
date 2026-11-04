import Axiom

namespace tfh01jn6

def welcomePayload := "I'm excited to start using Axiom to help me sharpen my worldview."
axiom welcome_auth : Axiom.AuthenticatedTerm ("zach", welcomePayload, 1783289055)
def welcome : Axiom.Statement "zach" welcomePayload 1783289055 := ⟨welcome_auth⟩

end tfh01jn6
