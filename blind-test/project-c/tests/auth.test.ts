import { describe, it, expect, beforeEach } from 'vitest'
import { registerUser, login, resetState, getLockStatus } from '../src/auth'

const IP = '127.0.0.1'

beforeEach(() => resetState())

describe('Basic login', () => {
  it('correct credentials login successfully', () => {
    registerUser('testuser', 'Passw0rd!')
    const result = login('testuser', 'Passw0rd!', IP)
    expect(result.success).toBe(true)
    expect(result.token).toBeDefined()
  })
  it('wrong password fails', () => {
    registerUser('testuser', 'Passw0rd!')
    const result = login('testuser', 'wrong', IP)
    expect(result.success).toBe(false)
  })
})
