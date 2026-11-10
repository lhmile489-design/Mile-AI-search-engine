package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SaveKeys merges updates into the env file at path. Empty (after trimming)
// values are skipped, so an empty form field never wipes a saved key. Other
// lines, comments and the line ending style are kept. The file is written as
// UTF-8 without BOM through a temp file and a rename. Values are never logged.
func SaveKeys(path string, updates map[string]string) error {
	if path == "" {
		return errors.New("无法确定配置文件位置：%APPDATA% 未设置")
	}
	clean := map[string]string{}
	for k, v := range updates {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if strings.ContainsAny(v, "\r\n\x00") {
			return fmt.Errorf("%s 含有换行或控制字符", k)
		}
		clean[k] = v
	}
	if len(clean) == 0 {
		return nil
	}

	var content string
	if b, err := os.ReadFile(path); err == nil {
		content = strings.TrimPrefix(string(b), utf8BOM)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("读取配置文件失败：%w", err)
	}
	eol := "\n"
	if strings.Contains(content, "\r\n") {
		eol = "\r\n"
	}
	var lines []string
	if content != "" {
		lines = strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
		if lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
	}

	done := map[string]bool{}
	for i, ln := range lines {
		t := strings.TrimSpace(ln)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		k, _, ok := strings.Cut(t, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		if v, hit := clean[k]; hit {
			lines[i] = k + "=" + v
			done[k] = true
		}
	}
	var missing []string
	for k := range clean {
		if !done[k] {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	for _, k := range missing {
		lines = append(lines, k+"="+clean[k])
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("创建配置目录失败：%w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, eol)+eol), 0o600); err != nil {
		return fmt.Errorf("写入配置文件失败：%w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("替换配置文件失败：%w", err)
	}
	return nil
}
