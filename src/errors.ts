// A mistake on the command line: printed without a stack, exiting 2
export class UsageError extends Error {}

// No credential store to keep the session in: an unsupported system, or a Linux with no Secret Service. Printed
// without a stack, exiting 1
export class StoreUnavailableError extends Error {}

// No session saved, or the API turned its token down
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
