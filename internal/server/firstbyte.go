package server

import (
	"context"
	"io"
	"net/http"
	"sync"
	"time"

	"deepaicode2api/internal/deepai"
)

// firstByteWatch 覆盖从发起请求到读到首个响应字节的时间，包括等待响应头。
// 首字节后停表，后续数据由 idleTimeoutBody 管理。
type firstByteWatch struct {
	mu      sync.Mutex
	timer   *time.Timer
	cancel  context.CancelFunc
	done    bool
	expired bool
}

func (w *firstByteWatch) expire() {
	w.mu.Lock()
	if w.done {
		w.mu.Unlock()
		return
	}
	w.done = true
	w.expired = true
	w.mu.Unlock()
	w.cancel()
}

// finish 停止首字节计时并报告是否已经超时。
func (w *firstByteWatch) finish() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.done = true
	w.timer.Stop()
	return w.expired
}

type firstByteBody struct {
	io.ReadCloser
	watch *firstByteWatch
}

func (b *firstByteBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 {
		b.watch.finish()
	}
	if err != nil && b.watch.finish() {
		return n, context.DeadlineExceeded
	}
	return n, err
}

func (b *firstByteBody) Close() error {
	b.watch.finish()
	b.watch.cancel()
	return b.ReadCloser.Close()
}

// openBeforeFirstByte 在响应头和响应体首字节期间使用同一个预算。
// 独立 cancel 在 Body 关闭时释放，不能在收到响应头时提前取消请求。
func openBeforeFirstByte(ctx context.Context, timeout time.Duration, open func(context.Context) (*http.Response, error)) (*http.Response, error) {
	requestCtx, cancel := context.WithCancel(ctx)
	watch := &firstByteWatch{cancel: cancel}
	watch.timer = time.AfterFunc(timeout, watch.expire)
	resp, err := open(requestCtx)
	if err != nil {
		expired := watch.finish()
		cancel()
		if expired && ctx.Err() == nil {
			return nil, context.DeadlineExceeded
		}
		return nil, err
	}
	resp.Body = &firstByteBody{ReadCloser: resp.Body, watch: watch}
	return resp, nil
}

func openUpstreamModel(ctx context.Context, client *deepai.Client, acct *deepai.Account, path string, body []byte, affinity string, stream bool) (*http.Response, error) {
	first := upstreamIdleTimeout
	if !stream {
		first = upstreamFirstByteTimeout
	}
	return openBeforeFirstByte(ctx, first, func(requestCtx context.Context) (*http.Response, error) {
		return client.OpenModel(requestCtx, acct, path, body, affinity)
	})
}
