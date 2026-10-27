package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/transform"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
	"github.com/spf13/cobra"
)

// initSource is the lean-client template `axm init` clones at v<leanClientTag>.
const initSource = "https://github.com/BuildCoherence/axiom-client.git"

var initCmd = &cobra.Command{
	Use:   "init [dir]",
	Short: "Initialize an axiom-client workspace",
	Long: `Clones BuildCoherence/axiom-client at this axm's compiled-in template tag
into the target directory (default ` + "`.`" + `), sets up skills for the selected
AI agents, installs the Published Corpus and the Axiom Site Archive under
~/.axiom (as ` + "`axm upgrade`" + ` does), and pre-warms
` + "`lake build axm_transform Axiom`" + ` so the first ` + "`axm check`" + ` is fast.
Aborts if the target directory is non-empty.`,
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) > 0 {
			dir = args[0]
		}
		absDir, err := filepath.Abs(dir)
		if err != nil {
			return fmt.Errorf("axm init: resolve target directory: %w", err)
		}

		errW := cmd.ErrOrStderr()
		if err := guardTargetEmpty(errW, absDir); err != nil {
			return err
		}

		fmt.Fprintf(cmd.OutOrStdout(), "\nInitializing Axiom workspace at %s\n\n", absDir)

		if err := runClone(errW, initSource, "v"+leanClientTag, absDir); err != nil {
			return err
		}

		ids, err := resolveAgentSelection(cmd.InOrStdin(), cmd.OutOrStdout(), initAgentsFlag)
		if err != nil {
			return fmt.Errorf("axm init: select agents: %w", err)
		}
		if err := materializeAgents(cmd.OutOrStdout(), errW, absDir, ids, false); err != nil {
			return fmt.Errorf("axm init: set up agent skills: %w", err)
		}

		feed, feedErr := upgrade.ReadVersionFeed(cmd.Context(), nil, releaseRepo)
		userErr := runUserLevelSteps(cmd.Context(), cmd, "axm init", feed, feedErr)

		if os.Getenv("AXIOM_SKIP_PREWARM") == "1" {
			progress.Successf(cmd.OutOrStdout(),
				"Workspace ready at %s (pre-warm skipped via AXIOM_SKIP_PREWARM)", absDir)
			return userErr
		}

		return errors.Join(runPrewarm(cmd.Context(), errW, absDir), userErr)
	},
}

// guardTargetEmpty returns nil if absDir is missing (git clone will create it)
// or exists and is empty. Any entry — hidden or not — causes an abort with a
// message that names Axiom's expectation. The stderr writer is threaded in so
// tests using cobra.Command.SetErr capture the diagnostic alongside runE's
// returned error.
func guardTargetEmpty(errW io.Writer, absDir string) error {
	entries, err := os.ReadDir(absDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// Missing directory is fine; git clone will create it.
			return nil
		}
		return fmt.Errorf("axm init: inspect target directory: %w", err)
	}
	if len(entries) > 0 {
		fmt.Fprintf(errW,
			"axm init: target directory is not empty: %s\n"+
				"Axiom clones a fresh lean-client workspace; it refuses to write into an existing directory.\n"+
				"Use `axm init <new-dir>` or clone into an empty directory.\n",
			absDir,
		)
		return fmt.Errorf("target directory is not empty: %s", absDir)
	}
	return nil
}

// runClone clones ref of source into absDir, renames its remote to
// axiom-client for `axm upgrade`, and seeds `.axiomdata/`. Git's stderr
// goes to errW.
func runClone(errW io.Writer, source, ref, absDir string) error {
	if err := preflightGitSource(errW, source); err != nil {
		return err
	}
	fmt.Printf("Cloning %s at %s …\n", source, ref)
	if err := gitClone(errW, source, ref, absDir); err != nil {
		return fmt.Errorf("axm init: cloning %s at %s failed: %w", source, ref, err)
	}
	if err := renameOriginToAxiomClient(errW, absDir); err != nil {
		return fmt.Errorf("axm init: rename origin -> axiom-client: %w", err)
	}
	if err := seedAxiomData(absDir); err != nil {
		return err
	}
	progress.Successf(os.Stdout, "Workspace files in place")
	return nil
}

// renameOriginToAxiomClient runs `git -C <absDir> remote rename origin
// axiom-client` so `axm upgrade` can find a predictable remote name. If
// the repo has no `origin` (e.g. a re-run after manual cleanup), git
// exits non-zero with a message naming the missing remote; we treat that
// as a no-op and continue.
func renameOriginToAxiomClient(errW io.Writer, absDir string) error {
	cmd := exec.Command("git", "-C", absDir, "remote", "rename", "origin", "axiom-client")
	var buf strings.Builder
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		msg := buf.String()
		if strings.Contains(msg, "No such remote") || strings.Contains(msg, "no such remote") {
			return nil
		}
		fmt.Fprint(errW, msg)
		return err
	}
	return nil
}

// preflightGitSource runs `git ls-remote --exit-code <source> HEAD` to probe
// reachability and auth before the actual clone. On non-zero exit it returns a
// structured error that acknowledges GitHub's 404-for-both "repo doesn't exist"
// and "auth missing" response — naming both failure modes without guessing
// between them. See the internal ci-private-repo-clone-auth doc §3.
//
// Lake's transitive clone of AxiomLib during `lake build axm_transform Axiom`
// is deliberately not wrapped: a user whose credentials satisfy this preflight
// also satisfies Lake's clone, and if they don't, Lake's own error names the
// failed URL clearly enough to act on.
func preflightGitSource(errW io.Writer, source string) error {
	// Reject sources that begin with `-` before they reach git's argv.
	// `--` below stops git's own flag parsing, but a leading-dash value
	// can still confuse adjacent tooling that processes the same string
	// (env-var inspectors, future callers that forward `source` without
	// `--`), so we fail loudly at the boundary. This guards against a
	// future caller (env-var, config file) that feeds an untrusted value.
	if strings.HasPrefix(source, "-") {
		return fmt.Errorf(
			"axm init: refusing init source that begins with '-' (would be interpreted as a git flag): %q",
			source,
		)
	}
	cmd := exec.Command("git", "ls-remote", "--exit-code", "--", source, "HEAD")
	cmd.Stderr = errW
	// GIT_TERMINAL_PROMPT=0 keeps git from blocking on a username/password
	// prompt if the caller has no credential helper and the URL is private
	// (headless CI, a locked-down developer box, etc.). Without this, git
	// can stall indefinitely waiting on /dev/tty input instead of returning
	// the non-zero exit that our structured remediation hinges on.
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf(
			"axm init: could not reach %s (%w).\n"+
				"Either the URL is wrong "+
				"or your git credentials lack access. GitHub returns the same 404 for both cases "+
				"on private repos, so this preflight cannot tell them apart.\n"+
				"If your organization enforces SSO, confirm your credential-helper token is "+
				"SSO-authorized for BuildCoherence. Run `gh auth login --web` and select the "+
				"BuildCoherence org to authorize.",
			source, err,
		)
	}
	return nil
}

// gitClone shells `git clone <source> <dest>` and streams stdout/stderr.
// The caller-supplied errW receives the subprocess's stderr so tests that
// bind cobra's ErrOrStderr see the full output.
func gitClone(errW io.Writer, source, ref, absDir string) error {
	args := []string{"clone", "--branch", ref, "--single-branch", "--", source, absDir}
	cmd := exec.Command("git", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = errW
	return cmd.Run()
}

// seedAxiomData creates the .axiomdata/ subdirectories that downstream
// commands expect to exist. Keeping `axmindex.Open` strict (it errors
// when .axiomdata/ is missing) means `axm init` has to materialize the
// directory — not on first publish — or every command in a freshly-
// cloned workspace would fail with ErrNoWorkspace.
func seedAxiomData(absDir string) error {
	for _, sub := range []string{
		filepath.Join(absDir, ".axiomdata", "index"),
		filepath.Join(absDir, ".axiomdata", "files", "A"),
	} {
		if err := os.MkdirAll(sub, 0o755); err != nil {
			return fmt.Errorf("axm init: create %s: %w", sub, err)
		}
	}
	return nil
}

// runPrewarm checks for `lake` on PATH then shells `lake build axm_transform
// Axiom` inside absDir. The `Axiom` target is required because the cloned
// template's `Axioms.lean` does `import Axiom`; building only `axm_transform`
// stops short of staging `Axiom.olean` in `.lake/packages/AxiomLib/.lake/build`,
// which the transform's elaboration needs at `axm check` time.
// Both the missing-toolchain branch and the build-failure branch print a soft
// message and return nil — the clone is left in place and `axm check` will
// retry the build on demand. errW is the cobra-owned stderr
// writer; lake's stderr and the post-failure warning both route through it.
// ctx is forwarded to CheckLakeInstalled so the pre-flight probe respects
// cancellation / the 15s timeout bound.
func runPrewarm(ctx context.Context, errW io.Writer, absDir string) error {
	// The toolchain probe (`lake --version`, which on a cold elan silently
	// fetches a default toolchain) is the ~10s output-less gap users hit
	// right after the clone. Fill it with a branded spinner;
	// it is a no-op on non-TTY / NO_COLOR / CI so piped + e2e output is
	// unchanged.
	lakeSpin := progress.New(errW)
	lakeSpin.Start(msgCheckingToolchain)
	lakeErr := transform.CheckLakeInstalled(ctx)
	if lakeErr != nil {
		lakeSpin.Stop()
		err := lakeErr
		if errors.Is(err, transform.ErrLakeMissing) {
			// `lake` is absent OR present-but-unusable (elan has no
			// default toolchain). The wrapped error carries the specific
			// reason; echo it verbatim so the user can pick between
			// "install elan" and "elan default stable". Keep "Lake" + the
			// installer URL — the e2e suite asserts on them.
			progress.Warnf(errW, "Lake pre-warm skipped — Lean toolchain not configured")
			fmt.Fprintf(errW, "    %v\n", err)
			fmt.Fprintf(errW,
				"    Install Lean (elan) from https://lean-lang.org/install/ or run `elan default stable`,\n"+
					"    then `axm check` will build on demand.\n")
			progress.Successf(os.Stdout, "Workspace ready at %s", absDir)
			return nil
		}
		return fmt.Errorf("axm init: check for lake: %w", err)
	}
	// Leave a persistent purple "✓ Lean toolchain ready" in the spinner's
	// place so the long wait visibly resolves before the lake build begins.
	lakeSpin.Done("Lean toolchain ready")

	fmt.Fprintln(os.Stdout, "Pre-warming Lean build …")
	// Lake emits one "✔ [n/m] Built X" line per job, with multi-second
	// silences between them that read as a hang. Run a spinner alongside:
	// LakeWriter echoes those completion lines above the spinner and feeds
	// the [n/m] counter into the pinned status line, whose elapsed timer
	// keeps ticking through the gaps. On non-TTY / CI the writer is a
	// transparent pass-through, so lake's raw output is unchanged.
	//
	// Both stdout and stderr go through LakeWriter. Lake writes its build
	// progress to stderr, but a cold elan or a Lake-resolved dependency
	// fetch can emit a carriage-return-based progress bar on either stream
	// — LakeWriter detects the first '\r' and yields the line to the
	// subprocess, then resumes our spinner on the closing newline so the
	// silent phase that often follows (extract, link, olean load) still
	// shows a ticking elapsed timer.
	buildSpin := progress.New(errW)
	buildSpin.Start("Building Lean workspace")
	buildCmd := exec.Command("lake", "build", "axm_transform", "Axiom")
	buildCmd.Dir = absDir
	buildCmd.Stdout = buildSpin.LakeWriter()
	buildCmd.Stderr = buildSpin.LakeWriter()
	if err := buildCmd.Run(); err != nil {
		buildSpin.Stop()
		progress.Warnf(errW, "Pre-warm failed — your workspace at %s is still usable", absDir)
		fmt.Fprintf(errW, "    %v\n", err)
		fmt.Fprintf(errW,
			"    Run `lake build` from inside it, or just run `axm check` later to retry.\n")
		return nil
	}
	buildSpin.Done("Lean workspace built")

	progress.Successf(os.Stdout, "Workspace ready at %s", absDir)
	return nil
}

// initAgentsFlag holds the --agents value: a comma-separated list of agent ids
// (claude, cursor, codex, copilot, gemini), or "all" / "none" / "detect".
// Empty (the default) means prompt on a TTY, else fall back to the detected set
// or {claude}. See resolveAgentSelection in agentselect.go.
var initAgentsFlag string

func init() {
	initCmd.Flags().StringVar(&initAgentsFlag, "agents", "",
		"AI agents to set up skills for: a comma-separated list of "+
			strings.Join(agentskills.IDs(), ",")+", or 'all'/'none'/'detect'. "+
			"Prompts interactively when unset on a TTY; also settable via AXIOM_AGENTS.")
	rootCmd.AddCommand(initCmd)
}
