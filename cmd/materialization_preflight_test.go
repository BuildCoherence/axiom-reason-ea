package cmd

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
)

func TestFetchRefusesStaleAxiomLibBeforeMaterialization(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	writeAxiomLibPin(t, root, "v1.0.4-beta")

	_, _, err := runFetchCmd(t, root, fxRoot)
	want := "workspace pins AxiomLib v1.0.4-beta; content materialization requires v1.0.6-beta or newer. Run `axm upgrade`"
	if err == nil || err.Error() != want {
		t.Fatalf("runFetch error = %v, want %q", err, want)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
		t.Fatalf("content materialization started: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", workspaceLockFilename)); !os.IsNotExist(err) {
		t.Fatalf("workspace lock created before refusal: %v", err)
	}
}

func TestFetchRefusesMalformedAxiomLibPinBeforeMaterialization(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	writeAxiomLibPin(t, root, "main")

	_, _, err := runFetchCmd(t, root, fxRoot)
	if err == nil || !strings.Contains(err.Error(), "workspace AxiomLib pin is unreadable") || !strings.Contains(err.Error(), "axm upgrade") {
		t.Fatalf("runFetch error = %v, want malformed-pin upgrade refusal", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
		t.Fatalf("malformed pin reached materialization: %v", err)
	}
}

func TestFetchAcceptsCurrentAndNewerAxiomLibPins(t *testing.T) {
	for _, tag := range []string{minimumMaterializationAxiomLibTag, "v1.1.0"} {
		t.Run(tag, func(t *testing.T) {
			installFixtureCorpus(t)
			root := initFetchWorkspace(t)
			writeAxiomLibPin(t, root, tag)

			if _, _, err := runFetchCmd(t, root, fxRoot); err != nil {
				t.Fatalf("runFetch(%s): %v", tag, err)
			}
			assertCachedContent(t, root, fxRoot, fxE)
		})
	}
}

func TestForkRefusesStaleAxiomLibBeforeToolchainOrFetch(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	writeAxiomLibPin(t, root, "v1.0.4-beta")
	t.Setenv("PATH", t.TempDir())

	_, _, err := runForkCmd(t, root, fxRoot, "Dest")
	if err == nil || !strings.Contains(err.Error(), "content materialization requires v1.0.6-beta or newer. Run `axm upgrade`") {
		t.Fatalf("runFork error = %v, want workspace-floor refusal before missing-lake error", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
		t.Fatalf("fork reached materialization: %v", err)
	}
}

func TestPullRefusesStaleAxiomLib(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	writeAxiomLibPin(t, root, "v1.0.4-beta")
	t.Setenv("PATH", t.TempDir())

	_, _, err := runPullCmd(t, root, "alice")
	if err == nil || !strings.Contains(err.Error(), "content materialization requires v1.0.6-beta or newer. Run `axm upgrade`") {
		t.Fatalf("runPull error = %v, want workspace-floor refusal", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
		t.Fatalf("pull reached materialization: %v", err)
	}
}

func TestSharedClosureCacheRequiresPreflightPermit(t *testing.T) {
	install := installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	pc, err := corpus.Open(install)
	if err != nil {
		t.Fatal(err)
	}

	_, _, err = ensureClosureCached(idx, pc, fxRoot, true, materializationPermit{}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "requires the workspace compatibility preflight") {
		t.Fatalf("ensureClosureCached error = %v, want missing-preflight refusal", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
		t.Fatalf("shared cache materialized without permit: %v", err)
	}
}

func TestStagingMainExceptionIsExact(t *testing.T) {
	tests := []struct {
		name        string
		binary      string
		url         string
		rev         string
		wantAllowed bool
	}{
		{"staging build exact staging main", "0.0.0-staging-abc1234", stagingAxiomLibURL, "main", true},
		{"nightly build exact staging main", "0.0.0-nightly-abc1234", stagingAxiomLibURL, "main", true},
		{"production build staging main", "1.1.3-beta", stagingAxiomLibURL, "main", false},
		{"dev build staging main", "dev", stagingAxiomLibURL, "main", false},
		{"staging build production main", "0.0.0-staging-abc1234", "https://github.com/BuildCoherence/axiom-lib", "main", false},
		{"staging build other floating ref", "0.0.0-staging-abc1234", stagingAxiomLibURL, "develop", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			forbidHTTP(t)
			root := initFetchWorkspace(t)
			writeAxiomLibRequire(t, root, tt.url, tt.rev)
			idx, err := axmindex.Open(root)
			if err != nil {
				t.Fatal(err)
			}
			oldVersion := version
			version = tt.binary
			t.Cleanup(func() { version = oldVersion })

			_, err = preflightMaterialization(context.Background(), idx)
			if tt.wantAllowed && err != nil {
				t.Fatalf("preflightMaterialization: %v", err)
			}
			if !tt.wantAllowed && (err == nil || !strings.Contains(err.Error(), "axm upgrade")) {
				t.Fatalf("preflightMaterialization error = %v, want upgrade refusal", err)
			}
		})
	}
}
