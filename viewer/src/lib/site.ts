// Site constants for the Axiom Site Archive and the local `axm viewer`.
export const SITE_URL = "https://axiomreason.com";
export const SITE_TITLE =
  "Axiom: a free, open-source local toolkit for logically valid reasoning";
export const SITE_DESCRIPTION =
  "Refine and verify ideas locally with a free, open-source toolkit. This site is the read-only archive of every file published to Axiom.";
export const REPO_URL = "https://github.com/BuildCoherence/axiom-reason-ea";
export const STATIC_OG_IMAGE = "/og/landing.png";
// The prerendered pages the sitemap lists besides the corpus pages.
export const SITEMAP_STATIC_PATHS = [
  "/",
  "/graph",
  "/install/toolkit",
  "/install/cli",
];

const INSTALL_BASE_URL = "https://install.axiom.computer";
export const UNIX_INSTALL_COMMAND = `curl -fsSL ${INSTALL_BASE_URL} | sh`;
export const WINDOWS_INSTALL_COMMAND = `irm ${INSTALL_BASE_URL}/install.ps1 | iex`;
export const GO_INSTALL_COMMAND =
  "go install github.com/BuildCoherence/axiom-reason-ea/v2/cmd/axm@latest";
export const GET_STARTED_COMMANDS = [
  "axm init my-ideas --agents claude && cd my-ideas",
  "claude",
  "axm viewer",
];
