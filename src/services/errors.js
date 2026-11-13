/** Error carrying an HTTP status, raised for problems the caller can fix (bad input, not found, upstream failure). */
class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { ServiceError };
