declare global {
  namespace Express {
    interface Request {
      // Populated by the requireAuth middleware; every route that reads it is guarded by it.
      userId: string;
    }
  }
}

export {};
