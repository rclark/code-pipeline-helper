'use strict';

class AWSError extends Error {
  constructor(err) {
    super();
    this.message = typeof err === 'string'
      ? err : err.message;
    this.code = err.code;
    Error.captureStackTrace(this, AWSError);
  }

  static reject(err) {
    return Promise.reject(new AWSError(err));
  }
}

module.exports = AWSError;
