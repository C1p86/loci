package discovery

import (
	"os"
	"path/filepath"
)

// FindXciRoot walks up from start looking for a directory that contains a .xci/
// subdirectory. Returns (dir, true) when found, or ("", false) if not found.
func FindXciRoot(start string) (string, bool) {
	abs, err := filepath.Abs(start)
	if err != nil {
		return "", false
	}

	p := abs
	for {
		candidate := filepath.Join(p, ".xci")
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return p, true
		}
		parent := filepath.Dir(p)
		if parent == p {
			// reached filesystem root
			break
		}
		p = parent
	}
	return "", false
}
