'use strict';

class ApiError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function errorMiddleware(error, request, response, next) {
  const client = response.locals.dbClient;
  const finish = async () => {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The transaction may already have completed.
      }
      client.release();
      response.locals.dbClient = null;
    }

    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    if (!(error instanceof ApiError)) {
      console.error(error);
    }
    const payload = {
      error: {
        code,
        request_id: response.locals.requestId
      }
    };
    if (error instanceof ApiError && error.details) payload.error.details = error.details;
    response.status(status).json(payload);
  };
  finish().catch(next);
}

module.exports = { ApiError, asyncHandler, errorMiddleware };