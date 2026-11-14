package store

import (
	"maps"
	"time"
)

// TrendDay 只统计启用日汇总以后实际记录的请求，不由有限的日志反推。
// Token 和费用均只累加上游明确提供的字段。缓存比例须使用配对样本。
type TrendDay struct {
	Date                        string  `json:"date"`
	Partial                     bool    `json:"partial"`
	Requests                    int64   `json:"requests"`
	Failed                      int64   `json:"failed"`
	ClientGone                  int64   `json:"client_gone"`
	TokensIn                    int64   `json:"tokens_in"`
	TokensOut                   int64   `json:"tokens_out"`
	InputReportedRequests       int64   `json:"input_reported_requests"`
	OutputReportedRequests      int64   `json:"output_reported_requests"`
	CachedTokens                int64   `json:"cached_tokens"`
	CacheReportedRequests       int64   `json:"cache_reported_requests"`
	CachePairedRequests         int64   `json:"cache_paired_requests"`
	CachePairedTokens           int64   `json:"cache_paired_tokens"`
	CachePairedInputTokens      int64   `json:"cache_paired_input_tokens"`
	Cost                        float64 `json:"cost"`
	CostReportedRequests        int64   `json:"cost_reported_requests"`
	GatewayCost                 float64 `json:"gateway_cost"`
	GatewayCostReportedRequests int64   `json:"gateway_cost_reported_requests"`
}

type trendState struct {
	StartedAt int64               `json:"started_at"`
	Days      map[string]TrendDay `json:"days"`
}

type statsFile struct {
	Stats
	ObservedTrend trendState `json:"observed_trend"`
}

// Trend 包含覆盖起点和实际覆盖的 UTC 日期。覆盖起点之前不生成零值日期。
type Trend struct {
	StartedAt   int64      `json:"started_at"`
	GeneratedAt int64      `json:"generated_at"`
	Timezone    string     `json:"timezone"`
	Days        []TrendDay `json:"days"`
}

func (s *Store) initTrend(now time.Time) {
	if s.trend.StartedAt == 0 {
		s.trend = trendState{StartedAt: now.Unix(), Days: make(map[string]TrendDay)}
		s.statsRevision++
		s.statsDirty = true
	} else if s.trend.Days == nil {
		s.trend.Days = make(map[string]TrendDay)
	}
}

// statsSnapshotLocked 在读锁中复制，避免落盘序列化与 Record 并发访问 map。
func (s *Store) statsSnapshotLocked() statsFile {
	return statsFile{Stats: s.st.Stats, ObservedTrend: trendState{
		StartedAt: s.trend.StartedAt,
		Days:      maps.Clone(s.trend.Days),
	}}
}

func reported(v *bool) bool { return v != nil && *v }

// recordTrendLocked 使用请求完成的 UTC 日期；调用方持写锁。
func (s *Store) recordTrendLocked(e LogEntry, now time.Time) {
	s.initTrend(now)
	date := now.UTC().Format(statsDayLayout)
	d := s.trend.Days[date]
	d.Requests++
	if e.Status == StatusClientGone {
		d.ClientGone++
	} else if e.Status >= 400 || e.Err != "" {
		d.Failed++
	}
	if reported(e.TokensInReported) {
		d.InputReportedRequests++
		d.TokensIn += int64(e.TokensIn)
	}
	if reported(e.TokensOutReported) {
		d.OutputReportedRequests++
		d.TokensOut += int64(e.TokensOut)
	}
	if reported(e.CachedReported) {
		d.CacheReportedRequests++
		d.CachedTokens += int64(e.CachedTokens)
		if reported(e.TokensInReported) {
			d.CachePairedRequests++
			d.CachePairedTokens += int64(e.CachedTokens)
			d.CachePairedInputTokens += int64(e.TokensIn)
		}
	}
	if reported(e.CostReported) {
		d.CostReportedRequests++
		d.Cost += e.Cost
	}
	if e.GatewayCost != nil {
		d.GatewayCostReportedRequests++
		d.GatewayCost += *e.GatewayCost
	}
	s.trend.Days[date] = d
	s.statsRevision++
}

// TrendDays 返回以当前 UTC 日为终点的指定天数；days 限制在 1–365。
func (s *Store) TrendDays(days int) Trend { return s.trendDaysAt(days, time.Now()) }

func (s *Store) trendDaysAt(days int, now time.Time) Trend {
	if days < 1 {
		days = 1
	} else if days > 365 {
		days = 365
	}
	now = now.UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	s.mu.RLock()
	started := s.trend.StartedAt
	result := Trend{StartedAt: started, GeneratedAt: now.Unix(), Timezone: "UTC", Days: make([]TrendDay, 0, days)}
	for i := days - 1; i >= 0; i-- {
		date := today.AddDate(0, 0, -i)
		// 包含起点所在的部分日期，但不伪造起点前的日期。
		if started == 0 || date.AddDate(0, 0, 1).Unix() <= started {
			continue
		}
		key := date.Format(statsDayLayout)
		d := s.trend.Days[key]
		d.Date = key
		d.Partial = date.Unix() < started || date.Equal(today)
		result.Days = append(result.Days, d)
	}
	s.mu.RUnlock()
	return result
}
