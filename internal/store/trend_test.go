package store

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func boolValue(v bool) *bool { return &v }

func TestTrendCoverageBoundariesAndReportedValues(t *testing.T) {
	st := newStore(t)
	start := time.Date(2025, 12, 31, 23, 0, 0, 0, time.UTC)
	st.mu.Lock()
	st.trend = trendState{StartedAt: start.Unix(), Days: map[string]TrendDay{}}
	st.mu.Unlock()

	// 第一天的成本、缓存未上报，第二天明确为零。499 不算失败。
	st.recordAt(LogEntry{Status: 200, TokensIn: 100, TokensInReported: boolValue(true)}, 0, start)
	st.recordAt(LogEntry{Status: StatusClientGone, Err: "context canceled", TokensIn: 50, TokensInReported: boolValue(true), CachedReported: boolValue(true), CostReported: boolValue(true)}, 0, start.Add(time.Hour))
	st.recordAt(LogEntry{Status: 502, CachedTokens: 8, CachedReported: boolValue(true), Cost: 0.5, CostReported: boolValue(true)}, 0, start.Add(2*time.Hour))
	got := st.trendDaysAt(4, start.Add(3*time.Hour))
	if got.Timezone != "UTC" || got.StartedAt != start.Unix() || len(got.Days) != 2 {
		t.Fatalf("coverage = %+v", got)
	}
	first, second := got.Days[0], got.Days[1]
	if first.Date != "2025-12-31" || !first.Partial || first.Requests != 1 || first.CacheReportedRequests != 0 || first.CostReportedRequests != 0 {
		t.Fatalf("partial starting day = %+v", first)
	}
	if second.Date != "2026-01-01" || !second.Partial || second.Requests != 2 || second.ClientGone != 1 || second.Failed != 1 || second.CacheReportedRequests != 2 || second.CachePairedRequests != 1 || second.CachePairedTokens != 0 || second.CachePairedInputTokens != 50 || second.CostReportedRequests != 2 || second.Cost != 0.5 {
		t.Fatalf("second day = %+v", second)
	}
	// 包含完整覆盖但没有请求的日期；覆盖起点之前的日期永不生成。
	later := st.trendDaysAt(10, start.Add(49*time.Hour))
	if len(later.Days) != 4 || later.Days[2].Date != "2026-01-02" || later.Days[2].Partial || later.Days[2].Requests != 0 {
		t.Fatalf("covered empty day = %+v", later.Days)
	}
}

func TestTrendLegacyStatsAndEncryptedRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	statsPath, _ := deriveSidePaths(path)
	if err := os.WriteFile(statsPath, []byte(`{"started_at":100,"total_requests":33,"total_tokens_in":200,"total_cost":1.25}`), 0o600); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{7}, 32)
	st, err := OpenWithKey(path, key)
	if err != nil {
		t.Fatal(err)
	}
	before := st.TrendDays(30)
	if len(before.Days) != 1 || before.Days[0].Requests != 0 || st.Stats().TotalRequests != 33 {
		t.Fatalf("legacy migration = %+v / %+v", before, st.Stats())
	}
	gatewayCost := 0.000008325
	st.Record(LogEntry{Status: 200, TokensIn: 20, TokensInReported: boolValue(true), CachedTokens: 5, CachedReported: boolValue(true), Cost: 0.125, CostReported: boolValue(true), GatewayCost: &gatewayCost}, 0)
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Reseal(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(statsPath)
	if err != nil || !isEnvelope(raw) || bytes.Contains(raw, []byte("observed_trend")) {
		t.Fatalf("trend must be sealed: %v", err)
	}
	reopened, err := OpenWithKey(path, key)
	if err != nil {
		t.Fatal(err)
	}
	after := reopened.TrendDays(30)
	if after.StartedAt != before.StartedAt || len(after.Days) != 1 || after.Days[0].Requests != 1 || after.Days[0].CachedTokens != 5 || after.Days[0].Cost != 0.125 || after.Days[0].GatewayCost != gatewayCost || after.Days[0].GatewayCostReportedRequests != 1 || reopened.Stats().TotalRequests != 34 || reopened.Stats().TotalCost != 1.375 {
		t.Fatalf("restart = %+v / %+v", after, reopened.Stats())
	}
	logs := reopened.QueryLogs(QueryFilter{Limit: 10})
	if len(logs) != 1 || !reported(logs[0].CachedReported) || !reported(logs[0].CostReported) || logs[0].GatewayCost == nil || *logs[0].GatewayCost != gatewayCost {
		t.Fatalf("encrypted log metadata = %+v", logs)
	}
	// 旧日志不含布尔字段，仍可读取且保持未知状态。
	var legacy LogEntry
	if err := json.Unmarshal([]byte(`{"status":200,"cost":0}`), &legacy); err != nil || legacy.CostReported != nil || legacy.CachedReported != nil || legacy.GatewayCost != nil {
		t.Fatalf("legacy log = %+v, err=%v", legacy, err)
	}
}

func TestGatewayCostZeroAndMissingSurviveRestart(t *testing.T) {
	st := newStore(t)
	zero := 0.0
	st.Record(LogEntry{Status: 200, Model: "missing"}, 0)
	st.Record(LogEntry{Status: 200, Model: "zero", GatewayCost: &zero}, 0)
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(st.Path())
	if err != nil {
		t.Fatal(err)
	}
	logs := reopened.Logs(0)
	if len(logs) != 2 || logs[0].Model != "zero" || logs[0].GatewayCost == nil || *logs[0].GatewayCost != 0 || logs[1].Model != "missing" || logs[1].GatewayCost != nil {
		t.Fatalf("missing and explicit zero = %+v", logs)
	}
	day := reopened.TrendDays(1).Days[0]
	if day.GatewayCostReportedRequests != 1 || day.GatewayCost != 0 || day.CostReportedRequests != 0 {
		t.Fatalf("gateway zero trend = %+v", day)
	}
}

func TestTrendSnapshotConcurrentSaveAndReset(t *testing.T) {
	st := newStore(t)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				st.Record(LogEntry{Status: 200, TokensIn: 1, TokensInReported: boolValue(true)}, 0)
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			if err := st.Save(); err != nil {
				t.Errorf("concurrent save: %v", err)
				return
			}
		}
	}()
	wg.Wait()
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenWithKey(st.Path(), nil)
	if err != nil {
		t.Fatal(err)
	}
	trend := reopened.TrendDays(1)
	if len(trend.Days) != 1 || trend.Days[0].Requests != 400 || trend.Days[0].TokensIn != 400 {
		t.Fatalf("lost concurrent records: %+v", trend)
	}
	st.mu.RLock()
	old, revision := st.statsSnapshotLocked(), st.statsRevision
	st.mu.RUnlock()
	st.ClearStats()
	st.clearStatsDirtyIfSnapshotUnchanged(old.Stats, revision)
	st.mu.RLock()
	dirty := st.statsDirty
	st.mu.RUnlock()
	if !dirty {
		t.Fatal("reset after snapshot must remain dirty")
	}
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	reopened, err = OpenWithKey(st.Path(), nil)
	if err != nil {
		t.Fatal(err)
	}
	reset := reopened.TrendDays(1)
	if len(reset.Days) != 1 || reset.Days[0].Requests != 0 || reopened.Stats().TotalRequests != 0 {
		t.Fatalf("reset not persisted: %+v", reset)
	}
}
