package cmd

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/lakefile"
	"golang.org/x/mod/semver"
)

const minimumMaterializationAxiomLibTag = "v1.0.6-beta"
const stagingAxiomLibURL = "https://github.com/BuildCoherence/axiom-lib-staging"

type materializationPermit struct {
	workspaceRoot string
}

type materializationPermitContextKey struct{}

func contextWithMaterializationPermit(ctx context.Context, permit materializationPermit) context.Context {
	return context.WithValue(ctx, materializationPermitContextKey{}, permit)
}

func preflightMaterialization(ctx context.Context, idx *axmindex.Index) (materializationPermit, error) {
	if permit, ok := ctx.Value(materializationPermitContextKey{}).(materializationPermit); ok && permit.validFor(idx) {
		return permit, nil
	}

	lakefilePath := filepath.Join(idx.Root(), "lakefile.lean")
	requirement, err := lakefile.ReadGitDependency(lakefilePath, "AxiomLib")
	if err != nil {
		return materializationPermit{}, fmt.Errorf("workspace AxiomLib pin is unreadable: %w; run `axm upgrade`", err)
	}
	if requirement.URL == stagingAxiomLibURL && requirement.Rev == "main" && syntheticStagingVersion(version) {
		return materializationPermit{workspaceRoot: idx.Root()}, nil
	}
	pin, err := lakefile.ReadGitDependencyTag(lakefilePath, "AxiomLib")
	if err != nil {
		return materializationPermit{}, fmt.Errorf("workspace AxiomLib pin is unreadable: %w; run `axm upgrade`", err)
	}
	if semver.Compare(pin, minimumMaterializationAxiomLibTag) < 0 {
		return materializationPermit{}, fmt.Errorf("workspace pins AxiomLib %s; content materialization requires %s or newer. Run `axm upgrade`", pin, minimumMaterializationAxiomLibTag)
	}
	return materializationPermit{workspaceRoot: idx.Root()}, nil
}

func syntheticStagingVersion(v string) bool {
	return semver.IsValid("v"+v) && (strings.HasPrefix(v, "0.0.0-staging-") || strings.HasPrefix(v, "0.0.0-nightly-"))
}

func (p materializationPermit) validFor(idx *axmindex.Index) bool {
	return p.workspaceRoot == idx.Root()
}
