import { describe, it, expect, beforeEach } from 'vitest'
import { login, registerUser, resetState } from '../src/auth'

beforeEach(() => {
  resetState()
  registerUser('perf', 'Pass1234!')
})

describe('NFR-002 登录接口响应性能', () => {
  it('95 分位响应时间不超过 500ms', () => {
    // 预热：前 3 次不计入
    for (let i = 0; i < 3; i++) login('perf', 'Pass1234!', '127.0.0.1')
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      login('perf', 'Pass1234!', '127.0.0.1')
      const end = performance.now()
      samples.push(end - start)
    }
    samples.sort((a, b) => a - b)
    const p95Index = Math.floor(samples.length * 0.95)
    const p95 = samples[p95Index]
    expect(p95).toBeLessThan(500)
  })

  it('99 分位响应时间不超过 1000ms', () => {
    // 预热
    for (let i = 0; i < 3; i++) login('perf', 'Pass1234!', '127.0.0.1')
    const samples: number[] = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      login('perf', 'Pass1234!', '127.0.0.1')
      const end = performance.now()
      samples.push(end - start)
    }
    samples.sort((a, b) => a - b)
    const p99Index = Math.floor(samples.length * 0.99)
    const p99 = samples[p99Index]
    expect(p99).toBeLessThan(1000)
  })
})
