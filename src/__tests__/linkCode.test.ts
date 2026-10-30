import { answerLinkCode, deliveryChecksOut, parseCode } from '../linkCode'

// A request the apps' own code started (Lumber's exchangeVector.test.ts pins the same run, and checks this answer with
// its verifyLinkAnswer), so this Mac's answer is one a device holding the account key accepts
const PARTIES = { sid: 'W54dlsa804XUzhOteBDNxQ==', linkId: '347EFCE6-5E41-43C2-B653-722AAB3C4E88', userId: '5F6F1632-0000-4000-8000-000000000001' }
const CODE = '4494554'
const HOLDER_MESSAGE = 'zMKOcstRzwBkAiqSII7GuXHwbGMZjco1kw2xBy/89is='
const PUBLIC_KEY = 'tQS7PC5VUMxAN59jEUme7YebisNHtxC+h0BJyoxEByo='
const SCALAR = 1234567890123456789012345678901234567890n

describe('linkCode', () => {
  it("answers as the apps' code does", () => {
    expect(answerLinkCode(PARTIES, CODE, HOLDER_MESSAGE, PUBLIC_KEY, SCALAR).answer).toEqual({ claimantMessage: 'kKi3uoUV8bKFjhdzaN+wMyIhatblJAcZbkRb+g8TLnk=', tag: 'OYsErUfuxpU96KAiBbg3S+CEkkbJ8XtTjLRhQU4Us70=' })
  })

  it('binds the answer to the code, the request and the key', () => {
    const { answer } = answerLinkCode(PARTIES, CODE, HOLDER_MESSAGE, PUBLIC_KEY, SCALAR)
    expect(answerLinkCode(PARTIES, '4494547', HOLDER_MESSAGE, PUBLIC_KEY, SCALAR).answer.tag).not.toBe(answer.tag)
    expect(answerLinkCode({ ...PARTIES, linkId: 'another' }, CODE, HOLDER_MESSAGE, PUBLIC_KEY, SCALAR).answer.tag).not.toBe(answer.tag)
    expect(answerLinkCode(PARTIES, CODE, HOLDER_MESSAGE, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', SCALAR).answer.tag).not.toBe(answer.tag)
  })

  // The apps' tag over the account key they send back for that answer (Lumber's exchangeVector.test.ts)
  it('checks the key that comes back as the apps tag it', () => {
    const { answer, secret } = answerLinkCode(PARTIES, CODE, HOLDER_MESSAGE, PUBLIC_KEY, SCALAR)
    const tag = 'h4ozpFTsYIsw/iM+QSVrpPWKteIPAFML8yFGkND/bwQ='
    expect(deliveryChecksOut(PARTIES, secret, HOLDER_MESSAGE, answer.claimantMessage, 'ENCRYPTED-ACCOUNT-KEY', tag)).toBe(true)
    expect(deliveryChecksOut(PARTIES, secret, HOLDER_MESSAGE, answer.claimantMessage, 'ANOTHER-KEY', tag)).toBe(false)
    expect(deliveryChecksOut(PARTIES, secret, HOLDER_MESSAGE, answer.claimantMessage, 'ENCRYPTED-ACCOUNT-KEY', answer.tag)).toBe(false)
  })

  it('reads a code as it was shown, and catches a typo', () => {
    expect(parseCode('449 4554')).toBe(CODE)
    expect(parseCode('449-4554')).toBe(CODE)
    expect(parseCode('4494555')).toBeNull()
    expect(parseCode('4494545')).toBeNull()
    expect(parseCode('449455')).toBeNull()
  })
})
