package server

import (
	"strconv"
	"strings"

	"deepaicode2api/internal/deepai"
)

// modelRequiresPaidQuota 只在目录明确表示计费时阻止额度耗尽的账号。
// 没有价格的模型仍可尝试，若上游返回 theos_exhausted 则在当前请求内换号。
func modelRequiresPaidQuota(model deepai.Model) bool {
	positive := func(raw string) bool {
		value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
		return err == nil && value > 0
	}
	if positive(model.TheosPerRequest) {
		return true
	}
	for _, price := range model.TheosPerSecond {
		if positive(price) {
			return true
		}
	}
	return model.TheosPerRequest == "" && len(model.TheosPerSecond) == 0 && model.Premier
}
