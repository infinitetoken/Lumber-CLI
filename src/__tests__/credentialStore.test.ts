import { storeFor } from '../credentials'

// The real credential store of the system the tests run on: the Keychain, Windows Credential Manager, or the Secret
// Service (CI starts a GNOME Keyring for it). Only with LUMBER_STORE_TEST set, as CI runs it on all three, since it
// writes to your own store; and under its own name, so it never touches a session lumber saved.
const real = process.env.LUMBER_STORE_TEST ? describe : describe.skip

real(`the ${process.platform} credential store`, () => {
  const store = storeFor(process.platform, 'Lumber CLI test', `session-${process.pid}`)

  afterAll(() => store.remove())

  it('saves, reads back, replaces and removes the session', async () => {
    await store.remove()
    expect(await store.read()).toBeNull()

    const session = JSON.stringify({ userId: 'user-1', email: 'jé@example.com', token: 'x'.repeat(600), privateKey: 'k'.repeat(44), color: '#60A5FA' })
    await store.write(session)
    expect(await store.read()).toBe(session)

    await store.write('{"replaced":true}')
    expect(await store.read()).toBe('{"replaced":true}')

    await store.remove()
    expect(await store.read()).toBeNull()
    await expect(store.remove()).resolves.toBeUndefined()
  })
})
