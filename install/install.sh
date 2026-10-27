#!/bin/sh
set -eu

main() {
    release_base_url='https://github.com/BuildCoherence/axiom-reason-ea/releases/latest/download'

    case "$(uname -s)" in
        Linux) os=linux ;;
        Darwin) os=darwin ;;
        *) echo "axm-install: unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64) arch=amd64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) echo "axm-install: unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    archive="axm_${os}_${arch}.tar.gz"
    tmp=$(mktemp -d)
    staged=''
    trap 'rm -f "$tmp/$archive" "$tmp/checksums.txt" "$tmp/axm"; rmdir "$tmp"; if [ -n "$staged" ]; then rm -f "$staged"; fi' 0
    trap 'exit 1' 1 2 15

    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL \
        "$release_base_url/$archive" -o "$tmp/$archive"
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL \
        "$release_base_url/checksums.txt" -o "$tmp/checksums.txt"

    if ! expected=$(awk -v archive="$archive" '
        NF == 2 && $2 == archive {
            count++
            hash = $1
        }
        END {
            if (count != 1 || length(hash) != 64 || hash ~ /[^[:xdigit:]]/) exit 1
            print tolower(hash)
        }
    ' "$tmp/checksums.txt"); then
        echo "axm-install: missing, duplicate, or invalid checksum for $archive." >&2
        exit 1
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$tmp/$archive")
    elif command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 "$tmp/$archive")
    else
        echo 'axm-install: neither sha256sum nor shasum found on PATH.' >&2
        exit 1
    fi
    if [ "${actual%% *}" != "$expected" ]; then
        echo "axm-install: checksum mismatch for $archive." >&2
        exit 1
    fi

    tar -xzf "$tmp/$archive" -C "$tmp" axm
    install_dir="${INSTALL_DIR:-$HOME/.local/bin}"
    mkdir -p "$install_dir"
    staged=$(mktemp "$install_dir/.axm.XXXXXX")
    install -m 0755 "$tmp/axm" "$staged"
    mv -f "$staged" "$install_dir/axm"

    case ":$PATH:" in
        *":$install_dir:"*) ;;
        *) echo "Add $install_dir to your PATH:  export PATH=\"$install_dir:\$PATH\"" ;;
    esac
    echo "axm installed to $install_dir/axm"
}

main
