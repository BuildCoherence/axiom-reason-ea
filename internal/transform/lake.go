package transform

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// lakeVersionProbeTimeout bounds how long `lake --version` may run during
// the CheckLakeInstalled pre-flight. The probe normally returns in under
// a second, but an elan-shimmed `lake` can hang indefinitely if the
// configured toolchain tries to download a missing component over a
// wedged network — we don't want the CLI to stall the user forever on
// pre-flight. 15s is generous enough for a cold elan resolve on a warm
// network, short enough that a genuinely-stuck probe surfaces promptly.
const lakeVersionProbeTimeout = 15 * time.Second

// ErrLakeMissing is returned by CheckLakeInstalled and Invoke when the
// `lake` binary cannot be found on PATH, or when it is on PATH but
// unusable because elan has no default toolchain configured. Both
// conditions share the same fix (install/configure elan), so callers
// only need to branch on one sentinel.
var ErrLakeMissing = errors.New("transform: `lake` not found on PATH; install elan from https://lean-lang.org/install/")

// elanNoDefaultToolchainMarker is the substring elan prints on stderr
// when `lake` (shimmed through elan) is invoked with no default toolchain
// configured. Elan phrases the error consistently as "no default toolchain
// configured" — we match on the lower-case substring for robustness.
const elanNoDefaultToolchainMarker = "no default toolchain configured"

// CheckLakeInstalled returns nil if `lake` is on PATH AND (best-effort)
// runnable through elan. Otherwise it wraps ErrLakeMissing. Used by
// `axm check`, `axm fork`, `axm pull`, and `axm init`'s pre-warm path.
//
// We probe with `lake --version`: it's the cheapest invocation that still
// forces elan to resolve a toolchain, and it emits the "no default
// toolchain configured" error that would otherwise only surface several
// seconds later under `lake exe axm_transform`.
//
// Only the specific elan-no-default-toolchain stderr is promoted to
// ErrLakeMissing; any other `lake --version` failure mode is ignored
// (treated as "lake is there; maybe the probe itself is unreliable"),
// so that legitimate but unusual setups still pass the pre-flight.
//
// ctx bounds the probe: we derive a 15-second timeout child so a
// wedged elan shim (e.g. hung toolchain download) can't stall the CLI's
// pre-flight indefinitely. Pass `cmd.Context()` from a Cobra RunE, or
// `context.Background()` if you're calling from a location without one.
func CheckLakeInstalled(ctx context.Context) error {
	if _, err := exec.LookPath("lake"); err != nil {
		return fmt.Errorf("%w: %v", ErrLakeMissing, err)
	}
	probeCtx, cancel := context.WithTimeout(ctx, lakeVersionProbeTimeout)
	defer cancel()
	var stderr bytes.Buffer
	cmd := exec.CommandContext(probeCtx, "lake", "--version")
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if strings.Contains(strings.ToLower(stderr.String()), elanNoDefaultToolchainMarker) {
			return fmt.Errorf("%w: elan reports no default toolchain configured (run `elan default stable` or `elan install`) — original error: %v", ErrLakeMissing, err)
		}
		// Fall through: treat other probe failures as non-fatal. A probe
		// timeout (DeadlineExceeded) counts as "probe unreliable" — the
		// command proceeds; the real subprocess will run
		// under its own separate timeout.
	}
	return nil
}
