package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestRootCmd_PersistentPreRunE_Wired pins the wiring of the v0->v1
// state-file migration onto rootCmd. The migration hook is what
// translates the legacy state file to its current name the first time
// a post-PR-#488 binary touches an old workspace; without it a CLI
// built after the rename would silently create an empty state file
// next to the legacy one and lose every prior entry. We don't drive the hook end-to-end here — that path is
// covered in internal/axmindex/migrate_test.go and in the integration
// suite — we only assert the hook is still wired, so a refactor that
// silently drops `PersistentPreRunE` fails this test.
func TestRootCmd_PersistentPreRunE_Wired(t *testing.T) {
	if rootCmd.PersistentPreRunE == nil {
		t.Fatal("rootCmd.PersistentPreRunE is nil; the state-file migration hook has been removed")
	}
}

func TestVersionedModuleBuildWithoutLdflags(t *testing.T) {
	source, err := os.ReadFile("version.go")
	if err != nil {
		t.Fatal(err)
	}
	fixture := t.TempDir()
	source = []byte(strings.Replace(string(source), "package cmd", "package main", 1))
	files := map[string]string{
		"version.go": string(source),
		"main.go":    "package main\nimport \"fmt\"\nfunc main() { fmt.Println(resolveVersion(version)) }\n",
		"go.mod":     "module example.com/version-cli\ngo 1.25\n",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(fixture, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	driver := t.TempDir()
	mod := "module example.com/consumer\ngo 1.25\nrequire example.com/version-cli v2.0.1+incompatible\nreplace example.com/version-cli => " + filepath.ToSlash(fixture) + "\n"
	if err := os.WriteFile(filepath.Join(driver, "go.mod"), []byte(mod), 0600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(driver, "bin", "version-cli")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "install", "-mod=mod", "-buildvcs=false", "example.com/version-cli")
	build.Dir = driver
	build.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off", "GOMODCACHE="+t.TempDir(), "GOFLAGS=", "GOBIN="+filepath.Dir(binary))
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("module build: %v %s", err, out)
	}
	out, err := exec.Command(binary).CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != "2.0.1+incompatible" {
		t.Fatalf("version: %v %s", err, out)
	}
}

// TestRootCmd_MigrationExemptCommands verifies the deny-list is
// populated with the commands that must NOT block on a corrupt-state
// migration error. If a future refactor renames a command in the
// deny-list without updating this map, the test catches it before
// users hit a wedged `axm version` / `axm auth` / `axm help`.
func TestRootCmd_MigrationExemptCommands(t *testing.T) {
	for _, name := range []string{"version", "help", "auth", "whoami", "publish"} {
		if !migrationExemptCommands[name] {
			t.Errorf("migrationExemptCommands[%q] = false; expected exempt", name)
		}
	}
	// Negative: a guarded command must NOT be in the deny-list.
	for _, name := range []string{"check", "status", "fetch", "fork", "init", "query", "search"} {
		if migrationExemptCommands[name] {
			t.Errorf("migrationExemptCommands[%q] = true; expected guarded", name)
		}
	}
}

func TestRootCmd_MaterializationCommandsPreflightBeforeMigration(t *testing.T) {
	for _, name := range []string{"pull", "fetch", "fork"} {
		if !materializationCommands[name] {
			t.Errorf("materializationCommands[%q] = false; command could mutate workspace state before the AxiomLib preflight", name)
		}
	}
}
