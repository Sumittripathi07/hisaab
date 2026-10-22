/** A problem the person can fix; its message is shown to them as-is. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** Someone else changed the thing since this person loaded it. The message says who; the client offers a reload. */
export class ConflictError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** The signed-in person is not allowed to touch this group. */
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
