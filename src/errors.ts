// A mistake on the command line: printed without a stack, exiting 2
export class UsageError extends Error {}

// No session in the Keychain, or the API turned its token down
export class NotSignedInError extends Error {
  constructor(message = 'Not signed in. Run `lumber login` first.') {
    super(message)
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
