package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestFirstByteTimeout(t *testing.T) {
	t.Run("等待响应头", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_, err := openBeforeFirstByte(ctx, 30*time.Millisecond, func(reqCtx context.Context) (*http.Response, error) {
			<-reqCtx.Done()
			return nil, reqCtx.Err()
		})
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("等待响应头应超时，实际 %v", err)
		}
	})

	t.Run("响应头之后仍等待首字节", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		resp, err := openBeforeFirstByte(ctx, 30*time.Millisecond, func(reqCtx context.Context) (*http.Response, error) {
			reader, writer := io.Pipe()
			go func() {
				<-reqCtx.Done()
				_ = writer.CloseWithError(reqCtx.Err())
			}()
			return &http.Response{Body: reader}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		_, err = io.ReadAll(resp.Body)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("等待响应体首字节应超时，实际 %v", err)
		}
	})

	t.Run("收到首字节后不再受首字节预算限制", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		var requestCtx context.Context
		resp, err := openBeforeFirstByte(ctx, 50*time.Millisecond, func(reqCtx context.Context) (*http.Response, error) {
			requestCtx = reqCtx
			reader, writer := io.Pipe()
			go func() {
				defer writer.Close()
				_, _ = writer.Write([]byte("a"))
				time.Sleep(120 * time.Millisecond)
				_, _ = writer.Write([]byte("b"))
			}()
			return &http.Response{Body: reader}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil || string(body) != "ab" {
			t.Fatalf("首字节后应继续接收响应，body=%q err=%v", body, err)
		}
		if err := requestCtx.Err(); err != nil {
			t.Fatalf("响应体关闭前不应取消请求：%v", err)
		}
	})

	t.Run("调用方取消保持原语义", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := openBeforeFirstByte(ctx, time.Second, func(reqCtx context.Context) (*http.Response, error) {
			return nil, reqCtx.Err()
		})
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("应保留调用方取消，实际 %v", err)
		}
	})
}
