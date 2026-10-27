package viewer

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceConfinementWindowsPaths(t *testing.T) {
	root, secret := workspaceFixture(t)
	junction := filepath.Join(root, "Workspace", "junction")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", junction, filepath.Dir(secret)).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J: %v: %s", err, out)
	}
	volume := filepath.VolumeName(secret)
	if len(volume) != 2 || volume[1] != ':' {
		t.Fatalf("secret %s is not on a drive letter", secret)
	}
	unc := `\\localhost\` + volume[:1] + `$` + strings.TrimPrefix(secret, volume)
	h := newTestHandler(t, siteFixture(t), root)
	for _, p := range []string{
		secret,
		filepath.ToSlash(secret),
		volume + `..\secret.lean`,
		`..\secret.lean`,
		`Workspace\..\..\secret.lean`,
		unc,
		`Workspace\junction\secret.lean`,
		"Workspace/junction/secret.lean",
	} {
		assertEscapeRejected(t, h, p)
	}
	if body := get(t, h, testHost, filesAPIPath).Body.String(); strings.Contains(body, "secret") {
		t.Errorf("file list follows the junction: %s", body)
	}
}
